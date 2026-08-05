# Plano de otimização de egress e Realtime (Supabase)

> **Status (05/08/2026): Fase A FEITA e em produção; Fase C feita; Fase B pendente.**
> A Fase A (índices, REPLICA IDENTITY, filtro do PowerPoint, throttle do writer) cortou
> ~90% do egress e parou a sangria que derrubou o servidor em julho. A Fase C
> (guarda-corpos, teto de payload) está feita — só o `cleanupOldProjects` foi
> cancelado de propósito (apagava histórico do cliente). Falta a **Fase B**, a que muda
> a lei de escala (custo deixa de crescer com a plateia): a rota de snapshot (B4) já
> está construída e provada; o resto mexe no desktop e vai na próxima janela. Detalhe
> item a item ao longo do documento.
> Projeto Supabase: `gxcgwhscnroiizjwswqv`.
> Repos envolvidos: `ontimeHOUSERIA` (desktop/servidor) e `houseriasite` (Next.js).

---

## 1. O que aconteceu

Com 4 projetos rodando ao mesmo tempo e muita gente conectada, o egress estourou.
A causa não é "uso alto" difuso — são quatro defeitos específicos que se multiplicam
entre si. Abaixo, cada um com a evidência.

### 1.1 `powerpoint_realtime` é assinada SEM filtro (amplificação N×)

`houseriasite/hooks/use-powerpoint-groups.ts:74-77`

```ts
.on('postgres_changes',
  { event: '*', schema: 'public', table: 'powerpoint_realtime' },  // ← sem filter
  ...)
```

O próprio comentário no arquivo explica o motivo ("o realtime do Supabase não filtra
por prefixo/LIKE, então assinamos a tabela inteira e filtramos por projeto no cliente").
O filtro no cliente economiza CPU, mas **os bytes já chegaram** — o egress é cobrado
na saída do Supabase, não no `if` do React.

Consequência: **todo espectador de qualquer projeto recebe cada atualização de PowerPoint
de todos os projetos.** Com 4 shows simultâneos, cada cliente carrega 4× o tráfego que
deveria.

Páginas afetadas (todas usam o hook): `AB`, `cliente`, `cliente-tv`, `equipe`, `notes`.

### 1.2 O writer do PowerPoint sobe a linha inteira ~1×/segundo

`ontimeHOUSERIA/apps/server/src/api-data/powerpoint/powerpoint-supabase.service.ts`

- `sendDirectToSupabase()` (linha ~534) monta o payload com o array **`slides` completo** —
  índice, título, `hidden`, `hasVideo` e **as notas de cada slide**.
- `hasStatusChanged()` (linha ~397) retorna `true` quando muda **o segundo do vídeo**
  (`status.video.seconds !== last.video.seconds`).
- `onStatusChange()` (linha ~247) **não tem throttle de tempo**. Tem só uma fila
  (`pendingStatus`) que dispara o próximo envio assim que o anterior termina.

Ou seja: enquanto roda vídeo, é **um upsert por segundo carregando todas as notas de
todos os slides**.

Tamanhos reais medidos hoje na tabela:

| id | JSON | slides |
|---|---|---|
| `F81K6` | 51.868 chars (~52 KB) | 526 |
| `LIL11` | 41.466 chars | 436 |
| `PD7420` | 24.691 chars | 116 |
| `CR7838` | 22.871 chars | 305 |
| típico | 10–25 KB | 100–300 |

### 1.3 `ontime_realtime` está com `REPLICA IDENTITY FULL`

Confirmado em `pg_class.relreplident = 'f'`.

Com `FULL`, cada `UPDATE` publica **a linha antiga E a linha nova** no WAL, e o Realtime
entrega as duas ao assinante (`payload.old` + `payload.new`). Como a coluna `data` é a
rundown inteira, **o egress dessa tabela é o dobro do necessário**.

Tamanho real da coluna `data` (JSON, que é o que trafega):

| id | JSON | eventos |
|---|---|---|
| `PG8389` | 1.513.130 chars (**~1,5 MB**) | 146 |
| `PMBD3885` | 373.781 chars | 32 |
| `AD8994` | 341.808 chars | 78 |
| `BVFY5` | 290.211 chars | 36 |
| típico | 170–370 KB | 20–45 |

Com `FULL`, uma única troca de evento no `PG8389` = **~3 MB por assinante**.

Outras tabelas com `FULL` na publication: `files`, `file_locations` (avaliar à parte —
o módulo houseriafile pode depender de `payload.old`).

### 1.4 O dashboard assina `ontime_realtime` sem filtro quando é admin

`houseriasite/app/dashboard/page.tsx:124` e `houseriasite/app/dashboard/events/page.tsx:103`

```ts
table: 'ontime_realtime',
...(clientId ? { filter: `user_id=eq.${clientId}` } : {})   // ← admin = sem filtro
```

Um admin com o dashboard aberto durante os 4 shows recebe a rundown completa de **todos
os projetos do banco**, a cada escrita, em dobro (por causa do 1.3). Uma aba esquecida
aberta é suficiente para gerar dezenas de GB.

### 1.5 O que JÁ está certo (não mexer)

A "Fase 3" do caminho do Ontime já foi feita e o padrão está correto:

- `SupabaseAdapter.broadcastHotState()` emite timer/delay/evento por **Broadcast**
  (canal `ontime-live-<code>`), sem tocar no Postgres.
- `broadcastSnapshotChanged()` avisa que o dado frio mudou.
- As 5 páginas (`AB`, `cliente`, `cliente-tv`, `equipe`, `leitura`) **derrubam o
  `postgres_changes` assim que o primeiro broadcast chega** e passam a rebaixar o
  snapshot só quando recebem `snapshot-changed`.

**O modelo certo já existe no código.** Ele só nunca foi aplicado ao PowerPoint nem ao
dashboard — e o `REPLICA IDENTITY FULL` continua encarecendo a janela em que o
`postgres_changes` ainda está ativo (todo carregamento de página passa por ela).

---

## 2. A ordem de grandeza

Cenário do incidente: 4 shows, ~40 espectadores cada = ~160 clientes conectados.

**PowerPoint** (defeitos 1.1 + 1.2):

```
4 upserts/s (um por show)  ×  160 clientes (todos recebem todos)  ×  20 KB
= 640 mensagens/s  ×  20 KB  ≈  12,8 MB/s  ≈  46 GB/hora
```

Mesmo com payload conservador de 5 KB, dá ~11 GB/hora. **Este é o vazamento principal.**

**Ontime** (defeitos 1.3 + 1.4): o broadcast já protege o regime permanente das páginas,
mas cada carregamento de página e cada aba de dashboard aberta pagam a linha inteira em
dobro. Uma troca de evento num projeto de 300 KB com 40 assinantes ainda ativos =
`300 KB × 2 × 40 ≈ 24 MB` em um único clique.

---

## 3. O princípio da solução

Uma regra só, que resolve os quatro defeitos e impede que voltem:

> **O Postgres nunca empurra linha grande.**
> Estado **quente** (timer, slide atual, vídeo) vai por **Broadcast**, com payload que
> nós controlamos.
> Estado **frio** (rundown, lista de slides com notas) fica no banco e o banco só avisa
> *"mudou"* — o cliente busca o snapshot uma vez, por um caminho cacheável.

Corolários operacionais:

1. Nenhuma assinatura de `postgres_changes` sem `filter`. Nunca.
2. Nenhuma tabela com coluna JSON grande dentro da publication `supabase_realtime`.
3. `REPLICA IDENTITY FULL` só onde alguém realmente lê `payload.old`.
4. Snapshot frio servido com cache de CDN: N espectadores do mesmo show = 1 leitura no
   Supabase.

---

## 4. Fase A — corte imediato

Objetivo: derrubar ~90% do egress mexendo pouco, de forma reversível.
Pode ser feita fora de horário de show, em ~1 dia de trabalho.

### A1. Tirar o `REPLICA IDENTITY FULL` de `ontime_realtime`

```sql
ALTER TABLE public.ontime_realtime
  REPLICA IDENTITY USING INDEX ontime_realtime_pkey;
```

Efeito: −50% no egress de realtime dessa tabela, imediato, sem tocar em código.

**Verificar antes** (é o único risco, e é real):

- Com `DEFAULT`/`USING INDEX`, `payload.old` passa a conter **apenas a chave primária**.
- `houseriasite/app/dashboard/page.tsx` e `app/dashboard/events/page.tsx` leem
  `(payload.old as any)?.user_id` em eventos `DELETE`. Vai virar `undefined`.
  → Corrigir junto com A3 (que remove essa assinatura de qualquer forma).
- Assinaturas com `filter` numa coluna que **não** é a PK deixam de receber `DELETE`
  (o Realtime não consegue avaliar o filtro sem a linha antiga). Checar
  `app/live/war/[projectCode]/page.tsx:53` (`filter: parent_project_code=eq.…` em
  `live_events` — essa tabela já é `d`, não muda) e qualquer filtro por `user_id` ou
  `project_code`.
- Para `ontime_realtime` os `DELETE` vêm só do `cleanupOldProjects()`, e nenhuma página
  reage a eles. Baixo risco.

Avaliar separadamente `files` e `file_locations` (também `FULL`) — o módulo houseriafile
pode depender do `old`; não incluir nesta fase sem checar.

### A2. Filtro por projeto no PowerPoint

O `postgres_changes` não faz `LIKE`, mas faz igualdade. Basta ter a coluna certa.

```sql
ALTER TABLE public.powerpoint_realtime ADD COLUMN IF NOT EXISTS project_code text;

-- backfill: id é `PROJETO` ou `PROJETO:grupo`
UPDATE public.powerpoint_realtime SET project_code = split_part(id, ':', 1)
  WHERE project_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_powerpoint_realtime_project_code
  ON public.powerpoint_realtime(project_code);
```

- **Writer** (`powerpoint-supabase.service.ts`, objeto `data` na linha ~534): incluir
  `project_code: this.projectCode.split(':')[0]` no upsert.
- **Leitor** (`use-powerpoint-groups.ts:76`): trocar por
  `{ event: '*', schema: 'public', table: 'powerpoint_realtime', filter: \`project_code=eq.${projectCode}\` }`
  e remover o `belongs()` do cliente (vira redundante, mas pode ficar como cinto de segurança).

Efeito: mata a amplificação de 4×. Sozinho, já corta 75% do tráfego de PPT no cenário
de 4 shows.

**Ordem de deploy importa:** o backfill e o writer primeiro; o filtro no site só depois
que todas as linhas tiverem `project_code` preenchido, senão o site para de receber
atualizações. Enquanto isso, garantir que o writer preencha a coluna em todo upsert.

### A3. Dashboard nunca assina a tabela gorda

Em `app/dashboard/page.tsx` e `app/dashboard/events/page.tsx`:

- Remover a assinatura de `postgres_changes` em `ontime_realtime`.
- Substituir por polling leve de colunas magras (`select('id, project_code, updated_at,
  user_id, company_name')`) a cada 15–30s, ou por uma tabela-sinal (ver B1).
- O dashboard é uma lista de projetos: não precisa de tempo real de sub-segundo, e nunca
  precisa da coluna `data`.

Efeito: elimina o pior caso (aba de admin esquecida aberta durante 4 shows).

### A4. Writer do PowerPoint para de subir os slides a cada segundo

Em `powerpoint-supabase.service.ts`:

1. **Separar frio de quente no payload.** O array `slides` (com as notas) só muda quando
   a apresentação muda. Manter um hash dele; se não mudou, **não reenviar o array** —
   fazer `update` só das chaves quentes.
2. **Throttle de tempo em `onStatusChange()`.** Hoje não existe nenhum. Mínimo de
   1.000–2.000 ms entre upserts, com a última posição sempre garantida (coalescing,
   nunca descartar o estado final).
3. **Tirar o segundo do vídeo do gatilho de upsert.** `video.seconds` mudando não
   justifica escrita no Postgres — isso é estado quente puro, vai para o broadcast na
   Fase B. Interinamente: só escrever quando `isPlaying` mudar ou a cada N segundos.

Efeito combinado com A2: PPT sai de ~46 GB/h para a casa de dezenas de MB/h.

### Resultado esperado da Fase A

| origem | antes | depois |
|---|---|---|
| PowerPoint | ~46 GB/h | ~0,1 GB/h |
| Ontime (janela postgres_changes) | 2× a linha | 1× a linha |
| Dashboard admin | rundown de todos | ~zero |

---

## 5. Fase B — a arquitetura definitiva

Objetivo: tornar o custo **independente do número de espectadores**.
Mexe nos dois repos e exige atualizar o app desktop junto com o site.

### B1. Tirar as duas tabelas da publication de realtime

```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.ontime_realtime;
ALTER PUBLICATION supabase_realtime DROP TABLE public.powerpoint_realtime;
```

Só depois que **todo** o tempo real estiver no Broadcast (B2/B3) e não houver cliente
antigo em campo. Este é o ponto sem volta que garante que ninguém reintroduza o problema:
não dá para assinar sem filtro uma tabela que não está publicada.

Se algum consumidor ainda precisar de "avise-me que mudou", criar uma **tabela-sinal**
magra e publicar só ela:

```sql
CREATE TABLE public.project_signal (
  project_code text PRIMARY KEY,
  version      bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_signal;
```

Payload de ~100 bytes por evento, contra 1,5 MB.

### B2. PowerPoint ganha o mesmo par que o Ontime já tem

Espelhar exatamente o que `SupabaseAdapter` já faz:

- Canal `ppt-live-<projectCode>:<groupId>`.
- Evento `slide-state` — **quente**, ~200 bytes:
  `{ currentSlide, isInSlideShow, slidesRemaining, video: { isPlaying, currentTime, remainingTime } }`.
  Pode ir a 1 Hz sem problema: 200 B × 160 clientes × 1/s ≈ 32 KB/s.
- Evento `snapshot-changed` — quando `slides`/notas mudarem. O cliente rebaixa o
  snapshot uma vez (B4).
- Do lado do site, `usePowerPointGroups` passa a ser: snapshot inicial (HTTP) + broadcast,
  com o `postgres_changes` como fallback só até o primeiro broadcast chegar — **o mesmo
  padrão de `broadcastActiveRef` que as 5 páginas já usam.** Copiar, não inventar.

### B3. Patch por evento em vez de rundown inteira

Hoje, mudar o título de um evento republica a rundown inteira (`handleRundownChange` →
`buildRundownPayload` → rundown completa). Com 146 eventos, são 1,5 MB por espectador.

Emitir `event-patch { eventId, fields }` por broadcast e reservar o snapshot completo
para o carregamento da página e para mudanças estruturais (adicionar/remover/reordenar).

### B4. Snapshot frio atrás do CDN — **ROTA FEITA E PROVADA em 05/08/2026** ✅

> A rota `houseriasite/app/api/snapshot/[projectCode]/route.ts` existe, com
> service role, e foi provada contra o banco real nos quatro caminhos (aberto,
> com-código-sem-cookie, com-código-com-cookie, inexistente). Ainda NÃO está
> ligada às páginas — é aditiva, ninguém a importa, o deploy segue inerte. O
> wiring das 6 páginas de espectador é a próxima passada, a ser feita com um
> render de teste à vista (é superfície ao vivo).
>
> **Achado que mudou o desenho:** 223 dos 228 projetos são abertos, mas 5 têm
> código e as páginas têm gate real (`AccessCodeForm`). Um cache público cego
> por projectCode furaria o gate desses 5. Por isso a rota branqueia: aberto →
> `s-maxage=30` (o ganho de egress, 98% dos casos); com código → exige o cookie
> `access_token_<code>` e responde `private, no-store`. Para os 5 protegidos a
> rota é MAIS forte que o SELECT direto de hoje — recusa sem o cookie.
>
> Falta para o REVOKE de `anon` (que é o objetivo final): a assinatura de
> Realtime ainda toca `ontime_realtime` (item B2). O snapshot é só um dos
> pré-requisitos.

#### (original)


O `select('data')` direto no PostgREST cobra egress do Supabase por espectador.
Trocar por uma rota Next.js:

```
GET /api/snapshot/[projectCode]
Cache-Control: public, s-maxage=30, stale-while-revalidate=300
```

A rota lê do Supabase (server-side) e a Vercel serve o resto do CDN.
**40 espectadores do mesmo show = 1 leitura no Supabase.** O egress desse caminho vai
essencialmente a zero, e a invalidação vem do `snapshot-changed` (o cliente busca com
`?v=<version>` para furar o cache quando precisa).

### B5. Higiene do payload

- Não enviar `video.sourceUrl` (caminho de arquivo local, inútil na nuvem e vaza estrutura
  de pastas da máquina).
- Notas de slide: truncar em algo como 2 KB por slide — ninguém lê 10 KB de nota na TV.
- `filterRundownForSupabase()` já tira `skip=true`; considerar também remover campos que
  nenhuma tela usa (`revision`, `linkStart`, `dayOffset`, `timeStrategy`…) antes de subir.

---

## 6. Fase C — guarda-corpos (para não voltar)

> **Estado em 05/08/2026:** C1, C2 e C5-parcial **feitos**; C3 e C4 pendentes por
> motivos diferentes — ver abaixo, item a item.

1. ~~**Lint/teste que falha**~~ — **FEITO.** `houseriasite/scripts/guardas/padroes-de-codigo.mjs`,
   ligado ao `prebuild` e ao CI. Não é um grep: casa as chaves do objeto de config para
   não acusar comentário nem string de tipo. A primeira versão, feita com "as próximas 8
   linhas", acusou 47 violações das quais quase todas eram falso positivo — um linter
   assim é desligado no primeiro dia.
2. ~~**Teto de payload no writer**~~ — **FEITO.** `powerpoint-supabase.service.ts`:
   aviso alto acima de 64 KB dizendo QUAL parte pesa (`slides=… videoItems=…`), e as
   notas de slide truncadas em 2.000 caracteres (item B5, que estava solto). O
   `video.sourceUrl` também deixou de subir — era o caminho do arquivo na máquina do
   operador, numa tabela de leitura pública. O caminho de fallback
   (`sendToOntimeRealtime`) recebeu o mesmo teto: deixar os dois diferentes é como o
   problema volta.
3. **Telemetria por show**: contar bytes emitidos por projeto/sessão e mostrar no painel
   do Ontime. O `lib/usage-monitor.ts` já existe mas só conta requests no console e não é
   usado em lugar nenhum — ou liga de verdade, ou apaga.
4. ~~**`cleanupOldProjects()` fora do toggle**~~ — **ITEM CANCELADO em 05/08/2026.**
   Não virou cron: a função foi **removida**, junto com a rota `POST /supabase/cleanup`
   que a expunha (e que era a única rota daquele arquivo sem `ensureSupabaseAuth` —
   qualquer um na mesma rede podia chamar).

   O plano errou a pergunta. Ele tratou a limpeza como higiene de infraestrutura e só
   discutiu *como* agendá-la. Os números mostraram o que estava em jogo: a regra de 2
   dias apagaria 222 dos 228 projetos, com registros desde 18/10/2025. Nunca rodou de
   fato — e ainda bem.

   A decisão do dono do produto: **projeto é histórico do cliente e não se apaga
   sozinho.** Links de leitura continuam sendo abertos depois do evento, e excluir tem
   que ser ação explícita de quem é dono do dado. Se um dia existir expurgo, nasce como
   ação na interface, com confirmação e escopo visível — não como rotina de fundo.

   Consequência para o resto do plano: linha morta em `ontime_realtime` continua
   entrando na publication e no WAL. Se o objetivo é saúde do servidor, o alvo certo
   é o **item B1** (tirar as tabelas gordas da publication), não apagar dado.

5. **Alerta de billing** no painel do Supabase, em ~50% da cota, para o próximo evento
   avisar antes de estourar.

---

## 7. Ordem sugerida e risco

| # | Ação | Repo/DB | Risco | Impacto |
|---|---|---|---|---|
| A1 | `REPLICA IDENTITY USING INDEX` | DB | baixo¹ | −50% Ontime |
| A2 | `project_code` + filtro no PPT | DB + ambos | baixo² | −75% PPT |
| A4 | throttle + slides frios no writer | ontime | baixo | −90% PPT restante |
| A3 | dashboard sem assinatura gorda | site | baixo | mata o pior caso |
| B2 | PPT por broadcast | ambos | médio | custo deixa de crescer com espectadores |
| B4 | snapshot atrás do CDN | site | médio | egress do frio → ~0 |
| B3 | patch por evento | ambos | médio | −95% no caminho de edição |
| B1 | remover tabelas da publication | DB | **alto**³ | fecha a porta de vez |
| C | guarda-corpos | ambos | baixo | impede regressão |

¹ desde que A3 entre junto (o dashboard lê `payload.old.user_id`).
² a ordem importa: backfill + writer antes do filtro no site.
³ só depois que não houver mais cliente antigo em campo — quebra qualquer versão do
site/desktop que ainda dependa de `postgres_changes` nessas tabelas.

---

## 8. Arquivos que serão tocados

**ontimeHOUSERIA**
- `apps/server/src/api-data/powerpoint/powerpoint-supabase.service.ts` — A2 (writer), A4, B2, B5
- `apps/server/src/adapters/SupabaseAdapter.ts` — B3, B5
- `apps/server/supabase-migrations/` — A1, A2, B1

**houseriasite**
- `hooks/use-powerpoint-groups.ts` — A2 (leitor), B2
- `app/dashboard/page.tsx`, `app/dashboard/events/page.tsx` — A3
- `app/{AB,cliente,cliente-tv,equipe,leitura,notes}/[projectCode]/page.tsx` — B2, B4
- `app/api/snapshot/[projectCode]/route.ts` (novo) — B4
- `lib/usage-monitor.ts` — C3 (ligar ou remover)
