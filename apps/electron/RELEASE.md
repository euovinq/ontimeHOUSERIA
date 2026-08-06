# Como publicar uma nova versão do desktop

O auto-update lê de um bucket R2 público (`houseria`, em
`https://pub-99e0…r2.dev/ontime/`). Publicar = build assinado + subir os artefatos
(o manifesto `latest*.yml`, o `.zip`/`.exe` e os blockmaps) para esse caminho.

**Dois caminhos, por plataforma:**

| plataforma | como | por quê |
|---|---|---|
| **macOS** | `apps/electron/release-mac.sh` (local, na sua máquina) | reaproveita o cert do chaveiro e as chaves de R2 que já assinam o vexy — sem exportar `.p12` |
| **Windows** | GitHub Actions (`.github/workflows/build.yml`), push de tag | você não builda Windows no mac; e o Windows não é assinado |

## Por que estava quebrado (contexto de 05/08/2026)

O `updater.js` sempre leu do R2, mas **nada populava esse caminho**: o CI antigo publicava
só no GitHub Releases, com nomes de arquivo herdados do Ontime original (`ontime-*.dmg`)
que nem batiam com os que o build gera (`houseriaapp-*`). Confirmado na época: o R2 dava
404 em `latest-mac.yml`. Ou seja, "Buscar atualização" nunca teve de onde baixar.

---

## macOS — release local (`release-mac.sh`)

### Pré-requisitos (uma vez)

1. **Cert "Developer ID Application" no chaveiro** — você já tem (foi o que assinou o vexy).
2. **`~/.houseria/release.env`** — **fora do repositório**, com estas linhas:

   ```sh
   # R2: as MESMAS chaves do ~/.vexy/release.env (mesma conta Cloudflare,
   # account fde731…ced2). O bucket/URL já estão fixos no script.
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...

   # Apple: o electron-builder notariza com estes três.
   APPLE_ID=seu@email
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   APPLE_TEAM_ID=38N7F4DRZ4
   ```

   ```sh
   mkdir -p ~/.houseria && chmod 700 ~/.houseria
   # crie o arquivo e depois:
   chmod 600 ~/.houseria/release.env
   ```

> **⚠️ Por que NÃO no `.env` da raiz do repo.** Esse arquivo é empacotado dentro do app
> (`extraResources` → `Contents/Resources/extraResources/server/.env`). Entre 05/08/2026 e
> a correção, as credenciais moraram lá e **saíram publicadas nas versões 1.0.8 a 1.0.12**,
> em texto puro, em qualquer máquina com o app. A chave de R2 tem **escrita** no bucket que
> alimenta o auto-update, e o instalador do Windows não é assinado — dava para publicar um
> instalador próprio para toda a base. Essas chaves precisam ser **rotacionadas**.
>
> O que vai dentro do app agora é **`apps/electron/runtime.env`**, versionado e sem
> segredo (só a configuração pública do Supabase). Ele é versionado de propósito: sem ele
> no repositório, o build do Windows no CI não teria o arquivo para empacotar.

> **⚠️ Escopo do token R2.** As chaves do vexy só servem se o R2 API Token tiver acesso ao
> bucket **`houseria`** — não só ao `vexystage`. Se ele foi criado escopado ao vexystage,
> crie um token novo em Cloudflare > R2 > Manage R2 API Tokens com permissão de escrita no
> `houseria` (ou na conta toda). O script avisa se o upload for negado.

### Publicar

```sh
# 1. suba a versão em apps/electron/package.json E na raiz (têm que casar)
# 2. rode:
./apps/electron/release-mac.sh
```

O script: confere o cert, builda universal (assina + notariza), confere que o
`latest-mac.yml` saiu, sobe pro R2 e valida que a URL pública responde 200. Se qualquer
passo falhar, ele para e diz onde.

---

## Windows — release por CI

Configure uma vez, em **Settings > Secrets and variables > Actions**:

| secret | onde achar |
|---|---|
| `R2_ACCOUNT_ID` | `fde731ecdd6c91cd9f24fd4dde3dced2` (o mesmo do endpoint S3 da conta) |
| `R2_BUCKET` | `houseria` |
| `R2_ACCESS_KEY_ID` | a mesma do `~/.vexy/release.env` (ver o aviso de escopo acima) |
| `R2_SECRET_ACCESS_KEY` | idem |

Depois, o push de uma tag `vX.Y.Z` dispara o build do Windows e a publicação no R2.
(O Windows não é assinado: o instalador roda, mas o SmartScreen avisa na 1ª execução. O
auto-update do Windows funciona mesmo assim.)

---

## Cortar uma release (as duas plataformas)

```sh
# 1. Suba a versão nos DOIS package.json (têm que casar):
#    apps/electron/package.json  →  "version"
#    package.json (raiz)         →  "version"

# 2. macOS (local):
./apps/electron/release-mac.sh

# 3. Windows (CI): commit, tag e push
#    (a branch deste repo é `master` — `main` só existe no houseriasite)
git commit -am "release: v1.0.8"
git tag v1.0.8
git push origin master --tags
```

> O auto-update só dispara para quem está numa versão **menor** que a publicada.
> Republicar a mesma versão não atualiza ninguém.

## Testar que funcionou

```sh
curl -s https://pub-99e0bdf9ed2e4ece80525a5b31e1ed1e.r2.dev/ontime/latest-mac.yml   # mac
curl -s https://pub-99e0bdf9ed2e4ece80525a5b31e1ed1e.r2.dev/ontime/latest.yml       # win
```

Os dois têm que responder (não 404) e apontar para a versão nova. Depois, num app numa
versão anterior: menu **Buscar atualização…** → achar, baixar (barra no dock/taskbar) e,
no mac, **concluir a instalação** (é onde a falta de notarização apareceria).

## O lado do app (já pronto, não mexer)

`apps/electron/src/updater.js`: pergunta antes de baixar, baixa em segundo plano (nunca
interrompe evento ao vivo), mostra progresso no ícone e na UI, e só troca o app quando o
usuário fecha ou manda reiniciar. Nada reinicia sozinho no meio de um show.
