# Plano — Pasta de evento, cobrança por evento e painel do dono

> Status: **plano, nada implementado.**
> Mockup aprovado: painel do dono, pasta de evento e relatório com abrangência.
> Repos: `houseriasite` (tudo) e `ontimeHOUSERIA` (nada — ver §8).

---

## 1. Decisões travadas

| decisão | escolha |
|---|---|
| Valor do evento | **Um valor fechado** na pasta. Sem itens extras nem tabela por porte. |
| Quem cria | **O cliente**, e cria **o evento**, não o dia. Os dias nascem dentro da pasta. |
| Montagem | Criada **dentro da pasta**, valendo para o evento inteiro. |
| Painel do dono | **Rota própria, só o dono.** Cliente não vê valores nem saúde do servidor. |
| Relatório | Evento inteiro **ou** dia a dia, escolhido na emissão. |

---

## 2. O problema, em uma frase

Hoje uma linha de `ontime_realtime` é ao mesmo tempo **o dia** (o rundown que o desktop
escreve) e **a pasta** (`event_buildups.parent_project_code` e
`live_events.parent_project_code` apontam para ela). Os dois papéis colidem: a montagem
gruda num dia escolhido a esmo e a cobrança não tem onde se apoiar.

A correção é separar os dois papéis.

---

## 3. Modelo de dados

### 3.1 Tabelas novas

```sql
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,        -- ex: TAKO-2608, usado nas URLs da pasta
  name            text not null,               -- "TAKO SUMMIT"
  subtitle        text,                        -- "Lançamento", "Congresso anual"
  client_id       uuid references public.users(id) on delete set null,
  venue           text,
  starts_on       date,
  ends_on         date,
  status          text not null default 'rascunho',
    -- rascunho | confirmado | em_andamento | concluido | cancelado
  price_cents     bigint,                      -- valor fechado do evento
  currency        text not null default 'BRL',
  billing_status  text not null default 'nao_faturado',
    -- nao_faturado | faturado | pago | cortesia
  invoiced_at     timestamptz,
  paid_at         timestamptz,
  owner_notes     text,                        -- só o dono lê
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.event_days (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  project_code  text not null unique,          -- = ontime_realtime.id
  day_index     int  not null,                 -- 1, 2, 3...
  label         text,                          -- "Abertura e keynote"
  day_date      date,
  created_at    timestamptz not null default now(),
  unique (event_id, day_index)
);

create index on public.event_days (event_id);
create index on public.events (client_id);
create index on public.events (status);
```

> `project_code` fica como `text` sem foreign key para `ontime_realtime`. A linha em
> `ontime_realtime` só passa a existir quando o desktop sobe o projeto pela primeira
> vez — uma FK impediria criar o dia antes disso, que é justamente o fluxo normal
> (planejo hoje, opero semana que vem).

### 3.2 Religação do que já existe

`event_buildups` e `live_events` apontam para um `parent_project_code`. Ganham
`event_id`, e a coluna antiga vira ponte durante a transição:

```sql
alter table public.event_buildups add column event_id uuid references public.events(id) on delete cascade;
alter table public.live_events    add column event_id uuid references public.events(id) on delete cascade;
alter table public.event_buildup_access add column event_id uuid references public.events(id) on delete cascade;

create index on public.event_buildups (event_id);
create index on public.live_events (event_id);
```

Ordem: adicionar coluna → backfill → apontar o código para a coluna nova → **só então**
parar de escrever na antiga → dropar a antiga numa janela posterior.

---

## 4. Migração do que já está no banco

São 226 dias, 24 montagens, 23 códigos de acesso de montagem e 0 `live_events`.
`live_events` vazio significa que aquele módulo não precisa de migração nenhuma.

**Passo 1 — uma pasta por montagem existente.** Toda linha de `event_buildups` já tem um
`parent_project_code`; cada código distinto vira uma pasta de um dia só:

```sql
insert into public.events (code, name, status, starts_on)
select o.id,
       coalesce(o.data->'project'->>'title', o.id),
       'concluido',
       (o.updated_at at time zone 'America/Sao_Paulo')::date
  from public.ontime_realtime o
 where o.id in (select distinct parent_project_code from public.event_buildups)
on conflict (code) do nothing;
```

**Passo 2 — cada projeto restante vira uma pasta de um dia, marcada como anterior à
virada.** Não tem como adivinhar quais dos 226 pertenciam ao mesmo evento; heurística por
nome (`| DIA2`) erraria em silêncio e sujaria o histórico. Todos viram pasta de um dia.

**Decisão tomada: a cobrança começa agora, o passado não é cobrado.** Para isso existe a
coluna `is_legacy`:

```sql
alter table public.events add column is_legacy boolean not null default false;

insert into public.events (code, name, status, billing_status, is_legacy, starts_on)
select o.id,
       coalesce(o.data->'project'->>'title', o.id),
       'concluido', 'cortesia', true,
       (o.updated_at at time zone 'America/Sao_Paulo')::date
  from public.ontime_realtime o
on conflict (code) do nothing;

insert into public.event_days (event_id, project_code, day_index, day_date)
select e.id, e.code, 1, e.starts_on
  from public.events e where e.is_legacy
on conflict (project_code) do nothing;
```

> **Migrar não é o mesmo que cobrar.** É tentador simplesmente não migrar o passado — mas
> se o dashboard passa a listar pastas, os 226 dias sem pasta **somem da tela do
> cliente**, que perde acesso a links e relatórios de eventos antigos. Sem erro, só
> sumindo. Migrando com `is_legacy = true`, nada desaparece, a interface fica uniforme, e
> toda métrica de dinheiro filtra `where not is_legacy`.

**Passo 3 — agrupamento manual: dispensado.** Como o histórico não é cobrado, não há
motivo para fundir pastas antigas. A tela `/dono/agrupar` sai do escopo.

---

## 5. Telas

### 5.1 Novas

| rota | o que é |
|---|---|
| `/dashboard/events/new` | Criar **evento** (substitui `dashboard/projects/new` no fluxo do cliente) |
| `/dashboard/evento/[code]` | A pasta: dados, dias, montagem, relatório |
| `/dono` | Painel do dono — dinheiro, ao vivo, eventos, saúde |
| `/dono/agrupar` | Fundir pastas de um dia (passo 3 da migração) |

### 5.2 Alteradas

| rota | mudança |
|---|---|
| `dashboard/projects/new` | Vira o passo "adicionar dia" **dentro** da pasta; deixa de ser porta de entrada |
| `dashboard` e `dashboard/events` | Listam **pastas**, não dias. Um evento de 3 dias vira 1 linha |
| `dashboard/buildup/[projectCode]` | Passa a ser `.../buildup/[eventCode]` |
| `dashboard/buildup/[…]/relatorio` | Ganha o parâmetro de abrangência (§6) |

### 5.3 O fluxo novo de criação

```
[Novo evento]
   ↓  nome, cliente, local, período, valor
Pasta criada (status: rascunho)
   ↓
   ├── [Adicionar dia]  → gera o projectCode, como hoje. Repete por dia.
   └── [Criar montagem] → agora nasce na pasta, não num dia
```

O gerador de `projectCode` do dia continua exatamente como é hoje. A pasta tem código
próprio (`events.code`), usado só nas URLs do painel — os links públicos de espectador
seguem por `projectCode`, sem mudança.

---

## 6. Relatório

### 6.1 Correção do que este plano dizia antes

A versão original propunha `?escopo=evento|dia`, partindo da ideia de que existiria um
relatório por dia. **Isso estava errado**, e a leitura do código mostra por quê:

- O relatório em `dashboard/buildup/[projectCode]/relatorio` é um **relatório de
  montagem**. Ele calcula tudo (`computeKpis`, `computeAnalysis`, `buildAuditTimeline`)
  sobre a lista de **tarefas de montagem** — não sobre a execução do rundown.
- `lib/buildup-crud.ts` já declara o modelo: *"cada evento (`parent_project_code`) tem
  0..N montagens"*. **Dias não têm montagem.** A montagem sempre foi do evento.

Logo, "um relatório por dia" não existe para este documento: não há conteúdo por dia
dentro dele. O que existe — e sempre existiu — é **junto ou separado por montagem**, que
é o `mode: 'single' | 'all'` já implementado. E esse já é o nível certo: um evento com
"Montagem palco" e "Montagem credenciamento" pode emitir as duas num documento ou uma em
cada.

### 6.2 O que foi feito

O cabeçalho do relatório passa a identificar o **evento** quando o código da URL é de uma
pasta: nome, descrição, período, número de dias e local. Um evento de três dias emite um
documento que se apresenta como o relatório do evento, não de um projeto solto.

`audience: 'cliente' | 'interno'` continua exatamente como estava.

### 6.3 O relatório cheio — feito

O relatório passou a cobrir também **como o evento aconteceu**, e não só a montagem.

**A descoberta que encurtou o trabalho:** o Ontime já registrava isso. O
`apps/server/src/api-data/report/report.service.ts` grava, por evento da rundown,
`{ startedAt, endedAt }` reais, disparado por `TimerLifeCycle.onStart`/`onStop`. O que
faltava era o registro sair da máquina — ele vivia num `Map` em memória, não era salvo no
arquivo do projeto e nunca chegava à nuvem. Fechou o Ontime, perdeu.

**O que foi construído:**

| peça | onde |
|---|---|
| Tabela `day_executions` (1 linha por dia) | `migrations/create_day_executions.sql` |
| Espelhamento incremental pelo desktop | `SupabaseAdapter.sendExecutionReport()` |
| Fusão planejado × real | `lib/execution.ts` |
| Rota que devolve os dias já cruzados | `app/api/execution/[code]/route.ts` |
| Seção no relatório | `components/buildup/ExecutionReportSection.tsx` |

**Divisão por audiência:** cliente vê o resumo do dia (começou, terminou, cues
executados, desvio total); interno vê cue a cue, com o desvio de cada um. Mostra domínio
sem entregar munição.

**Limitação:** só vale a partir do deploy. Eventos anteriores não têm esse histórico e não
há como reconstruir — o `data` sempre foi sobrescrito. Casa com a decisão de começar a
cobrar agora.

---

## 7. Painel do dono

### 7.1 Blocos (na ordem do mockup)

1. **Dinheiro** — a faturar, faturado no mês, recebido, previsto no trimestre, ticket
   médio. Tudo derivável de `events` com `price_cents` e `billing_status`.
2. **Agora** — eventos ao vivo, com cue atual, timer e atraso. A fonte é a projeção rasa
   de `ontime_realtime` (`data->timer->>playback`, `data->>status`), a mesma que já
   passamos a usar nos dashboards — leitura barata, sem trazer a rundown.
3. **Eventos** — a lista de pastas com situação e cobrança.
4. **Servidor** — WAL retido, conexões de realtime, egress do mês, desktops conectados.

### 7.2 Sobre o bloco 4

Não é enfeite. O painel existe para você não ser pego de surpresa, e o susto que você
teve foi de servidor, não de faturamento. Os três primeiros números vêm do
`04-runbook-de-pendencias.md` (repo do Ontime, seção "Os três números"). Precisam de uma rota
server-side que consulte `pg_replication_slots` — não dá para ler isso do browser.

### 7.3 Como proteger — e por que isso não é opcional

O painel do dono expõe **faturamento de todos os clientes numa tela só**. Hoje, com as
policies `USING (true)` documentadas em `02-seguranca-e-multitenancy.md`, qualquer
visitante do site conseguiria ler `events` direto pela anon key, com ou sem a rota
protegida.

**Portanto:** `events` nasce com RLS real desde o primeiro dia — sem GRANT para `anon` —
e o `/dono` lê tudo por API route com service role, validando o JWT. É a única tabela
nova, então dá para fazer certo de saída sem esbarrar na dívida das antigas.

```sql
alter table public.events enable row level security;
alter table public.event_days enable row level security;
revoke all on public.events from anon;
revoke all on public.event_days from anon;
-- sem policy para anon: só service role (API routes) enxerga
```

O cliente acessa a pasta dele por API route também, que filtra por `client_id` a partir
do JWT. Nenhuma leitura de `events` sai direto do browser.

---

## 8. O que NÃO muda

**O app desktop não é tocado.** Ele continua criando e escrevendo `projectCode` por dia
exatamente como hoje. A pasta é uma camada acima, no site.

Consequências boas: nenhuma atualização obrigatória nas máquinas em campo, nenhum risco
para evento rodando, e a migração pode ser feita com o sistema no ar.

---

## 9. Ordem de implementação

| # | etapa | entrega |
|---|---|---|
| 1 | Schema `events` + `event_days` com RLS fechado | migração SQL |
| 2 | API routes de evento (CRUD) com service role + JWT | `/api/events/*` |
| 3 | Tela da pasta + criar evento + adicionar dia | fluxo novo funcionando |
| 4 | Migração dos 226 dias (§4) | histórico dentro de pastas |
| 5 | Religar montagem à pasta (`event_id`) | montagem no nível certo |
| 6 | Relatório com abrangência | `?escopo=evento\|dia` |
| 7 | `/dono` — dinheiro, ao vivo, eventos | painel |
| 8 | `/dono` — bloco de saúde | rota server-side de métricas |

Etapas 1 a 3 já entregam valor sozinhas: você passa a ter a pasta e o valor por evento,
mesmo antes do painel existir.

### 9.1 Segurança de execução com evento rodando

Etapas 1 a 3 **não tocam** `ontime_realtime`, suas policies, nem as telas de espectador —
que é tudo que um evento ao vivo usa. Podem ser feitas com o sistema no ar.

O único comando que pega lock em tabela existente é o `ADD COLUMN event_id` de §3.2.
`ADD COLUMN` anulável é metadata em PG 11+, mas a foreign key exige lock exclusivo por um
instante. O risco não é a duração — é a **fila** atrás do lock. Rode sempre com:

```sql
SET lock_timeout = '3s';
```

Assim, se houver transação aberta na tabela, o comando falha rápido em vez de segurar
tudo atrás dele. Basta repetir depois. Na pior hipótese isso atrasa escritas de
**montagem** por segundos; o rundown ao vivo está em outra tabela e não é afetado.

`event_buildups` está na publicação de realtime, então os assinantes passam a receber um
campo a mais no payload. Consumidor JS ignora propriedade extra — inofensivo.

**Etapa 3 tem um cuidado de produto, não de banco:** ela altera o fluxo de criação
existente (`dashboard/projects/new`). Publique a rota nova ao lado da antiga e só troque
a porta de entrada depois — evita que alguém no meio de um cadastro veja o fluxo mudar
debaixo do pé.

---

## 10. Riscos e pontos de atenção

1. **Dia órfão.** Se sobrar qualquer caminho que crie `ontime_realtime` sem passar por
   uma pasta, ele vira evento não cobrado. Depois da etapa 3, a criação avulsa tem que
   ser fechada — não só escondida do menu.
2. **`projectCode` em URL pública.** Os links de espectador seguem por `projectCode`.
   Não trocar isso: são links que clientes já têm salvos e QR codes já impressos.
3. **Migração e ticket médio.** Se os 226 dias virarem 226 eventos, seu ticket médio
   histórico fica errado. Ou agrupa (§4 passo 3), ou marca tudo como anterior à mudança
   e calcula métricas só a partir da virada. A segunda é mais honesta e mais barata.
4. **`sales` não serve para isso.** É venda de licença por usuário e por período. O valor
   do evento fica em `events.price_cents`. Não misturar — um relatório financeiro que
   soma licença com evento não fecha com nada.
5. **`live_events` está zerado.** Ganha `event_id` junto com o resto, sem migração.
