#!/usr/bin/env bash
#
# Release do desktop no macOS — assinado, notarizado e publicado no R2.
#
# Espelha o fluxo LOCAL que já funciona no vexy: assina com o "Developer ID
# Application" do chaveiro (o electron-builder descobre sozinho) e sobe pro R2
# com as mesmas chaves da conta. A diferença é só o bucket — aqui é `houseria`.
#
# NÃO é CI: roda na sua máquina, onde o certificado e a senha de app já estão.
# O Windows continua saindo pelo GitHub Actions (ver .github/workflows/build.yml
# e RELEASE.md) — você não builda Windows no mac.
#
# ── Pré-requisitos (uma vez) ─────────────────────────────────────────────
#   1. O cert "Developer ID Application" no chaveiro (você já tem — assinou o vexy).
#   2. As credenciais no .env da RAIZ do repo (ontimeHOUSERIA/.env, gitignored):
#        R2_ACCESS_KEY_ID=...          # as MESMAS chaves do ~/.vexy/release.env
#        R2_SECRET_ACCESS_KEY=...      #   (mesma conta Cloudflare)
#        APPLE_ID=seu@email            # o electron-builder notariza com estes três
#        APPLE_APP_SPECIFIC_PASSWORD=...  # a senha-de-app
#        APPLE_TEAM_ID=38N7F4DRZ4
#      (conta, bucket e URL pública são fixos e ficam hardcoded abaixo — não são
#       segredo e precisam casar com o que o updater.js lê.)
#
# ── Uso ──────────────────────────────────────────────────────────────────
#   1. suba a versão em apps/electron/package.json E na raiz (têm que casar);
#   2. ./apps/electron/release-mac.sh
#
set -euo pipefail

log()  { echo ""; echo "▶ $*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo ""; echo "❌ $*"; exit 1; }

# Fixos (não-segredo) — batem com publish.url do package.json e com o updater.js.
R2_ACCOUNT_ID="fde731ecdd6c91cd9f24fd4dde3dced2"
R2_BUCKET="houseria"
R2_PREFIX="ontime"
PUBLIC_BASE="https://pub-99e0bdf9ed2e4ece80525a5b31e1ed1e.r2.dev/${R2_PREFIX}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# ── Segredos ────────────────────────────────────────────────────────────
# O .env da raiz do repo (gitignored) — onde ficam R2_ACCESS_KEY_ID/SECRET e
# APPLE_ID/APP_SPECIFIC_PASSWORD/TEAM_ID.
ENV_FILE="$REPO/.env"
[ -f "$ENV_FILE" ] || fail "falta $ENV_FILE (ver o cabeçalho deste script)"
set -a; source "$ENV_FILE"; set +a
for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || fail "$v não está em $ENV_FILE"
done
command -v aws >/dev/null || fail "aws CLI não encontrado (R2 fala S3): brew install awscli"

# ── Certificado no chaveiro ─────────────────────────────────────────────
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
  fail "nenhum 'Developer ID Application' no chaveiro — sem ele o app sai sem assinatura e o update TRAVA na instalação."
fi
ok "Developer ID Application encontrado no chaveiro"

VERSAO="$(node -p "require('./apps/electron/package.json').version")"
log "Versão a publicar: $VERSAO"

# ── Build assinado + notarizado ─────────────────────────────────────────
# `dist-mac:universal` (SEM o :local) assina de verdade; o electron-builder
# notariza com APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID do env.
log "Buildando pacotes..."
pnpm build
log "Buildando o app (assina + notariza — pode levar minutos)..."
pnpm --filter houseriaapp-electron dist-mac:universal

# ── Conferir o manifesto ────────────────────────────────────────────────
DIST="apps/electron/dist"
[ -f "$DIST/latest-mac.yml" ] || fail "latest-mac.yml não foi gerado — o auto-update ficaria sem manifesto."
ok "latest-mac.yml gerado"

# ── Assinar + notarizar + grampear a CASCA do DMG ───────────────────────
# O electron-builder notariza e grampeia o .app (o que o auto-update usa, via
# .zip), mas deixa o .dmg SEM assinatura. No download manual, um DMG sem
# assinatura faz o `spctl` recusar a casca. Ordem obrigatória: assina →
# notariza → grampeia (assinar muda o hash e invalida um staple anterior).
DMG="$DIST/houseriaapp-macOS-universal.dmg"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-vexy-notary}"
if [ -f "$DMG" ]; then
  log "Assinando + notarizando + grampeando o DMG..."
  SIGN_ID="Developer ID Application: $(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | sed -E 's/.*"Developer ID Application: (.*)".*/\1/')"
  codesign --force --sign "$SIGN_ID" "$DMG" || fail "falha ao assinar o DMG"
  # NÃO usar `notarytool ... | grep -q`: o grep -q fecha o pipe no 1º match,
  # o notarytool morre de SIGPIPE, e com `set -o pipefail` a linha "falha"
  # mesmo com a notarização ACEITA (foi o que derrubou o release 1.0.6 por
  # engano). Capturamos a saída e testamos sem pipe.
  NOTARY_OUT="$(xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1 || true)"
  if [[ "$NOTARY_OUT" == *"status: Accepted"* ]]; then
    xcrun stapler staple "$DMG" >/dev/null || fail "falha ao grampear o DMG (notarizou mas não grampeou)"
    SPCTL_OUT="$(spctl -a -t install "$DMG" 2>&1 || true)"
    if [[ "$SPCTL_OUT" == *accepted* ]]; then
      ok "DMG assinado, notarizado e grampeado (passa no Gatekeeper)"
    else
      warn "DMG grampeado mas o spctl não confirmou: $SPCTL_OUT"
    fi
  else
    fail "a Apple NÃO aceitou a notarização do DMG. Saída: $NOTARY_OUT"
  fi
fi

# ── Publicar no R2 ──────────────────────────────────────────────────────
log "Subindo pro R2 (bucket $R2_BUCKET, prefixo $R2_PREFIX)..."
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION="auto" \
AWS_REQUEST_CHECKSUM_CALCULATION="when_required" \
AWS_RESPONSE_CHECKSUM_VALIDATION="when_required" \
aws s3 sync "$DIST/" "s3://${R2_BUCKET}/${R2_PREFIX}/" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --exclude "*" \
  --include "latest-mac.yml" \
  --include "*.zip" \
  --include "*.zip.blockmap" \
  --include "houseriaapp-macOS-universal.dmg"

# ── Conferir que ficou público ──────────────────────────────────────────
CODE="$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC_BASE}/latest-mac.yml")"
[ "$CODE" = "200" ] || fail "a URL pública respondeu $CODE em latest-mac.yml — confira se o bucket é o 'houseria' e se o acesso público (r2.dev) está ligado."

# ── Arquivar versões antigas ────────────────────────────────────────────
# A raiz do prefixo tem que ficar SÓ com a versão atual (o auto-update lê o
# latest-mac.yml e busca os arquivos flat ao lado dele). Então todo
# HouseriaAPP-X.Y.Z-*.zip/.blockmap de versão != a atual vai pra
# versoes-antigas/X.Y.Z/. O dmg (nome sem versão) e o latest-mac.yml são sempre
# sobrescritos, então ficam.
#
# Usa `s3api copy-object` (CopyObject cru) de propósito: o `s3 mv`/`cp` de alto
# nível chama GetObjectTagging, que o R2 NÃO implementa — e falha nos arquivos
# grandes. Tudo aqui é best-effort: o release já foi publicado acima, então uma
# falha de arquivamento só deixa a raiz um pouco mais cheia, nunca quebra nada.
log "Arquivando versões antigas em versoes-antigas/..."
ARCH_EP="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
arch_aws() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION="auto" AWS_REQUEST_CHECKSUM_CALCULATION="when_required" \
  AWS_RESPONSE_CHECKSUM_VALIDATION="when_required" \
  aws "$@" --endpoint-url "$ARCH_EP"
}
# --delimiter "/" lista só o nível-raiz do prefixo (não desce em versoes-antigas/)
ROOT_KEYS="$(arch_aws s3api list-objects-v2 --bucket "$R2_BUCKET" \
  --prefix "${R2_PREFIX}/" --delimiter "/" \
  --query "Contents[].Key" --output text 2>/dev/null || true)"
for key in $ROOT_KEYS; do
  name="${key##*/}"
  case "$name" in
    HouseriaAPP-*-mac.zip|HouseriaAPP-*-mac.zip.blockmap)
      [[ "$name" == *"-${VERSAO}-"* ]] && continue  # é a versão atual: mantém flat
      v="$(printf '%s' "$name" | sed -E 's/^HouseriaAPP-([0-9]+\.[0-9]+\.[0-9]+)-.*/\1/')"
      [[ -z "$v" || "$v" == "$name" ]] && continue   # não extraiu versão: não mexe
      dest="${R2_PREFIX}/versoes-antigas/${v}/${name}"
      if arch_aws s3api copy-object --bucket "$R2_BUCKET" --key "$dest" \
           --copy-source "${R2_BUCKET}/${key}" >/dev/null 2>&1; then
        arch_aws s3api delete-object --bucket "$R2_BUCKET" --key "$key" >/dev/null 2>&1 \
          && ok "arquivado: $name → versoes-antigas/${v}/" \
          || warn "copiou mas não removeu o original de $name"
      else
        warn "não consegui arquivar $name (segue publicado, sem problema)"
      fi
    ;;
  esac
done

ok "Publicado. O manifesto está no ar:"
echo "     ${PUBLIC_BASE}/latest-mac.yml"
echo ""
echo "  Teste: num app numa versão anterior, menu 'Buscar atualização…' →"
echo "  tem que achar a $VERSAO, baixar (barra no dock) e CONCLUIR a instalação."
