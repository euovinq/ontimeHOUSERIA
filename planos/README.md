# Planos

Os quatro documentos que descrevem para onde este sistema está indo, e o que já foi
feito. Numerados na ordem em que fazem sentido ser lidos — não na ordem de execução.

Eles cobrem **dois repositórios**: `ontimeHOUSERIA` (desktop + servidor) e
`houseriasite` (Next.js). Ficam aqui, num lugar só, porque separá-los por repo fazia
perder a visão do conjunto — vários itens tocam os dois ao mesmo tempo.

| # | documento | estado |
|---|---|---|
| 01 | [Egress e saúde do servidor](01-egress-e-saude-do-servidor.md) | Fase A **feita**; Fase B pendente (rota de snapshot já construída) |
| 02 | [Segurança e multi-tenancy](02-seguranca-e-multitenancy.md) | Fases 0, 1 e 5 **feitas**; Fase 2 **provada** (falta acoplar); 3 e 4 pendentes |
| 03 | [Eventos e painel do dono](03-eventos-e-painel-do-dono.md) | etapas 1–7 **feitas** e no ar |
| 04 | [Runbook de pendências](04-runbook-de-pendencias.md) | o que sobrou, com comando e reversão |

## Se você está começando agora

A ameaça que originou tudo — qualquer visitante do site com permissão de admin do banco
— **foi fechada em 05/08/2026.** `users`, `sales`, `user_sessions`,
`user_machine_licenses`, `event_buildup_access`, `join_attempts` e a escrita de
`software_versions` não são mais alcançáveis pela chave anônima. Verificado tentando de
fora: um pentest versionado (`houseriasite/scripts/guardas/`) prova a cada deploy que
nenhuma dessas portas reabriu.

O que sobra divide-se em dois eixos que **convergem na mesma implementação**:

- **Escalar** (plano 01, Fase B): tirar o espectador do banco, para o custo deixar de
  crescer com a plateia. É isto que leva de ~15 para ~50–60 eventos simultâneos.
- **Fechar de vez** (plano 02, Fases 3 e 4): `ontime_realtime`/`powerpoint_realtime`
  ainda são graváveis pelo anônimo. Tirar o espectador do banco (Fase 4) é ao mesmo
  tempo o ganho de escala e o fecho de segurança.

**Próxima sessão = Fase B, feita como jogada coordenada (site + desktop), fora de
qualquer evento marcado, com janela de convivência para os desktops em campo.** Ver a
seção "O que falta" ao fim.

## Três coisas que valem mais que o conteúdo dos documentos

**A ordem não é sugestão.** Vários itens quebram em silêncio se executados fora de
ordem — fechar o `anon` em `users` antes de apontar as telas para as API routes derruba
o dashboard na hora; ligar o filtro do PowerPoint no site antes do banco preencher a
coluna faz o espectador parar de receber, sem erro no console.

**Nada que fecha porta pode ser feito com gente usando o sistema.** Cada item derruba
alguém. O 04 classifica o que é seguro com evento no ar e o que exige janela.

**Segurança pela metade é pior que nenhuma.** RLS é permissivo: uma policy nova ao lado
de uma `USING (true)` que sobreviveu não protege nada, mas passa a sensação de que sim.
Se for começar, termine a etapa. As guardas em `scripts/guardas/` existem para pegar
justamente a `true` sobrevivente.

---

## O que já está aplicado em produção

### 04/08/2026 — saúde do servidor (Fase A) e produto

- seis índices sem uso dropados, `REPLICA IDENTITY` corrigido, `project_code` no
  PowerPoint com trigger, dashboards fora do `postgres_changes` — tudo com dois eventos
  ao vivo, sem interrupção;
- pasta de evento, cobrança por evento, painel do dono e relatório de execução, no ar.

### 05/08/2026 — segurança e higiene (Fases 0, 1, 5 + limpezas)

**Senhas (Fase 1).** SHA-256 sem salt → **Argon2id** (m=19 MiB, t=2, p=1, o piso da
OWASP), com re-hash transparente no login: ninguém troca de senha, ninguém é deslogado.
Provado em produção (a conta do dono migrou no primeiro login do desktop).

**Fechamento do banco (Fase 0).** Fechadas ao `anon` e ao `authenticated`, verificado
com a chave real (401 em leitura E escrita): `users`, `sales`, `user_sessions`,
`user_machine_licenses`, `event_buildup_access`, `join_attempts`. Escrita de
`software_versions` também fechada (era `ALL TO authenticated`, e virar authenticated
custava uma chamada de login anônimo — o que reescrevia a URL de download do app).

**Autorização saiu do navegador.** Troca de senha, CRUD de clientes e de vendas, catálogo
de versões e a decisão "posso editar este projeto" agora passam por rotas de API com
service role. O `JWT_SECRET` com fallback literal, que sobrevivia em 3 arquivos além do
já corrigido, foi centralizado em `lib/jwt-secret.ts`.

**Funções e views.** `EXECUTE` público revogado; `search_path` fixado em 25 funções;
`metrics_realtime` (SECURITY DEFINER que expunha a carga do banco) fechada ao anon.

**Cadastro e login anônimo desligados.** O site nunca usou `signUp()`; a porta só era
superfície de ataque. Pentest de 8 caminhos de identidade — todos recusados.

**Módulo houseriafile REMOVIDO** (feature aposentada, será refeita sobre R2): 6 tabelas,
9 funções, o bucket `drops` e 11 arquivos do site. Foi o que permitiu desligar o login
anônimo — ele existia só para esse módulo.

**Guarda-corpos (Fase 5).** `scripts/guardas/` + workflow no CI: um linter estático
(postgres_changes sem filter, tabela sensível no browser, NEXT_PUBLIC_ indevido) e dois
pentests de runtime (o que a anon key alcança; que identidade um estranho consegue
obter). Rodam no build e semanalmente.

**Egress (itens C).** Teto de payload no writer do PowerPoint, notas de slide truncadas,
`video.sourceUrl` parou de subir. A rotina `cleanupOldProjects` foi **removida** (apagava
222 dos 228 projetos; projeto é histórico do cliente).

**Contador de pendências** virou coluna gerada: refetch do dashboard **395.790 → 50.845
bytes** (−87%).

### Configuração de painel (feita por você)

- `OWNER_USER_ID` na Vercel (o painel `/dono` deixou de vazar faturamento para os 8 admins);
- `SUPABASE_JWT_SECRET` na Vercel + local (destrava a Fase 2);
- os dois secrets `NEXT_PUBLIC_*` no GitHub (o CI das guardas roda);
- cadastro público e login anônimo desligados no painel do Supabase;
- leaked password protection ligado.

**Verificado após o deploy, com um evento de teste ao vivo:** o pipeline
desktop → nuvem → espectador está intacto; as guardas passam contra produção.

---

## O que falta — a fazer DEPOIS de eventos, em janela própria

### Fase 2 — token que o banco entende (mecanismo PROVADO, falta acoplar)

`lib/supabase-token.ts` emite um token que o PostgREST aceita; provado ponta a ponta
(`token-aceito.mjs`). Decisão travada: **gestor só por API route**, então a policy de
dono canônica é `auth.uid() = user_id`. Falta emitir o token no login do cliente e
escrever as policies reais — mas isso só fecha valor junto com as Fases 3 e 4, porque
toda tabela que resta é compartilhada.

### Fase B (egress) = Fase 4 (segurança) — a jogada coordenada

É o que muda a lei de escala (custo deixa de crescer com a plateia) E fecha
`ontime_realtime` ao anônimo. Partes:

- **B4 / snapshot atrás de CDN** — a rota `app/api/snapshot/[projectCode]` já está
  **construída e provada** (4 caminhos, incluindo o gate por código, que ficou mais
  forte que hoje). Falta **ligar as 6 páginas de espectador** a ela. Pegadinha: os 5
  projetos com código precisam do fluxo 401 → `AccessCodeForm` em cada página.
- **B2 / PowerPoint por broadcast** e **B1 / tirar as tabelas da publicação** — mexem no
  **desktop**, logo exigem a Fase 3 e a janela de convivência.

### Fase 3 — escrita do desktop com identidade

O maior atrito: o desktop em campo escreve com a anon key. Qualquer aperto no RLS de
`ontime_realtime` derruba as versões antigas. Precisa de convivência (aceita token novo
E anon) + corte com data anunciada. **Começar por ela** quando a Fase B for encarada.

### Distribuir o desktop — o auto-update estava QUEBRADO, agora corrigido no código

Descoberto em 05/08/2026: **o auto-update nunca funcionou.** O `updater.js` lê de um
bucket R2 (`pub-99e0…r2.dev/ontime/`), mas nada populava esse caminho — o CI antigo
publicava só no GitHub Releases, com nomes de arquivo errados herdados do Ontime
original. Confirmado: o R2 dá 404 em `latest-mac.yml`. O `updater.js` em si é bom (barra
de progresso no dock + UI, pergunta antes de baixar, nunca reinicia no meio de evento) —
faltava a esteira que sobe os artefatos.

**Corrigido no código (05/08/2026), reaproveitando o setup do vexy (que já assina):**
- **macOS → `apps/electron/release-mac.sh`** (local): assina com o cert do chaveiro,
  notariza e sobe pro R2. Reaproveita as chaves de R2 do `~/.vexy/release.env` — mesma
  conta Cloudflare (`fde731…ced2`), **só o bucket muda para `houseria`** (cujo público
  `pub-99e0…r2.dev` é exatamente o que o updater lê). Não precisa exportar `.p12`.
- **Windows → `.github/workflows/build.yml`** (CI): builda e sobe pro R2 via `aws s3 sync`.
  Windows não é assinado (funciona assim).
- `apps/electron/RELEASE.md` documenta os dois caminhos e o `~/.houseria/release.env`.

**Falta você plugar:**
- `~/.houseria/release.env` com as chaves de R2 (copiadas do vexy) + Apple
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`);
- 4 secrets de R2 no GitHub (só para o job do Windows);
- **conferir o escopo do token R2**: as chaves do vexy só escrevem no `houseria` se o
  token não estiver escopado só ao `vexystage`.

**Consequência para o roadmap:** a Fase 3 (corte do desktop antigo) assume auto-update
funcionando para a janela de convivência. **Consertar e TESTAR essa esteira é
pré-requisito da Fase 3** — o `updater.js` em si é bom (barra de progresso, pergunta
antes, nunca reinicia no meio de evento); faltava a esteira que popula o R2, agora pronta.

### Item 0.7 — hashes vazados

Os SHA-256 sem salt estiveram legíveis por muito tempo. Forçar troca de senha na próxima
entrada. Barato tecnicamente, mas é atrito com o cliente — decisão de produto, de quando.
