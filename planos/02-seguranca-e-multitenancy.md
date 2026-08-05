# Plano de segurança e multi-tenancy (pré-requisito para escalar)

> Projeto Supabase: `gxcgwhscnroiizjwswqv`.
>
> **Status em 04/08/2026 — leia antes de agir.** O item 0.1 está FEITO. O plano de
> egress companion foi aplicado quase inteiro. E foram criadas tabelas e funções
> novas que **já nascem corretas** — a §1.8 lista o que NÃO deve ser mexido.
> Companion de [01-egress-e-saude-do-servidor.md](01-egress-e-saude-do-servidor.md) — os dois se
> encaixam, e o item §5.3 explica por que fazer os dois juntos sai mais barato que fazer
> um de cada vez.

---

## 0. Resumo em uma frase

Hoje qualquer visitante do site tem, na prática, permissão de administrador do banco
inteiro. Não é um risco teórico nem uma questão de volume: é o estado atual, e ele impede
escalar antes de qualquer outra coisa.

---

## 1. Situação atual

### 1.1 O RLS está ligado, mas todas as políticas são `true`

`pg_policies`, tabelas principais — **todas com role `public`**:

| tabela | política | cmd | `USING` | `WITH CHECK` |
|---|---|---|---|---|
| `ontime_realtime` | `Allow public upsert` | ALL | `true` | — |
| `ontime_realtime` | `Allow insert/update by project code` | ALL | `true` | — |
| `ontime_realtime` | `Allow UPDATE for Realtime` | UPDATE | `true` | `true` |
| `ontime_realtime` | + 5 políticas de SELECT | SELECT | `true` | — |
| `powerpoint_realtime` | `Anyone can modify` | ALL | `true` | `true` |
| `users` | `Allow read/insert/update/delete users` | cada uma | `true` | `true` |
| `user_sessions` | `Allow all user_sessions` | ALL | `true` | `true` |
| `user_machine_licenses` | `Allow all user_machine_licenses` | ALL | `true` | `true` |
| `sales` | `Allow read/update/delete sales` | cada uma | `true` | — |

RLS ligado com política `true` é o mesmo que RLS desligado, com a diferença de que o
painel mostra o cadeado verde.

### 1.2 Seis tabelas com RLS totalmente desligado

Do security advisor (nível ERROR):

`buildup_files`, `buildup_tasks`, `event_buildups`, `event_buildup_access`,
`live_events`, `join_attempts`.

Em projeto Supabase, o role `anon` já recebe GRANT nas tabelas do schema `public`.
RLS desligado = leitura e escrita livres pela API REST.

### 1.3 A `anon key` é pública — e é isso que fecha a conta

Ela está, por construção, no bundle do Next.js (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) e
hardcoded no desktop ([SupabaseAdapter.ts:405](../apps/server/src/adapters/SupabaseAdapter.ts)).
Isso é o uso normal e correto da chave — **desde que o RLS seja real**. Como não é,
qualquer pessoa que abra o console em qualquer página pública do site consegue hoje:

- `from('users').select('*')` → `email`, `telefone_pessoa_fisica`, `telefone_empresa`,
  `password_hash` e `is_admin` de todos os clientes;
- `from('users').update({ is_admin: true }).eq('email', '…')` → virar admin;
- `from('users').delete()` → apagar a base de clientes;
- `from('ontime_realtime').update(…)` / `.delete()` → reescrever ou apagar a rundown de
  qualquer cliente, **ao vivo, durante o show**;
- `from('ontime_realtime').select('access_code, edit_access_codes, edit_share_links')` →
  ler os códigos de acesso e os tokens de edição de todos os projetos.

### 1.4 O modelo de senha agrava o vazamento

`lib/utils.ts:134` — `hashPassword()` é **SHA-256 puro, sem salt**, via `crypto.subtle`.

SHA-256 é rápido por design: é function de hash, não de senha. Sem salt e sem custo
computacional, uma lista de hashes vazada se quebra com rainbow table ou GPU em minutos
para qualquer senha comum. Combinado com o `SELECT` público do §1.3, os hashes já são
considerados material comprometido.

Pior: em `app/dashboard/cliente-settings/page.tsx:217-242`, a troca de senha **acontece
no navegador** — busca o `password_hash`, compara em JS, escreve o novo. O hash trafega
para o cliente e a decisão de "senha correta" é tomada no cliente.

### 1.5 Autorização é decidida no cliente

`localStorage`: `client_auth_token`, `client_session`, `user_type`. As páginas leem
`client_session` para decidir se são admin e qual cliente é. Como a chamada ao banco não
carrega essa decisão, editar o `localStorage` não é nem necessário — dá para falar com o
Supabase direto.

### 1.6 Os códigos de acesso não protegem nada

`access_code`, `edit_access_codes` e `edit_share_links` são colunas de `ontime_realtime`,
que tem `SELECT USING (true)`. Uma query lista todos. As páginas "protegidas por código"
(`AB`, `cliente`, `cliente-tv`, `equipe`, `editar`) são abertas na prática.

### 1.7 Outros achados do advisor

- **`realtime.messages` tem uma policy chamada `teste` liberando `anon`.** Isso importa
  muito: é a tabela que autoriza os canais de **Broadcast**. Como a Fase B do plano de
  egress move todo o tempo real para broadcast, essa policy precisa virar real *antes*,
  senão o problema muda de porta.
- **`storage.objects`**: `buildup_files_anon_delete` e `buildup_files_anon_update` —
  anônimo pode alterar e apagar arquivos no Storage.
- **11 funções `SECURITY DEFINER` executáveis por `anon`** via `/rest/v1/rpc/`:
  `join_session`, `create_session`, `handle_new_user`, `list_session_storage_paths`,
  `clear_my_file_locations`, `check_user_quota`, `get_my_storage_usage`, `get_user_role`,
  `is_owner`, `is_member`, `is_session_owner`. `SECURITY DEFINER` roda com os privilégios
  de quem criou — cada uma é uma porta lateral a auditar.
- **View `metrics_realtime` é `SECURITY DEFINER`** — ignora o RLS de quem consulta.
- ~~**`JWT_SECRET` tem fallback literal**~~ — **resolvido pela metade em 04/08/2026,
  fechado de verdade em 05/08/2026.** A correção de 04/08 mexeu em `lib/auth.ts` e
  parou ali; havia mais **três** cópias da mesma linha, em `lib/jwt.ts`,
  `lib/live-auth.ts` e `lib/buildup-auth.ts` — ou seja, os tokens de código de acesso,
  de live e de montagem continuavam podendo ser assinados com a string do repositório.
  Agora as quatro chamam `getJwtSecret()` de `lib/jwt-secret.ts`. A lição é a
  duplicação, não o valor: enquanto cada arquivo tiver sua cópia da regra, corrigir um
  não corrige os outros. Texto original abaixo. A variável
  estava definida na Vercel (nunca houve risco ativo) e o fallback foi removido:
  `lib/auth.ts` agora tem `getJwtSecret()`, que lança se a env faltar. A checagem é no
  USO e não no carregamento do módulo, para não quebrar builds de ambientes que não
  assinam token — verificado, `next build` compila sem a variável.
- Advisor também reporta políticas em `auth.users` / `auth.sessions` (`Allow read users`
  etc.). Schema `auth` é do Supabase — confirmar se foram criadas por engano.

### 1.8 O que já nasceu certo — NÃO mexer

Criado em 04/08/2026, com RLS real desde o primeiro dia. Um `get_advisors` vai listar
algumas dessas funções; são deliberadas.

| objeto | acesso | por quê |
|---|---|---|
| `events`, `event_days` | **fechados** para `anon` e `authenticated` | todo acesso por API route com service role |
| `app_settings` | **fechada** | idem |
| `day_executions` | **fechada**; escrita só via `record_day_execution()` | o upsert do PostgREST exigiria SELECT de tabela — a função é o único caminho de entrada |
| `record_day_execution()` | `SECURITY DEFINER`, execute para `anon` | deliberado e mínimo: grava uma tabela, valida entrada, não devolve nada |
| `server_health()` | `SECURITY DEFINER`, execute **só** para `service_role` | `pg_replication_slots` não é acessível pelo PostgREST |
| `link_event_by_parent_code()` | `SECURITY DEFINER` | preenche `event_id` a partir do código do container |
| `powerpoint_fill_project_code()` | trigger comum | preenche `project_code` a partir do `id` |

**~~Ponto em aberto~~ RESOLVIDO em 05/08/2026:** o painel `/dono` é protegido por
`OWNER_USER_ID` (variável de ambiente na Vercel, fora do banco de propósito — `users`
aceitava escrita anônima, então qualquer coluna `is_owner` seria autoatribuível). A
variável foi configurada (`6c49e30c-ba02-4e7e-802e-41c2b7169f00`), então o `/dono`
deixou de vazar o faturamento para os outros admins. Nota: `users` não aceita mais
escrita anônima (Fase 0), mas manter a checagem fora do banco continua certo — é defesa
em profundidade.

### 1.9 O que mudou no egress (contexto para a Fase 4)

Aplicado em 04/08/2026: `ontime_realtime` saiu de `REPLICA IDENTITY FULL` para
`USING INDEX`; seis índices sem uso foram dropados; `powerpoint_realtime` ganhou
`project_code` com trigger e a assinatura do site passou a filtrar por projeto no
servidor. Os dashboards deixaram de assinar `postgres_changes`.

Consequência para este plano: **as 6 páginas de espectador ainda leem
`ontime_realtime` direto** — a Fase 4 continua valendo integralmente.

---

## 2. O que já existe e serve de fundação

Isto **não é uma reescrita do zero.** Três peças certas já estão no lugar:

1. **JWT próprio, HS256, 24h** — `lib/auth.ts:140` `generateAuthToken()`, com
   `userId`, `sessionId`, `isAdmin`, `licenseExpiresAt`. Emitido por
   `/api/auth/login` e `/api/auth/desktop/login`. **O desktop já recebe esse token.**
2. **Cliente service-role no servidor** — `lib/supabase-server.ts`, usado pelas rotas de
   auth e de users. O padrão certo já existe; só não é usado em todo lugar.
3. **Controle de sessão** — `user_sessions` + `user_machine_licenses` + limite de máquinas
   (`countUniqueActiveMachines`, `check_max_sessions`).

O que falta é **conectar o token que você já emite à autorização do banco**. Hoje o JWT só
é verificado pelas rotas Next.js; o Supabase nunca o vê.

---

## 3. A decisão de arquitetura

### Opção A — fazer o Supabase confiar no seu JWT

Assinar o token com o **JWT secret do projeto Supabase** e incluir os claims que o
PostgREST espera (`role: 'authenticated'`, `sub`, `exp`) mais os seus
(`user_id`, `is_admin`). O cliente browser passa a usar esse token no `Authorization`, e
as políticas passam a poder dizer coisas de verdade:

```sql
CREATE POLICY "dono lê seu projeto" ON public.ontime_realtime
  FOR SELECT TO authenticated
  USING (user_id = (auth.jwt() ->> 'user_id')::uuid);
```

**A favor:** mantém o acesso direto ao Supabase, que é o que o Realtime exige; reaproveita
o login que já existe; uma policy vale para REST *e* para Realtime ao mesmo tempo.

**Contra / verificar:** o Supabase está migrando de segredo HS256 compartilhado para
chaves de assinatura assimétricas. **Confirmar no painel do projeto qual modo está ativo
antes de desenhar em cima** — muda como o token é assinado.

### Opção B — tudo atrás de API routes com service role

Nenhuma chamada do browser toca o Supabase; tudo passa por `/api/*`, que valida o JWT e
usa `supabaseServer`.

**A favor:** simples de auditar, um só lugar para autorizar, rate limit e quota.
**Contra:** não resolve Realtime — para assinar um canal, o browser fala direto com o
Supabase e precisa de um token de qualquer jeito. Também dobra o código de CRUD.

### Recomendado: híbrido

| superfície | caminho | por quê |
|---|---|---|
| CRUD administrativo (`users`, `sales`, `user_sessions`, `licenses`) | **Opção B** (API route + service role) | não precisa de realtime; é o dado mais sensível; menos superfície |
| Dados de projeto (`ontime_realtime`, `powerpoint_realtime`) para o **desktop** | **Opção A** (JWT com claim de projeto) | precisa escrever direto e em tempo real |
| Páginas públicas de espectador (`AB`, `cliente`, `cliente-tv`, `equipe`, `leitura`, `notes`) | **nem uma nem outra: nenhum acesso ao banco** | snapshot pela rota Next.js com cache (§5.3) + broadcast privado com token curto |

A terceira linha é a chave: hoje o espectador precisa de acesso de leitura ao banco porque
lê a linha direto. Se o snapshot vier por uma rota do Next.js e o tempo real por um canal
de broadcast autorizado, **o espectador deixa de precisar de qualquer permissão no
Postgres** — e o `anon` pode ser fechado sem quebrar as telas públicas.

---

## 4. Mapa de quebras

O que exatamente para de funcionar ao fechar cada porta. É este mapa que define a ordem.

### 4.1 Tabela `users` — 5 páginas quebram

| arquivo | operação | substituir por |
|---|---|---|
| `app/dashboard/clients/page.tsx:85` | `select` de todos os clientes | `GET /api/users` (já existe) |
| `app/dashboard/clients/page.tsx:143` | `insert` de cliente | `POST /api/users` (já existe) |
| `app/dashboard/clients/page.tsx:183` | `delete` de cliente | `DELETE /api/users/[id]` (já existe) |
| `app/dashboard/clients/page.tsx:224` | `update password_hash` | **rota nova** — hash no servidor |
| `app/dashboard/cliente-settings/page.tsx:217` | `select password_hash` | **rota nova** — `POST /api/auth/change-password`, comparação no servidor |
| `app/dashboard/cliente-settings/page.tsx:290` | `update` de cores | rota nova ou `PATCH /api/users/[id]` |
| `app/dashboard/sales/page.tsx:166,215` | `select` de usuários | `GET /api/users` |
| `app/dashboard/sales/page.tsx:478` | `update` de usuário | `PATCH /api/users/[id]` |
| `app/dashboard/projects/new/page.tsx:1230,1260,1543` | `select` de cores/nome | incluir no payload do login, ou rota `GET /api/me` |
| `app/edit/[…]/page.tsx:203,244,380` | `select` de `is_admin`/`nome_empresa` | `GET /api/me` + `GET /api/project/[code]/meta` |

> **Correção de 05/08/2026 — este parágrafo estava errado.** Dizia que
> `app/api/users/route.ts` e `app/api/users/[id]/route.ts` já serviam. Não serviam:
> aquelas rotas mexem no `auth.users` do **Supabase Auth** (o cadastro dos gestores),
> não em `public.users`, e são guardadas por token do Supabase Auth em vez do JWT
> próprio. São de outro sistema — quem as usa é só `app/dashboard/users`.
> As rotas de `public.users` tiveram de ser escritas do zero: `/api/clients`,
> `/api/clients/[id]`, `/api/clients/[id]/password`, `/api/me`,
> `/api/auth/change-password`, `/api/sales`, `/api/sales/[id]` e
> `/api/project/[code]/edit-permission`. **Feito.**

### 4.2 Tabela `ontime_realtime` — 51 SELECT espalhados

Três consumidores com necessidades diferentes:

1. **Espectador** (páginas públicas): precisa de `data`, `company_name`, cores.
   → passa a vir da rota de snapshot (§5.3). Não precisa de acesso ao banco.
2. **Desktop**: precisa de `upsert` da própria linha e `select` de `changes`.
   → JWT com claim do projeto (Opção A).
3. **Dashboard/edição**: precisa de listagem e escrita.
   → API routes com service role.

**Ferramenta útil aqui:** o Postgres tem GRANT por coluna, e o PostgREST respeita.
Dá para manter leitura pública do conteúdo do show e esconder os segredos, sem partir a
tabela:

```sql
REVOKE SELECT ON public.ontime_realtime FROM anon;
GRANT SELECT (id, project_code, data, updated_at, company_name,
              background_color, header_color, content_color)
  ON public.ontime_realtime TO anon;
-- access_code, edit_access_codes, edit_share_links, user_id, changes ficam de fora
```

**Cuidado:** com GRANT por coluna, qualquer `select('*')` passa a dar erro. Auditar todos
os `select('*')` em `ontime_realtime` antes. É uma medida ponte, útil enquanto §5.3 não
está pronta.

### 4.3 As 6 tabelas sem RLS — **de 6 para 4** em 05/08/2026

Eram `live_events`, `event_buildups`, `event_buildup_access`, `buildup_tasks`,
`buildup_files`, `join_attempts`. Duas saíram:

- `event_buildup_access` — **fechada.** Guardava `access_code`, a senha das páginas
  `/buildup/*`; um `select` listava a senha de todos os eventos de todos os clientes.
  As três funções que a tocavam do navegador passaram por `/api/buildup/access/code`.
- `join_attempts` — **apagada** junto com o módulo houseriafile (ver §4.5).

Restam quatro: `live_events`, `event_buildups`, `buildup_tasks`, `buildup_files`. São
CRUD de feature inteira feito do navegador, inclusive de páginas públicas — fechá-las
exige a Fase 2. Meia-policy ali seria pior que nenhuma.

### 4.5 O módulo houseriafile foi REMOVIDO (05/08/2026)

Decisão do dono do produto: a feature está aposentada e será refeita fora deste
banco, sobre Cloudflare R2. Não foi desligada — foi apagada.

Isso importa para este plano mais do que parece, porque o módulo respondia por boa
parte da superfície anônima que sobrava depois da Fase 0:

| removido | por que contava |
|---|---|
| `join_session()` | era a **última** função `SECURITY DEFINER` executável pelo `anon` além da deliberada `record_day_execution()` |
| `sessions`, `session_members`, `files`, `file_locations`, `session_links`, `join_attempts` | 6 tabelas com grant para `anon`/`authenticated` |
| `create_session`, `is_member`, `is_session_owner`, `clear_my_file_locations`, `get_my_storage_usage`, `list_session_storage_paths`, `check_user_quota`, `gen_session_code` | 8 funções `SECURITY DEFINER` |
| bucket `drops` + 3 policies | 2 arquivos de teste, ~40 MB |
| `app/f/`, `lib/houseriafile/` | 11 arquivos no site |

E destravou o principal: **o login anônimo do Supabase pôde ser desligado.** Ele
existia só para este módulo, e era a porta pela qual qualquer visitante virava
`authenticated` numa chamada — o que tornava `TO authenticated` uma barreira de
mentira em qualquer policy do projeto (foi assim que `software_versions` ficou
gravável por qualquer um).

Conferido antes de apagar: nenhuma FK de fora apontava para as tabelas, nenhuma
função ou view externa as citava, o desktop não conhecia o módulo, e a última
atividade era de 16/05/2026.

### 4.4 Desktop em campo

O desktop instalado nas máquinas dos clientes escreve com a anon key. **Qualquer aperto no
RLS de `ontime_realtime` derruba as versões antigas.** Precisa de:

- período de convivência: aceitar token novo **e** anon, com métrica de quantos ainda usam
  anon;
- um corte com data anunciada;
- `software_versions` já existe — dá para usar para forçar atualização.

Este é o item de maior atrito de todo o plano. Começar por ele.

---

## 5. Fases

### Fase 0 — Contenção — **TODA FEITA em 05/08/2026** ✅

> Os 7 itens abaixo estão em produção, verificados com a chave anônima real e com um
> evento de teste ao vivo. Ficam com o texto original para registro do método.

Ordenada por "risco removido ÷ esforço":

1. ~~**Verificar `JWT_SECRET` em produção.**~~ **FEITO** (ver §1.7). E o
   `OWNER_USER_ID` na Vercel — **também feito** (§1.8).
2. ~~**Fechar `users` ao `anon`.**~~ **FEITO** — as 5 páginas foram apontadas para
   `/api/clients`, `/api/me`, etc. antes de fechar (§4.1).
3. ~~**Tirar a troca de senha do navegador.**~~ **FEITO** — `/api/auth/change-password`,
   comparação e hash no servidor.
4. ~~**Fechar `user_sessions`, `user_machine_licenses`, `sales`.**~~ **FEITO.**
5. ~~**Revogar `EXECUTE` de `anon`** nas funções `SECURITY DEFINER`.~~ **FEITO** — e o
   grupo do houseriafile foi removido por completo depois (§4.5), sobrando só
   `join_session`? não: **essa também saiu**. Abertas de propósito: `record_day_execution`.
6. ~~**Corrigir a policy `teste` em `realtime.messages`** e as anon de `storage.objects`.~~
   **FEITO** (a `teste` removida, verificado que broadcast segue funcionando;
   `buildup_files_anon_delete/update` removidas, exclusão de arquivo movida para rota).
7. **Assumir os hashes como vazados**: forçar troca de senha na próxima entrada.
   **PENDENTE** — é o item 0.7, adiado de propósito para depois da Fase 1 (feita).
   Decisão de produto de quando (atrito com o cliente).

### Fase 1 — Senhas de verdade — **FEITA em 05/08/2026** ✅

- ~~Trocar SHA-256 sem salt por bcrypt ou Argon2id, só no servidor.~~ **Argon2id**
  (m=19 MiB, t=2, p=1), em `lib/password.ts` (`server-only`). Provado em produção.
- ~~Migração transparente no login.~~ Feito: `verifyAndUpgradePassword` re-hasheia no
  login bem-sucedido. Conferido em produção — a conta do dono migrou no 1º login.
- ~~Ligar *leaked password protection*.~~ **Ligado** no painel (protege as senhas de
  gestor, que vivem no Supabase Auth; as de cliente passam pelo nosso código).

### Fase 2 — Token que o banco entende

> **Mecanismo PROVADO em 05/08/2026.** O `SUPABASE_JWT_SECRET` foi configurado
> (local + Vercel) e o `token-aceito.mjs` passou inteiro: token com segredo
> errado → 401; com segredo certo → aceito como `authenticated` com
> `user_id`/`is_admin` legíveis; anon segue anon. **O Supabase confia no nosso
> token e uma policy consegue ler `auth.jwt() ->> 'user_id'`.** Tudo aditivo:
> `lib/supabase-token.ts` não é importado em lugar nenhum ainda, então nada
> mudou de comportamento.
>
> **O que falta NÃO é mais Fase 2 — é acoplamento.** Toda tabela que resta
> (`ontime_realtime`, `powerpoint_realtime`, e as 4 de buildup/live) é
> compartilhada entre o cliente logado, o desktop em campo (Fase 3) e o
> espectador público (Fase 4). Não dá para trocar a `USING (true)` de nenhuma
> delas por uma policy real sem migrar as outras pontas junto. Logo: emitir o
> token no login e ligar o cliente a ele só faz sentido casado com a primeira
> policy real, que por sua vez exige Fase 3 ou 4. **Próximo alvo natural: Fase
> 4 (tirar o espectador do banco), cujo primeiro passo — a rota de snapshot —
> é seguro e é o que destrava fechar `ontime_realtime`.**

**Feito:**
- `houseriasite/lib/supabase-token.ts` — `mintSupabaseToken()` emite um token
  assinado com o **segredo do projeto Supabase** (não o nosso `JWT_SECRET`),
  com `role/aud/sub/exp` + claims `user_id`/`is_admin`. `sub = public.users.id`
  de propósito, para `auth.uid()` já bater com a coluna de dono.
- `public.whoami()` — diagnóstico read-only que devolve o que o PostgREST leu
  do token de quem chama (só o próprio; anônimo vê `role=null`).
- `scripts/guardas/token-aceito.mjs` — prova de fora: token com segredo errado
  recusado (401), com segredo certo aceito e claims legíveis, anon segue anon.
  A parte anônima já passou; as outras duas esperam o segredo.

**BLOQUEIO 1 — o segredo.** `mintSupabaseToken` precisa do **Legacy JWT Secret**
do projeto (Supabase > Settings > API > JWT Settings). NÃO é a anon key nem a
service role key — é o segredo com que ELAS foram assinadas. Sem ele o servidor
não emite token que o Supabase aceite. Vai como env var `SUPABASE_JWT_SECRET`
(local + Vercel).

**BLOQUEIO 2 — identidade do gestor.** Cliente entra pelo nosso JWT → mintamos
um token Supabase com `sub = public.users.id`. Gestor entra pelo Supabase Auth →
já tem token Supabase, mas com `sub = auth.users.id` (id DIFERENTE) e SEM os
claims `user_id`/`is_admin` que controlamos. Uma policy `user_id = auth.jwt()
->> 'user_id'` funciona para o cliente e falha para o gestor. Duas saídas:
  - **(A) Custom Access Token Hook**: uma função que o Supabase chama ao emitir
    o token do gestor, injetando `user_id` (o `public.users.id` dele) e
    `is_admin`. Uniformiza os dois tokens. Mais infra, mais limpo.
  - **(B) Gestor só por API route (service role), nunca direto no Supabase.**
    Aí a policy só precisa lidar com o token do cliente. Mais simples — e o
    dashboard já é polling, não Realtime, então o gestor nem precisa de acesso
    direto.

  **→ ESCOLHIDO em 05/08/2026: opção (B).** Consequências para o desenho das
  policies:
  - o token mintado (`mintSupabaseToken`) é só para o CLIENTE, para acesso
    direto ao Supabase (Realtime) aos dados dele;
  - toda superfície de gestor (dashboard, edição-como-gestor, todo CRUD admin)
    passa por API route com service role — várias já passam;
  - a forma canônica de policy de dono fica **`auth.uid() = user_id`** (o
    cliente; `sub` = `public.users.id`), sem precisar tratar dois formatos de
    identidade;
  - o gestor não aparece nas policies porque não chega por elas — chega pelo
    service role, que faz bypass de RLS.

**Depois dos dois bloqueios:**
- Confirmar no painel: segredo HS256 legado ou signing keys assimétricas.
  (Já confirmado em 05/08: HS256 legado — reconfirmar antes de aplicar.)
- `generateAuthToken()` passa a emitir token aceito pelo Supabase, com
  `role: 'authenticated'` e claims `user_id` / `is_admin`.
- Cliente browser passa a mandar esse token; `supabase` deixa de operar como `anon` para
  usuário logado.
- Escrever as políticas reais, tabela a tabela, **substituindo** as `true` (não adicionar
  ao lado: policies são OR, uma `true` sobrevivente anula todas as outras).

> Armadilha: RLS é permissivo por padrão. Deixar `Allow public upsert` no lugar enquanto
> se adiciona a policy nova não protege nada. **Dropar as antigas na mesma transação.**

### Fase 3 — Escrita do desktop com identidade

- `/api/auth/desktop/login` passa a devolver, além do token de sessão, um **token de
  projeto** com claim `project_code`.
- Policy: `USING (id = auth.jwt() ->> 'project_code')` — o desktop escreve só a linha dele.
- Convivência + corte por versão (§4.4).

### Fase 4 — Espectador sem acesso ao banco

> **Começada em 05/08/2026:** a rota de snapshot (Fase B4 do egress) está FEITA
> e PROVADA — ver aquele plano. Ela já resolve o gate de acesso melhor que hoje:
> para projeto com código, recusa os dados sem o cookie (401). Falta ligar as 6
> páginas a ela, mover o tempo real para broadcast (B2) e só então o REVOKE.

- Snapshot pela rota Next.js com cache de CDN (é a **Fase B4 do plano de egress**). **Rota feita.**
- Tempo real por **broadcast privado**, com token curto emitido pelo site quando o
  visitante apresenta o código de acesso.
- Aí sim: `REVOKE` geral de `anon` em `ontime_realtime` e `powerpoint_realtime`.
- `access_code` / `edit_access_codes` saem da tabela lida publicamente e viram tabela
  própria, sem GRANT para `anon`, consultada só pelo servidor.

### Fase 5 — Guarda-corpos — **FEITA em 05/08/2026** ✅

Implementada em `houseriasite/scripts/guardas/`, ligada ao `npm run build` (via
`prebuild`) e ao workflow `.github/workflows/guardas.yml` (push, PR e semanal —
uma regressão de RLS pode entrar por fora do repositório, alguém mexendo no painel).

| item do plano | como ficou |
|---|---|
| teste de policy com a anon key | `anon-nao-alcanca.mjs` — tenta ler 7 tabelas e executar 5 funções, e tenta o `PATCH users {is_admin:true}`. Falha o CI se qualquer uma responder. |
| proibir `NEXT_PUBLIC_` indevido | `padroes-de-codigo.mjs`, allowlist de 2 variáveis |
| `postgres_changes` sem `filter` | idem, com lista de exceções datadas e justificadas |
| acesso direto a tabela sensível fora do servidor | idem — lista de exceções **vazia** de propósito |

Duas correções sobre o plano original:

- **`get_advisors` no CI ficou de fora.** Exigiria um token de management API como
  secret, e o `anon-nao-alcanca` cobre o que importa de forma mais direta: em vez de
  perguntar ao advisor se está fechado, ele tenta abrir.
- O `anon-nao-alcanca` também verifica as portas que seguem abertas **de propósito**
  (`ontime_realtime`, `powerpoint_realtime`, `software_versions`) e avisa se alguma
  fechar sem querer. Deixar isso implícito era como o silêncio voltaria.

---

## 6. Ordem, risco e o que quebra

| # | Ação | Risco | Estado |
|---|---|---|---|
| 0.1 | `JWT_SECRET` | — | ✅ feito |
| 0.1b | `OWNER_USER_ID` na Vercel | nenhum | ✅ feito |
| 0.2 | páginas de `users` → API routes | médio | ✅ feito |
| 0.3 | senha só no servidor | baixo | ✅ feito |
| 0.4 | fechar `users`/`sessions`/`sales` ao anon | baixo *após* 0.2 | ✅ feito |
| 0.5 | revogar EXECUTE das funções | médio | ✅ feito (+ houseriafile removido) |
| 0.6 | `realtime.messages` + storage | médio | ✅ feito |
| 1 | Argon2id | baixo | ✅ feito e provado |
| 5 | guarda-corpos | baixo | ✅ feito (CI + pentests) |
| 2 | JWT aceito pelo Supabase | **alto** | 🟡 mecanismo provado; falta acoplar |
| 3 | token de projeto no desktop | **alto** | ⬜ pendente (precisa convivência) |
| 4 | espectador sem banco | médio | 🟡 rota de snapshot feita; falta ligar |

> A ordem de execução real foi diferente da numérica: a Fase 5 (guardas) foi feita
> junto da Fase 0, para travar o que estava sendo fechado. As Fases 2, 3 e 4 são a
> próxima janela — e as três se entrelaçam com a Fase B do egress (ver §7).

---

## 7. Por que fazer junto com o plano de egress

Não é coincidência que os dois planos convirjam:

- **Egress B4** (snapshot atrás de rota Next.js com CDN) é exatamente o que a
  **Segurança Fase 4** precisa para tirar o espectador do banco. Uma implementação, dois
  problemas.
- **Egress B1/B2** (tudo por Broadcast) só é seguro se `realtime.messages` tiver policy
  real — que é a **Segurança 0.6**. Fazer o egress primeiro sem isso troca um problema de
  custo por um de acesso.
- Ambos exigem tocar os mesmos arquivos: as 6 páginas de espectador, o
  `use-powerpoint-groups`, o `SupabaseAdapter` e o `powerpoint-supabase.service`.

Sequência sugerida:

```
Segurança Fase 0  →  Egress Fase A  →  Segurança 1 e 2  →  Egress B + Segurança 3 e 4  →  guarda-corpos
   (contenção)        (para a sangria)   (fundação)          (juntos, mesmos arquivos)
```

---

## 8. O que ainda precisa ser levantado

Coisas que não dá para decidir sem informação que não está no código:

1. ~~**Modo de JWT do projeto Supabase**~~ — **RESPONDIDO em 05/08/2026: HS256 legado.**
   O JWKS do projeto (`/auth/v1/.well-known/jwts.json`) devolve `{"keys":[]}` e a
   própria anon key é um JWT `alg: HS256`. Ou seja, a **Opção A da §3 é viável como
   desenhada**: dá para assinar o token do site com o segredo do projeto e o PostgREST
   aceita. Ressalva: o Supabase está migrando para chaves assimétricas — se o projeto
   for rotacionado para signing keys, a Fase 2 precisa ser refeita. Confirme o modo de
   novo imediatamente antes de implementar.
2. **Quantos desktops em campo** e em que versões. Define a janela de convivência da
   Fase 3.
3. ~~**`JWT_SECRET` está setado em produção?**~~ **Está.** Resolvido.
4. **Limites do plano Supabase atual** (conexões simultâneas de Realtime, mensagens/s).
   Não é segurança, mas é o próximo teto ao escalar — e o plano de egress muda de
   prioridade dependendo do número.
5. **As 11 funções `SECURITY DEFINER`** precisam ser lidas uma a uma. `join_session` e
   `create_session`, em particular, parecem ser o mecanismo do houseriafile e podem ter
   sido feitas para serem públicas mesmo.
