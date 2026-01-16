# Rotas Públicas para Companion

## ✅ Todas as Rotas Públicas Configuradas

### Rotas de API (`/api/*`)
**TODAS as rotas estão públicas** via catch-all:
- `/api/` - Health check
- `/api/version` - Versão
- `/api/poll` - Status do timer
- `/api/start` - Iniciar timer
- `/api/pause` - Pausar timer
- `/api/stop` - Parar timer
- `/api/load` - Carregar evento
- `/api/message` - Controlar mensagens
- `/api/change` - Modificar eventos
- `/api/auxtimer` - Timer auxiliar
- `/api/client` - Controlar clientes
- `/api/offsetmode` - Modo de offset
- **E qualquer outra ação disponível**

### Rotas Públicas do Companion (`/api/public/*`)
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

### Rotas de Dados (`/data/*`)
Rotas públicas de leitura:
- `/data/realtime` - Dados em tempo real (GET apenas)

### Rotas de Autenticação (`/auth/*`)
Rotas públicas para login:
- `/auth/login` - Login (POST)
- `/auth/license` - Informações de licença (GET)

## Ordem dos Routers (Importante!)

A ordem no `app.ts` é:
1. `/api/public` - Router público do Companion ✅
2. `/data` - Router público de leitura ✅
3. `/data` - Router protegido (só captura se não foi capturado antes) ✅
4. `/api` - Router público de controle ✅
5. `/api` - Router protegido (só captura se não foi capturado antes) ✅

## Teste de Conexão

Para testar se todas as rotas estão funcionando:

```bash
# Health check
curl http://127.0.0.1:4001/api/

# Poll de status
curl http://127.0.0.1:4001/api/public/poll

# Dados em tempo real
curl http://127.0.0.1:4001/data/realtime

# Versão
curl http://127.0.0.1:4001/api/version
```

Todos devem retornar dados sem erro 401 (Unauthorized).

## Se Ainda Houver Erro 1000

1. **Verifique os logs do servidor** quando o Companion tentar conectar
2. **Procure por mensagens** como:
   - `✅ [PUBLIC-TIMER] Requisição pública capturada`
   - `✅ [PUBLIC-ROUTER] Health check capturado`
   - `🔍 [PUBLIC-ROUTER] Processando ação`
   - `❌ [PUBLIC-TIMER] Erro ao processar ação`

3. **Se não aparecer nenhum log**, o Companion pode estar:
   - Tentando acessar uma rota que não existe
   - Tendo problema de conexão/timeout
   - Tentando acessar antes do servidor estar pronto

4. **Compartilhe os logs** para diagnóstico mais preciso
