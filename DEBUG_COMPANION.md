# Debug do Erro 1000 no Companion

## O que fazer agora:

1. **Reinicie o servidor** para aplicar os logs detalhados

2. **Tente conectar o Companion** e observe os logs do servidor

3. **Procure por estas mensagens nos logs**:
   - `📥 [REQUEST]` - Todas as requisições recebidas
   - `✅ [PUBLIC-TIMER]` - Rotas públicas de controle capturadas
   - `✅ [PUBLIC-DATA]` - Rotas públicas de dados capturadas
   - `✅ [PUBLIC-ROUTER]` - Rotas do router público capturadas
   - `❌` - Qualquer erro

4. **Se NÃO aparecer nenhum log**, significa que:
   - O Companion não está conseguindo conectar ao servidor
   - Pode ser problema de rede/firewall
   - O servidor pode não estar rodando na porta 4001

5. **Se aparecer logs mas com erro**, compartilhe:
   - A mensagem de erro completa
   - Qual rota estava sendo acessada
   - O status code retornado

## Teste Manual

Teste estas rotas manualmente para verificar se estão funcionando:

```bash
# Health check
curl -v http://127.0.0.1:4001/api/

# Poll (usado pelo Companion)
curl -v http://127.0.0.1:4001/api/poll

# Dados do projeto
curl -v http://127.0.0.1:4001/data/project

# Rundown
curl -v http://127.0.0.1:4001/data/rundown/normalised
```

Todos devem retornar dados sem erro 401.

## Possíveis Causas do Erro 1000

1. **Timeout**: Servidor demorando mais de 5 segundos para responder
2. **Conexão**: Companion não consegue alcançar o servidor
3. **Rota não encontrada**: Companion tentando acessar rota que não existe
4. **Erro no servidor**: Alguma rota está retornando erro 500

## Informações Necessárias

Para diagnosticar, preciso de:
1. **Logs do servidor** quando o Companion tentar conectar
2. **Mensagem de erro exata** do Companion
3. **Configuração do Companion** (host, porta, protocolo)
4. **Se o servidor está rodando** (teste com curl)
