# ✅ Todas as Rotas Públicas Configuradas

## Resumo

**TODAS as rotas necessárias para o módulo oficial do Ontime estão públicas!**

## Rotas de API (`/api/*`)

**TODAS as rotas estão públicas** via catch-all:
- `/api/` - Health check
- `/api/version` - Versão
- `/api/poll` - Status do timer
- `/api/start` - Iniciar timer (e variações: /start/next, /start/previous, /start/index/:id, etc.)
- `/api/pause` - Pausar timer
- `/api/stop` - Parar timer
- `/api/load` - Carregar evento (e variações)
- `/api/message` - Controlar mensagens
- `/api/change` - Modificar eventos
- `/api/auxtimer` - Timer auxiliar
- `/api/client` - Controlar clientes
- `/api/offsetmode` - Modo de offset
- `/api/addtime` - Adicionar tempo
- `/api/roll` - Roll
- `/api/reload` - Recarregar
- **E qualquer outra ação disponível**

## Rotas Públicas do Companion (`/api/public/*`)

Todas as rotas em `/api/public/*` estão públicas:
- `/api/public/` - Health check
- `/api/public/poll` - Poll de status
- `/api/public/start` - Iniciar timer
- `/api/public/pause` - Pausar timer
- `/api/public/stop` - Parar timer
- `/api/public/getsupabasestatus` - Status do Supabase
- `/api/public/getpowerpointstatus` - Status do PowerPoint
- `/api/public/togglesupabase` - Toggle Supabase
- `/api/public/togglepowerpoint` - Toggle PowerPoint
- **E qualquer outra ação**

## Rotas de Dados (`/data/*`) - LEITURA APENAS

**Todas as rotas GET de leitura estão públicas**:

### Dados em Tempo Real
- `GET /data/realtime` - Dados em tempo real

### Configurações e Projeto
- `GET /data/automations` - Configurações de automação
- `GET /data/custom-fields` - Campos customizados
- `GET /data/db` - Download do projeto atual
- `GET /data/project` - Dados do projeto
- `GET /data/settings` - Configurações
- `GET /data/view-settings` - Configurações de visualização
- `GET /data/url-presets` - Presets de URL

### Sessão e Relatórios
- `GET /data/session` - Estatísticas de sessão
- `GET /data/session/info` - Informações da sessão
- `GET /data/report` - Relatórios

### Rundown
- `GET /data/rundown` - Todos os eventos
- `GET /data/rundown/normalised` - Rundown normalizado
- `GET /data/rundowns` - Alias (plural) para compatibilidade
- `GET /data/rundowns/current` - Rundown atual (alias)

## Rotas de Autenticação (`/auth/*`)

- `POST /auth/login` - Login
- `GET /auth/license` - Informações de licença

## Ordem dos Routers (Importante!)

A ordem no `app.ts` garante que as rotas públicas sejam capturadas primeiro:

1. `/api/public` - Router público do Companion ✅
2. `/data` - Router público de leitura ✅
3. `/data` - Router protegido (só captura se não foi capturado antes) ✅
4. `/api` - Router público de controle (catch-all) ✅
5. `/api` - Router protegido (só captura se não foi capturado antes) ✅

## Teste Completo

Para testar todas as rotas:

```bash
# Health checks
curl http://127.0.0.1:4001/api/
curl http://127.0.0.1:4001/api/public/

# Poll de status
curl http://127.0.0.1:4001/api/poll
curl http://127.0.0.1:4001/api/public/poll

# Dados do projeto
curl http://127.0.0.1:4001/data/project
curl http://127.0.0.1:4001/data/rundown/normalised
curl http://127.0.0.1:4001/data/settings
curl http://127.0.0.1:4001/data/automations
curl http://127.0.0.1:4001/data/custom-fields
curl http://127.0.0.1:4001/data/session
curl http://127.0.0.1:4001/data/realtime

# Controles
curl http://127.0.0.1:4001/api/version
curl http://127.0.0.1:4001/api/start
```

Todos devem retornar dados sem erro 401 (Unauthorized).

## Próximos Passos

1. **Reinicie o servidor** para aplicar todas as mudanças
2. **Tente conectar o Companion novamente**
3. **Verifique os logs do servidor** - você deve ver:
   - `✅ [PUBLIC-DATA-ROUTER] Todas as rotas de leitura (GET) em /data/ estão públicas`
   - `✅ [PUBLIC-TIMER-ROUTER] TODAS as rotas de controle estão públicas`
   - `✅ [PUBLIC-ROUTER] Router público criado`

4. **Se ainda houver erro 1000**, compartilhe:
   - Logs do servidor quando o Companion tentar conectar
   - Mensagem de erro exata do Companion
   - Qual rota específica está falhando (veja nos logs)
