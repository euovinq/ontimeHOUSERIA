# Diagnóstico do Erro 1000 no Companion

## O que é o Erro 1000?

O erro 1000 no Companion geralmente indica:
- **Timeout de conexão** (requisição demorou mais de 5 segundos)
- **Erro de conexão** (servidor não respondeu)
- **Erro HTTP** (status code não esperado)

## Passos para Diagnosticar

### 1. Verifique se o servidor está rodando

```bash
curl http://127.0.0.1:4001/api/
```

Deve retornar: `{"message":"You have reached Ontime API server",...}`

### 2. Teste a rota que o Companion usa

```bash
curl http://127.0.0.1:4001/api/public/poll
```

Deve retornar dados do timer em JSON.

### 3. Verifique os logs do servidor

Quando o Companion tentar conectar, você deve ver logs como:
- `✅ [PUBLIC-ROUTER] Health check capturado: GET /api/public/`
- `✅ [PUBLIC-TIMER] Requisição pública capturada: GET /api/poll`
- `🔍 [PUBLIC-ROUTER] Processando ação: poll`

### 4. Verifique a configuração do Companion

No Companion, verifique:
- **Host**: Deve ser `127.0.0.1` ou o IP local do servidor
- **Porta**: Deve ser `4001`
- **Protocolo**: Deve ser `http` (não `https`)
- **E-mail/Senha**: Deixe vazio se não houver autenticação

### 5. Teste com curl simulando o Companion

```bash
# Simula requisição do Companion
curl -v -H "Origin: http://localhost" \
     -H "User-Agent: Companion" \
     http://127.0.0.1:4001/api/public/poll
```

### 6. Verifique se há firewall bloqueando

```bash
# No macOS/Linux
netstat -an | grep 4001

# Deve mostrar que a porta está LISTENING
```

### 7. Verifique se o servidor está acessível do Companion

Se o Companion está em outra máquina:
- Use o IP da rede local (ex: `192.168.1.100`) em vez de `localhost`
- Verifique se o firewall permite conexões na porta 4001

## Possíveis Soluções

### Solução 1: Verificar timeout

O Companion tem timeout de 5 segundos. Se o servidor estiver lento:
- Verifique se há processos pesados rodando
- Reinicie o servidor

### Solução 2: Verificar CORS

O servidor está configurado para aceitar qualquer origem. Se ainda houver problemas:
- Verifique os headers CORS na resposta
- Teste com diferentes origens

### Solução 3: Verificar ordem dos routers

A ordem dos routers está correta:
1. `/api/public` - Router público do Companion ✅
2. `/api` - Router público de controle ✅
3. `/api` - Router protegido (só captura se não foi capturado antes) ✅

### Solução 4: Verificar logs detalhados

Agora há logs detalhados que mostram:
- Qual rota foi acessada
- Qual ação foi processada
- Qual IP fez a requisição
- Qual origem (Origin header)

## Próximos Passos

1. **Reinicie o servidor** para aplicar as mudanças
2. **Tente conectar o Companion novamente**
3. **Verifique os logs do servidor** quando o Companion tentar conectar
4. **Compartilhe os logs** se o erro persistir

## Informações para Debug

Se o erro persistir, forneça:
1. Logs do servidor quando o Companion tenta conectar
2. Configuração exata do Companion (host, porta, protocolo)
3. Mensagem de erro exata do Companion
4. Se o Companion está na mesma máquina ou em outra
