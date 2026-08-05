# PowerPoint no macOS — entitlement de multicast (descoberta por broadcast)

## Sintoma

No **app empacotado** (duplo-clique / Finder), o painel "Fontes PowerPoint" fica
eternamente em **"aguardando conexão da máquina ativa..."**. Nenhum pop-up de
"Rede Local" aparece e o **HouseriaAPP não entra** em Ajustes → Privacidade e
Segurança → Rede Local.

Rodando o **mesmo binário pelo Terminal** (`/Applications/HouseriaAPP.app/Contents/MacOS/HouseriaAPP`)
conecta na hora e lê os slides. Em **dev** também funciona (aparece "Electron" na
lista de Rede Local, não "HouseriaAPP").

## Causa (confirmada)

A descoberta do PPT usa **UDP broadcast** para `255.255.255.255:7899`
(`setBroadcast(true)` em `apps/server/src/api-data/powerpoint/powerpoint-discovery.service.ts`).

No **macOS 15 (Sequoia)**, enviar/receber **broadcast/multicast exige o entitlement
`com.apple.developer.networking.multicast`** — que a Apple precisa **aprovar** para
o Team ID. Sem ele, o macOS **filtra o broadcast em silêncio** e **não** dispara o
prompt de Rede Local (o prompt padrão só nasce de tráfego **unicast**). Por isso o
app nunca "ouve" o PPT e trava em "aguardando".

Rodar pelo Terminal contorna porque herda a confiança de rede do próprio Terminal —
é só diagnóstico, **não serve para distribuir**.

Referências:
- Apple — regra geral: broadcast/multicast (enviar E receber) exige o entitlement.
- Apple — em Sequoia o acesso UDP/broadcast foi restringido; a via é solicitar o
  entitlement à Apple.
- `NSLocalNetworkUsageDescription` (já adicionado no `build.mac.extendInfo` do
  `package.json`) é recomendado, mas **sozinho não basta** para broadcast.

## Conserto (o único que mantém a descoberta automática + failover)

### Passo 1 — Solicitar o entitlement à Apple  *(só o dono da conta faz)*

Formulário: https://developer.apple.com/contact/request/networking-multicast

Justificativa sugerida (em inglês):

> HouseriaAPP is a live-event timing and show-control application. On the local
> network it discovers companion PowerPoint presentation-server instances via UDP
> broadcast (port 7899) so the operator can synchronize slides live during a show,
> with automatic failover between redundant presentation machines. The app needs to
> send and receive UDP broadcast on the LAN for this discovery. Distribution is
> Developer ID (notarized), not the Mac App Store. Bundle ID: `no.lightdev.houseriaapp`.

A Apple costuma aprovar casos legítimos; o retorno leva **alguns dias**.

**Pedido enviado em 2026-08-05 — Request ID: `LC49A7S3ZP`** (aguardando retorno da Apple).

### Passo 2 — Depois de aprovado, ligar no build

1. No Apple Developer, gere um **perfil de provisionamento de macOS Developer ID**
   para o App ID `no.lightdev.houseriaapp` que **inclua** o entitlement de multicast
   (baixe o `.provisionprofile`).
2. Coloque o `.provisionprofile` em `apps/electron/` e aponte no `package.json`:
   ```json
   "mac": {
     "provisioningProfile": "embedded.provisionprofile",
     ...
   }
   ```
3. Adicione o entitlement em `apps/electron/entitlements.plist`:
   ```xml
   <key>com.apple.developer.networking.multicast</key>
   <true/>
   ```
4. Rebuild assinado + notarizado (`./apps/electron/release-mac.sh`) e teste no
   **duplo-clique**: agora o pop-up de Rede Local deve aparecer → Permitir → o PPT
   conecta pela descoberta automática.

> ⚠️ **Não** adicione o entitlement ao `entitlements.plist` **antes** da aprovação:
> a notarização rejeita entitlement restrito não autorizado e o build passa a falhar.
> Por isso ele está documentado aqui, e **não** aplicado ainda.

## Interino (enquanto a Apple não aprova)

- Operadores **Windows**: não são afetados — o Windows não tem esse porteiro; a
  descoberta automática funciona normalmente.
- Operadores **Mac**: ficam sem o PPT até o entitlement entrar. Stopgap frágil (não
  recomendado para produção): abrir o app pelo Terminal, que contorna o gate.
- Alternativa de produto (não escolhida agora): conexão por **IP direto/unicast** via
  `POWERPOINT_WINDOWS_URL` / `powerpoint-windows.service.ts`, que dispara o prompt e
  conecta sem broadcast — porém perde a auto-descoberta/failover no Mac.

## Estado atual do repo

- `package.json` (electron): versão **1.0.7**, `NSLocalNetworkUsageDescription`
  adicionado em `build.mac.extendInfo`. **Segurar a publicação do 1.0.7** até o
  entitlement entrar, para os operadores Mac receberem **uma** atualização que
  realmente resolve o PPT.
- `entitlements.plist`: **sem** o multicast ainda (ver aviso acima).
