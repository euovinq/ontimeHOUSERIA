# Runbook — o que ficou pendente

> Complementa [01-egress-e-saude-do-servidor.md](01-egress-e-saude-do-servidor.md) e
> [02-seguranca-e-multitenancy.md](02-seguranca-e-multitenancy.md).
> Este arquivo é a lista do que **ainda precisa ser feito**, com comando, verificação
> e reversão de cada item.

---

## Já feito

> **05/08/2026: o site foi publicado e o banco foi alterado.** A tabela abaixo
> (mudanças de 04/08 do caminho do Ontime) está EM PRODUÇÃO, junto com todo o trabalho
> de segurança do dia. Verificado com um evento de teste ao vivo — pipeline
> desktop → nuvem → espectador intacto. **O desktop novo ainda NÃO foi distribuído** às
> máquinas em campo (ver "Distribuir o desktop" no README): os ganhos do writer só valem
> onde a versão nova roda.

| # | mudança | arquivo |
|---|---|---|
| 1 | `select` antes do upsert deixou de trazer a coluna `data` inteira | `apps/server/src/adapters/SupabaseAdapter.ts` |
| 2 | throttle de escrita no PowerPoint (2s) + classificação urgente/rotina | `apps/server/src/api-data/powerpoint/powerpoint-supabase.service.ts` |
| 3 | dashboard: removido `postgres_changes` sem filtro; lista por refetch leve | `houseriasite/app/dashboard/page.tsx` |
| 4 | idem na página de eventos + projeção rasa de `data` | `houseriasite/app/dashboard/events/page.tsx` |

Medições reais contra o banco de produção:

- item 1 — leitura por upsert: **1.515.341 → 94 bytes**
- item 4 — carregamento da lista: **9.565.132 → 53.865 bytes**
- item 3 — carregamento da lista: **9.565.132 → 395.399 bytes**
  (o resto é a coluna `changes`; ver pendência D)

Typecheck: 0 erros nos dois repositórios.

**Antes de publicar**, faça um teste de fumaça nas duas telas de dashboard: título do
projeto, badge de tocando/parado, contagem de eventos, duração e o contador de alterações
pendentes. Foram os campos que mudaram de origem.

> Mudança de comportamento consciente: em `dashboard/events`, a duração do evento agora
> vem do `totalDuration` que o Ontime já calcula (só itens do tipo `event`, sem os
> skipados) em vez de somar `duration` de todos os itens da rundown. Blocos e delays
> deixam de entrar na conta.

---

## Pendências

### A — Índices ~~para dropar~~ **DROPADOS em 04/08/2026** ✅

Aplicados com dois eventos ao vivo, sem interrupção. Foram **seis**, não dois — a
verificação mostrou que os três GIN também tinham uso zero, e um deles
(`edit_access_codes`) era reescrito a CADA upsert:

| índice | usos antes |
|---|---|
| `idx_powerpoint_realtime_updated_at` | 0 — era o que impedia o HOT update |
| `idx_ontime_realtime_background_color` | 0 |
| `idx_ontime_realtime_header_color` | 0 |
| `idx_ontime_realtime_content_color` | 0 |
| `idx_ontime_realtime_edit_access_codes` (GIN) | 0 |
| `idx_ontime_realtime_changes` (GIN) | 0 |
| `idx_ontime_realtime_edit_share_links` (GIN) | 0 |

Resultado medido: `powerpoint_realtime` saiu de **0% para 100% de HOT update**;
`n_dead_tup` caiu de 39 para 4; o banco encolheu de 29,6 MB para 22,9 MB.

O texto abaixo fica como registro do método — **não precisa ser executado de novo**.
**`CONCURRENTLY` é obrigatório**: sem ele o `DROP INDEX` pega lock exclusivo e pode travar
as escritas do PowerPoint enquanto espera a fila.

**A.1 — o índice que está matando o HOT update**

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_powerpoint_realtime_updated_at;
```

Por quê: `updated_at` é indexado e muda em todo upsert, então o Postgres nunca consegue
atualização "quente" — reescreve tupla e índice a cada gravação. Os números:

| tabela | updates | HOT | autovacuums | linhas |
|---|---|---|---|---|
| `ontime_realtime` | 13.146 | 12.802 (97%) | 7 | 226 |
| `powerpoint_realtime` | 7.528 | **0** | **98** | 26 |

Numa tabela de 26 linhas esse índice não serve para nada — varredura sequencial é
instantânea.

*Verificar depois:* rode um evento com PowerPoint e confira que `n_tup_hot_upd` passou a
crescer:

```sql
select relname, n_tup_upd, n_tup_hot_upd, n_dead_tup, autovacuum_count
from pg_stat_user_tables where relname = 'powerpoint_realtime';
```

*Reverter:* `CREATE INDEX CONCURRENTLY idx_powerpoint_realtime_updated_at ON public.powerpoint_realtime USING btree (updated_at DESC);`

**A.2 — índices sem leitor**

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ontime_realtime_background_color;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ontime_realtime_header_color;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_ontime_realtime_content_color;
```

Ninguém busca projeto por cor de fundo. São custo de escrita puro.

*Antes de rodar*, se quiser confirmar que estão mesmo sem uso:

```sql
select indexrelname, idx_scan from pg_stat_user_indexes
where relname = 'ontime_realtime' order by idx_scan;
```

`idx_scan = 0` significa que nunca foram usados desde o último reset das estatísticas.

---

### B — `REPLICA IDENTITY` **APLICADO em 04/08/2026** ✅

`relreplident` saiu de `f` (FULL) para `i` (USING INDEX). Metade do WAL na tabela mais
pesada. Registro do método abaixo.

#### (original)

```sql
ALTER TABLE public.ontime_realtime REPLICA IDENTITY USING INDEX ontime_realtime_pkey;
```

Corta pela metade o WAL gerado pela tabela mais pesada — cada UPDATE deixa de publicar a
linha antiga junto com a nova. É o item que mais protege contra o modo de falha que
derrubou o servidor (Realtime não consegue acompanhar o WAL → slot retém → disco enche).

**Pré-requisito, agora cumprido:** os únicos consumidores de `payload.old` em
`ontime_realtime` eram os dois dashboards, e eles não assinam mais a tabela. Rode isto
**depois** de publicar o site com os itens 3 e 4.

Auditoria dos demais consumidores de `payload.old` no site:

| arquivo | tabela | usa | situação |
|---|---|---|---|
| `hooks/use-powerpoint-groups.ts` | `powerpoint_realtime` | `old.id` | ok — `id` é a PK |
| `components/dashboard/live-events-section.tsx` | `live_events` | `old.id` | ok — PK |
| `app/live/war/[projectCode]/page.tsx` | `live_events` | `old.id` | ok — PK |
| `lib/houseriafile/files.ts` | `files`, `file_locations` | linha antiga inteira | **por isso essas duas ficam com `FULL`** |
| `lib/houseriafile/links.ts` | `session_links` | linha antiga inteira | já é `DEFAULT` hoje — provável bug latente, anterior a esta mudança |

*Verificar depois:* abrir uma tela de espectador e confirmar que timer e rundown seguem
atualizando normalmente.

*Reverter:* `ALTER TABLE public.ontime_realtime REPLICA IDENTITY FULL;`

---

### C — `project_code` no PowerPoint **APLICADO em 04/08/2026** ✅

Com uma melhora sobre o plano: um **trigger** preenche a coluna a partir do `id`, então
isso NÃO depende de atualizar o desktop — a ordem obrigatória descrita abaixo deixou de
existir. O filtro no site (C.3) também já está no ar.

#### (original)

Mata a amplificação cruzada: hoje todo espectador de qualquer projeto recebe as
atualizações de PowerPoint de **todos** os projetos, porque
`hooks/use-powerpoint-groups.ts` assina a tabela inteira sem filtro.

**A ordem não é sugestão.** Invertida, os espectadores param de receber PowerPoint sem
nenhum erro no console — só silêncio.

**C.1 — banco** (pode rodar com evento; `ADD COLUMN` nullable é só metadata)

```sql
ALTER TABLE public.powerpoint_realtime ADD COLUMN IF NOT EXISTS project_code text;

UPDATE public.powerpoint_realtime
   SET project_code = split_part(id, ':', 1)
 WHERE project_code IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_powerpoint_realtime_project_code
    ON public.powerpoint_realtime(project_code);
```

> O `UPDATE` do backfill dispara um evento de realtime por linha (26), cada um com a
> linha inteira, para todos os conectados. É um pico de alguns segundos, não uma queda.
> Ainda assim, prefira fora de evento.

**C.2 — desktop:** incluir `project_code` no objeto do upsert em
`powerpoint-supabase.service.ts` (`sendDirectToSupabase`, o objeto `data`):

```ts
project_code: (this.projectCode || '').split(':')[0],
```

> **Não faça C.2 antes de C.1.** Escrever numa coluna que não existe faz o upsert inteiro
> falhar, e o PowerPoint para de subir.

**C.3 — site:** só depois que C.1 e C.2 estiverem em produção e todas as linhas tiverem
`project_code` preenchido, trocar o filtro em `hooks/use-powerpoint-groups.ts`:

```ts
{ event: '*', schema: 'public', table: 'powerpoint_realtime',
  filter: `project_code=eq.${projectCode}` }
```

*Verificar antes de C.3:*
```sql
select count(*) filter (where project_code is null) as sem_codigo, count(*) from powerpoint_realtime;
```
Tem que dar `sem_codigo = 0`.

*Reverter C.3:* voltar ao filtro no cliente (o `belongs()` continua no arquivo).

---

### D — Coluna gerada para o contador de pendências ~~(opcional)~~ **FEITA em 05/08/2026** ✅

Refetch do dashboard **395.790 → 50.845 bytes** (−87%), medido contra produção.

**Correção importante sobre o SQL abaixo:** a expressão original (que ficou registrada
aqui) contava `jsonb_array_length` do array inteiro — o que estava **errado**. O contador
da tela filtra `'field' in c && 'after' in c && !('type' in c)`, ignorando as
notificações de projeto que moram no mesmo array. Na base de hoje: 898 itens nos arrays,
**0 pendências de verdade** — a expressão original mostraria "898 pendentes". O que foi
aplicado é uma função `count_pending_changes(jsonb)` que replica o filtro real, conferida
228/228 linhas. `app/dashboard/page.tsx` lê a coluna e busca o array só quando o diálogo
abre.

#### (SQL original — NÃO use, conta demais)

```sql
ALTER TABLE public.ontime_realtime
  ADD COLUMN pending_changes_count int
  GENERATED ALWAYS AS (
    coalesce(jsonb_array_length(case when jsonb_typeof(changes) = 'array' then changes else '[]'::jsonb end), 0)
  ) STORED;
```

---

### E — Fase B do plano de egress — **começada, ver o plano 01**

Broadcast para o PowerPoint (B2), snapshot atrás de CDN (B4), patch por evento (B3),
tirar as tabelas da publicação (B1). É o que muda a ordem de grandeza (de ~15 para
~50–60 eventos simultâneos) e o que fecha `ontime_realtime` ao anônimo (= Fase 4 da
segurança). **A rota de snapshot (B4) já está construída e provada**; falta ligar as
páginas + o que mexe no desktop. Detalhado no plano 01, seção 5. Próxima sessão, em
janela própria com convivência de desktop.

---

### F — Segurança

Tudo em [02-seguranca-e-multitenancy.md](02-seguranca-e-multitenancy.md). Fases 0, 1 e 5
**feitas**; Fase 2 **provada**; 3 e 4 pendentes (casam com a Fase B acima).
**Nenhum item que fecha porta pode ser feito com gente usando o sistema.**
O `JWT_SECRET` sem fallback já foi resolvido (e as 3 cópias remanescentes,
centralizadas em `lib/jwt-secret.ts`).

---

## Ordem sugerida

```
FEITO até 05/08/2026:
  1–7. site publicado, índices, replica identity, C.1–C.3, D, e todo o plano 02
       Fases 0/1/5. Verificado com evento de teste ao vivo.

FEITO em 05/08/2026 (noite):
  8. corrida do snapshot corrigida (a web voltou a refletir edição na hora);
  9. auto-update PROVADO no macOS — mas com uma pegadinha: as versões em campo
     (1.0.5–1.0.8) não conseguem se atualizar sozinhas, precisam de UMA
     instalação manual da 1.0.9+. Ver o README.

PRÓXIMA JANELA (fora de evento, com convivência de desktop):
 10. B4 — ligar as 5 telas de espectador à rota de snapshot. Ficou barato: elas
     já leem por uma função só (`houseriasite/lib/snapshot.ts`), então é trocar
     a origem em um lugar. Não depende de redistribuir desktop.
 11. Fase 3 (desktop com identidade) + Fase B/4 (espectador sem banco),
     coordenados — a jogada que destrava escala E fecha ontime_realtime.
     ATENÇÃO: o corte por versão não acontece sozinho (item 9).
 12. Windows: conferir que a tag v1.0.12 publicou e que uma máquina atualiza.
```

## Os três números para acompanhar a saúde

```sql
-- 1. WAL retido nos slots: se subir e não voltar, o Realtime está ficando para trás
select slot_name, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as wal_retido
  from pg_replication_slots;

-- 2. Churn de escrita: n_dead_tup alto e n_tup_hot_upd parado = throttle não segurando
select relname, n_tup_upd, n_tup_hot_upd, n_dead_tup, autovacuum_count
  from pg_stat_user_tables where relname in ('ontime_realtime','powerpoint_realtime');
```

3. Pico de conexões simultâneas de Realtime — no painel do Supabase. É o número que
   define quando a Fase B deixa de ser opcional.

**E confirme se o *spend cap* do plano Pro está desligado.** Com ele ligado, estourar a
cota não gera cobrança extra: gera **restrição do serviço** — o mesmo desfecho que você
quer evitar, entrando por outra porta.
