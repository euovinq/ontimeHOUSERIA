#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  publicar-r2.sh — sobe uma release do HouseriaAPP para o Cloudflare R2
#
#  O que vai para o bucket (prefixo `ontime/`):
#    • latest-mac.yml   ← o manifesto. É ELE que libera a atualização.
#    • *.zip            ← o pacote que o Squirrel troca (macOS usa zip, não dmg)
#    • *.dmg            ← só instalação inicial; o updater não usa
#
#  ORDEM IMPORTA: o .zip sobe ANTES do .yml. Se o manifesto chegar primeiro,
#  existe uma janela em que os apps veem a versão nova e tentam baixar um
#  arquivo que ainda não está lá — falha para o cliente, silêncio para você.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

falhar() { echo "❌ $*" >&2; exit 1; }
log()    { echo "→ $*"; }

DIST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist"
PREFIXO="ontime"

# ── Credenciais ───────────────────────────────────────────────────────
# Fora do repositório, no mesmo padrão do Vexy Stage.
ENV_FILE="${HOUSERIA_RELEASE_ENV:-$HOME/.houseria/release.env}"
[ -f "$ENV_FILE" ] || falhar "credenciais não encontradas em $ENV_FILE
Crie o arquivo com:
  R2_ACCOUNT_ID=...
  R2_BUCKET=houseria
  R2_ACCESS_KEY_ID=...
  R2_SECRET_ACCESS_KEY=..."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

for v in R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || falhar "$v não definida em $ENV_FILE"
done

command -v aws >/dev/null || falhar "AWS CLI não encontrado (R2 fala S3): brew install awscli"

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

subir() {
  local arquivo="$1" destino="$2" tipo="${3:-application/octet-stream}"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3 cp "$arquivo" "s3://${R2_BUCKET}/${PREFIXO}/${destino}" \
    --endpoint-url "$ENDPOINT" \
    --content-type "$tipo" \
    --only-show-errors
  log "$(basename "$arquivo") → ${PREFIXO}/${destino}"
}

# ── Confere que o build existe ────────────────────────────────────────
[ -d "$DIST" ] || falhar "pasta dist não existe — rode o build antes"

MANIFESTO="$DIST/latest-mac.yml"
[ -f "$MANIFESTO" ] || falhar "latest-mac.yml não encontrado.
Ele só é gerado quando há \`publish\` configurado no package.json.
Rode: pnpm dist-mac:universal"

mapfile -t ZIPS < <(find "$DIST" -maxdepth 1 -name '*.zip' | sort)
[ ${#ZIPS[@]} -gt 0 ] || falhar "nenhum .zip em $DIST — é ele que o updater baixa"

# ── Aviso sobre notarização ───────────────────────────────────────────
# No macOS o Squirrel recusa pacote não notarizado — e a falha só aparece na
# hora de instalar, depois de o cliente já ter baixado tudo.
APP="$DIST/mac-universal/HouseriaAPP.app"
if [ -d "$APP" ]; then
  if xcrun stapler validate "$APP" >/dev/null 2>&1; then
    log "notarização conferida no .app"
  else
    echo "⚠️  O .app NÃO tem ticket de notarização grampeado."
    echo "   A atualização vai baixar e falhar na instalação."
    read -r -p "   Subir mesmo assim? [s/N] " resposta
    [[ "$resposta" =~ ^[sS]$ ]] || falhar "cancelado"
  fi
fi

# ── Sobe: pacotes primeiro, manifesto por último ──────────────────────
log "[1/2] Subindo pacotes"
for z in "${ZIPS[@]}"; do subir "$z" "$(basename "$z")" "application/zip"; done
for d in "$DIST"/*.dmg; do
  [ -f "$d" ] && subir "$d" "$(basename "$d")" "application/x-apple-diskimage"
done

log "[2/2] Subindo o manifesto (é ele que libera a atualização)"
subir "$MANIFESTO" "latest-mac.yml" "text/yaml"

VERSAO=$(rg -o 'version: (.+)' -r '$1' "$MANIFESTO" | head -1 | tr -d '\r')
echo
echo "✅ Versão ${VERSAO} publicada."
echo "   Manifesto: https://pub-99e0bdf9ed2e4ece80525a5b31e1ed1e.r2.dev/${PREFIXO}/latest-mac.yml"
echo
echo "   Confira antes de avisar alguém:"
echo "     curl -s https://pub-99e0bdf9ed2e4ece80525a5b31e1ed1e.r2.dev/${PREFIXO}/latest-mac.yml"
