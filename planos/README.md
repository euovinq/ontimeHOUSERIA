# Planos

Os quatro documentos que descrevem para onde este sistema está indo, e o que já foi
feito. Numerados na ordem em que fazem sentido ser lidos — não na ordem de execução.

Eles cobrem **dois repositórios**: `ontimeHOUSERIA` (desktop + servidor) e
`houseriasite` (Next.js). Ficam aqui, num lugar só, porque separá-los por repo fazia
perder a visão do conjunto — vários itens tocam os dois ao mesmo tempo.

| # | documento | estado |
|---|---|---|
| 01 | [Egress e saúde do servidor](01-egress-e-saude-do-servidor.md) | Fase A **feita**; Fase B pendente |
| 02 | [Segurança e multi-tenancy](02-seguranca-e-multitenancy.md) | só o item 0.1 feito — **o resto bloqueia escalar** |
| 03 | [Eventos e painel do dono](03-eventos-e-painel-do-dono.md) | etapas 1–7 **feitas** e no ar |
| 04 | [Runbook de pendências](04-runbook-de-pendencias.md) | o que sobrou, com comando e reversão |

## Se você está começando agora

Leia o **02** primeiro. Ele descreve o único bloqueio real para escalar: hoje qualquer
visitante do site tem, na prática, permissão de administrador do banco. Os outros três
são otimização e produto; esse é condição.

## Três coisas que valem mais que o conteúdo dos documentos

**A ordem não é sugestão.** Vários itens quebram em silêncio se executados fora de
ordem — fechar o `anon` em `users` antes de apontar as telas para as API routes derruba
o dashboard na hora; ligar o filtro do PowerPoint no site antes do banco preencher a
coluna faz o espectador parar de receber, sem erro no console.

**Nada da Fase 0 do 02 pode ser feito com gente usando o sistema.** Cada item derruba
alguém. O 04 classifica o que é seguro com evento no ar e o que exige janela.

**Segurança pela metade é pior que nenhuma.** RLS é permissivo: uma policy nova ao lado
de uma `USING (true)` que sobreviveu não protege nada, mas passa a sensação de que sim.
Se for começar, termine a etapa.

## O que já está aplicado em produção

Registrado dentro de cada documento, com data e medição. Em resumo, de 04/08/2026:

- seis índices sem uso dropados, `REPLICA IDENTITY` corrigido, `project_code` no
  PowerPoint com trigger, dashboards fora do `postgres_changes` — tudo com dois eventos
  ao vivo, sem interrupção;
- pasta de evento, cobrança por evento, painel do dono e relatório de execução, no ar;
- `JWT_SECRET` sem fallback.

**Pendências de minutos:** configurar `OWNER_USER_ID` na Vercel (sem ela o painel do dono
fica visível para as 9 contas admin) e distribuir o desktop atualizado — sem isso, três
ganhos de performance seguem parados nas máquinas em campo.
