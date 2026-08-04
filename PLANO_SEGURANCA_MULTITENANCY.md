# Plano de segurança e multi-tenancy (pré-requisito para escalar)

> Status: **plano, nada aplicado.**
> Projeto Supabase: `gxcgwhscnroiizjwswqv`.
> Companion de [PLANO_OTIMIZACAO_EGRESS.md](./PLANO_OTIMIZACAO_EGRESS.md) — os dois se
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
hardcoded no desktop ([SupabaseAdapter.ts:405](apps/server/src/adapters/SupabaseAdapter.ts)).
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
- **`JWT_SECRET` tem fallback literal** em `lib/auth.ts:6`:
  `process.env.JWT_SECRET || 'fallback-secret-change-in-production'`. Se a env não estiver
  setada em produção, os tokens são forjáveis por qualquer um que leia o repositório.
  **Verificar isso é a primeira coisa a fazer.**
- Advisor também reporta políticas em `auth.users` / `auth.sessions` (`Allow read users`
  etc.). Schema `auth` é do Supabase — confirmar se foram criadas por engano.

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

Boa notícia: `app/api/users/route.ts` e `app/api/users/[id]/route.ts` **já existem** e já
usam service role. Falta apontar as páginas para elas e criar as 2–3 rotas que faltam.

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

### 4.3 As 6 tabelas sem RLS

`live_events`, `event_buildups`, `event_buildup_access`, `buildup_tasks`, `buildup_files`,
`join_attempts` — ligar RLS **quebra tudo que as toca** enquanto não houver política.
Tratar módulo a módulo (buildup e live são features separadas), não de uma vez.

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

### Fase 0 — Contenção (dias, antes de qualquer refactor)

Ordenada por "risco removido ÷ esforço":

1. **Verificar `JWT_SECRET` em produção.** Se estiver usando o fallback, todo token é
   forjável. Se estiver, rotacionar imediatamente (invalida sessões — comunicar).
2. **Fechar `users` ao `anon`.** Requer §4.1 primeiro: apontar as 5 páginas para as API
   routes. É o maior risco e tem a maior parte da infra pronta.
3. **Tirar a troca de senha do navegador.** Rota nova, comparação e hash no servidor.
4. **Fechar `user_sessions`, `user_machine_licenses`, `sales`** — nada no browser precisa
   delas depois do passo 2.
5. **Revogar `EXECUTE` de `anon`** nas 11 funções `SECURITY DEFINER`, exceto as que forem
   comprovadamente de uso público.
6. **Corrigir a policy `teste` em `realtime.messages`** e as policies anon de
   `storage.objects` (`buildup_files_anon_delete/update`).
7. **Assumir os hashes como vazados**: forçar troca de senha na próxima entrada. Fazer
   *depois* da Fase 1, para a nova senha já nascer com hash decente.

### Fase 1 — Senhas de verdade

- Trocar SHA-256 sem salt por **bcrypt (cost ≥ 12) ou Argon2id**, só no servidor.
- Migração transparente: no login, se o hash for do formato antigo e a senha bater,
  re-hashear e regravar. Sem big bang.
- Ligar *leaked password protection* se migrarem para o Supabase Auth (advisor aponta que
  está desligado).

### Fase 2 — Token que o banco entende

- Confirmar no painel: segredo HS256 legado ou signing keys assimétricas.
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

- Snapshot pela rota Next.js com cache de CDN (é a **Fase B4 do plano de egress**).
- Tempo real por **broadcast privado**, com token curto emitido pelo site quando o
  visitante apresenta o código de acesso.
- Aí sim: `REVOKE` geral de `anon` em `ontime_realtime` e `powerpoint_realtime`.
- `access_code` / `edit_access_codes` saem da tabela lida publicamente e viram tabela
  própria, sem GRANT para `anon`, consultada só pelo servidor.

### Fase 5 — Guarda-corpos

1. `get_advisors` de segurança no CI, falhando o build em nível ERROR.
2. Teste de policy: um script que, com a anon key, tenta ler `users` e escrever
   `ontime_realtime` — **tem que falhar**. Se passar, o build quebra.
3. Proibir `NEXT_PUBLIC_` em qualquer coisa que não seja URL e anon key.
4. Nenhuma policy nova com `USING (true)` sem comentário justificando.

---

## 6. Ordem, risco e o que quebra

| # | Ação | Risco | Quebra o quê |
|---|---|---|---|
| 0.1 | verificar/rotacionar `JWT_SECRET` | baixo | derruba sessões ativas se rotacionar |
| 0.2 | páginas de `users` → API routes | médio | 5 páginas de dashboard, se errar rota |
| 0.3 | senha só no servidor | baixo | tela de troca de senha |
| 0.4 | fechar `users`/`sessions`/`sales` ao anon | baixo *após* 0.2 | nada, se 0.2 estiver completo |
| 0.5 | revogar EXECUTE das funções | médio | módulo houseriafile (`join_session` etc.) |
| 0.6 | `realtime.messages` + storage | médio | upload/delete de buildup |
| 1 | bcrypt/Argon2 | baixo | nada (migração transparente) |
| 2 | JWT aceito pelo Supabase | **alto** | tudo que fala com o banco pelo browser |
| 3 | token de projeto no desktop | **alto** | desktops não atualizados |
| 4 | espectador sem banco | médio | páginas públicas; casa com egress B4 |
| 5 | guarda-corpos | baixo | nada |

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

1. **Modo de JWT do projeto Supabase** (HS256 legado × signing keys). Define a Fase 2.
2. **Quantos desktops em campo** e em que versões. Define a janela de convivência da
   Fase 3.
3. **`JWT_SECRET` está setado em produção?** Define se a Fase 0.1 é urgência ou rotina.
4. **Limites do plano Supabase atual** (conexões simultâneas de Realtime, mensagens/s).
   Não é segurança, mas é o próximo teto ao escalar — e o plano de egress muda de
   prioridade dependendo do número.
5. **As 11 funções `SECURITY DEFINER`** precisam ser lidas uma a uma. `join_session` e
   `create_session`, em particular, parecem ser o mecanismo do houseriafile e podem ter
   sido feitas para serem públicas mesmo.
