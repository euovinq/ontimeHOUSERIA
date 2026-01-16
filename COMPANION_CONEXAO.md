# Guia de Conexão do Companion

## Rotas Públicas Disponíveis

Todas as seguintes rotas estão **públicas** (não requerem autenticação):

### Rotas de Controle do Timer (`/api/*`)
- `GET /api/` - Health check da API
- `GET /api/version` - Versão da API
- `GET /api/poll` - Poll de status do timer
- `GET /api/start` - Iniciar timer
- `GET /api/pause` - Pausar timer
- `GET /api/stop` - Parar timer
- `GET /api/load` - Carregar evento
- `GET /api/roll` - Roll
- `GET /api/reload` - Recarregar
- `GET /api/addtime` - Adicionar tempo

### Rotas Públicas do Companion (`/api/public/*`)
- `GET /api/public/` - Health check do router público
- `GET /api/public/poll` - Poll de status (usado pelo Companion)
- `GET /api/public/getsupabasestatus` - Status do Supabase
- `GET /api/public/getpowerpointstatus` - Status do PowerPoint
- `GET /api/public/start` - Iniciar timer
- `GET /api/public/pause` - Pausar timer
- `GET /api/public/stop` - Parar timer
- E outras ações de controle...

## Configuração do Companion

1. **Host**: `127.0.0.1` ou `localhost`
2. **Porta**: `4001`
3. **Protocolo**: `http`
4. **E-mail** (opcional): Deixe vazio se não houver autenticação
5. **Senha** (opcional): Deixe vazio se não houver autenticação

## Troubleshooting

### Se o Companion não conseguir conectar:

1. **Verifique se o servidor está rodando**:
   ```bash
   curl http://127.0.0.1:4001/api/
   ```
   Deve retornar: `{"message":"You have reached Ontime API server",...}`

2. **Teste a rota de poll**:
   ```bash
   curl http://127.0.0.1:4001/api/public/poll
   ```
   Deve retornar dados do timer em JSON

3. **Verifique os logs do servidor**:
   - Procure por mensagens como `✅ [PUBLIC-TIMER]` ou `✅ [PUBLIC-ROUTER]`
   - Isso indica que as rotas públicas estão sendo acessadas

4. **Se estiver usando autenticação**:
   - Certifique-se de que as credenciais estão corretas
   - O endpoint `/auth/login` deve estar acessível
   - Mesmo com autenticação, as rotas `/api/public/*` e `/api/poll` são públicas

5. **Verifique o CORS**:
   - O servidor está configurado para aceitar requisições de qualquer origem
   - Se ainda houver problemas, verifique o console do navegador/Companion

## Logs de Depuração

O servidor agora tem logs de depuração que mostram quando rotas públicas são acessadas:
- `✅ [PUBLIC-TIMER] Requisição pública capturada: GET /api/{action}`
- `✅ [PUBLIC-ROUTER] Health check capturado: GET /api/public/`

Se você não ver esses logs quando o Companion tentar conectar, pode indicar que:
1. A requisição não está chegando ao servidor
2. A requisição está sendo capturada por outro router antes
3. Há um problema de rede/firewall

## Próximos Passos

Se ainda houver problemas, forneça:
1. A mensagem de erro exata do Companion
2. Os logs do servidor quando o Companion tenta conectar
3. Qual endpoint específico está falhando (verifique os logs)
