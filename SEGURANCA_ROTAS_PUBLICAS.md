# Análise de Segurança - Rotas Públicas

## Resumo Executivo

Este documento analisa a segurança das rotas públicas atualmente implementadas e recomenda quais são seguras para uso público.

## Rotas Atualmente Públicas

### ✅ **SEGURAS - Podem permanecer públicas**

#### 1. **`GET /api/version`**
- **Risco**: ⚠️ **Muito Baixo**
- **O que faz**: Retorna apenas a versão do software
- **Dados expostos**: Versão (ex: "1.0.0")
- **Impacto**: Nenhum - informação pública
- **Recomendação**: ✅ **MANTER PÚBLICA**

#### 2. **`GET /api/poll`**
- **Risco**: ⚠️ **Baixo-Médio**
- **O que faz**: Retorna estado atual do timer e eventos
- **Dados expostos**:
  - Estado do timer (playback, tempo atual, duração)
  - Eventos atuais e próximos (título, cue, horários)
  - Mensagens do timer
  - Status do runtime
  - **NÃO expõe**: Senhas, API keys, configurações sensíveis, dados de usuários
- **Impacto**: 
  - ✅ Informações de apresentação são normalmente públicas
  - ⚠️ Pode expor estrutura do rundown (eventos, horários)
  - ⚠️ Pode ser usado para monitoramento não autorizado
- **Recomendação**: ✅ **MANTER PÚBLICA** (necessário para displays públicos e Companion)
- **Nota**: Se você tem informações muito sensíveis no rundown, considere usar `isPublic` flag nos eventos

### ⚠️ **RISCO MÉDIO - Avaliar contexto de uso**

#### 3. **`GET /api/start`**
- **Risco**: ⚠️⚠️ **Médio**
- **O que faz**: Inicia o timer ou um evento específico
- **Capacidades**:
  - Inicia o próximo evento
  - Inicia evento por índice
  - Inicia evento por ID
  - Inicia evento por CUE
- **Impacto**:
  - ⚠️ Qualquer pessoa pode iniciar eventos
  - ⚠️ Pode interromper apresentações ao vivo
  - ⚠️ Pode causar confusão durante eventos
- **Recomendação**: 
  - ✅ **MANTER PÚBLICA** se você confia na sua rede local
  - ❌ **PROTEGER** se o servidor está acessível publicamente na internet
  - 💡 **Considerar**: Rate limiting ou whitelist de IPs

#### 4. **`GET /api/pause`**
- **Risco**: ⚠️⚠️ **Médio**
- **O que faz**: Pausa o timer em execução
- **Impacto**:
  - ⚠️ Qualquer pessoa pode pausar apresentações
  - ⚠️ Pode causar interrupções durante eventos ao vivo
- **Recomendação**: 
  - ✅ **MANTER PÚBLICA** apenas em redes confiáveis
  - ❌ **PROTEGER** se acessível publicamente

#### 5. **`GET /api/stop`**
- **Risco**: ⚠️⚠️ **Médio-Alto**
- **O que faz**: Para completamente o timer
- **Impacto**:
  - ⚠️ Qualquer pessoa pode parar apresentações
  - ⚠️ Pode causar interrupções graves durante eventos
- **Recomendação**: 
  - ⚠️ **CONSIDERAR PROTEGER** - mais crítico que pause
  - ✅ **MANTER PÚBLICA** apenas se absolutamente necessário

#### 6. **`GET /api/load`**
- **Risco**: ⚠️⚠️ **Médio**
- **O que faz**: Carrega um evento específico para o timer (sem iniciar)
- **Capacidades**:
  - Carrega próximo evento
  - Carrega evento por índice/ID/CUE
- **Impacto**:
  - ⚠️ Pode alterar qual evento está preparado
  - ⚠️ Menos crítico que start, mas ainda pode causar confusão
- **Recomendação**: 
  - ✅ **MANTER PÚBLICA** se necessário para operação
  - ⚠️ **CONSIDERAR PROTEGER** se usado em produção crítica

#### 7. **`GET /api/addtime`**
- **Risco**: ⚠️⚠️⚠️ **Médio-Alto**
- **O que faz**: Adiciona ou remove tempo do timer atual
- **Impacto**:
  - ⚠️ Pode alterar durações de eventos
  - ⚠️ Pode causar problemas de sincronização
  - ⚠️ Pode afetar horários planejados
- **Recomendação**: 
  - ⚠️ **CONSIDERAR PROTEGER** - operação que altera tempo
  - ✅ **MANTER PÚBLICA** apenas se necessário para operação remota

#### 8. **`GET /api/roll`**
- **Risco**: ⚠️⚠️ **Médio**
- **O que faz**: Executa ação "roll" (avança para próximo evento rapidamente)
- **Impacto**:
  - ⚠️ Pode avançar eventos rapidamente
  - ⚠️ Pode causar confusão durante apresentações
- **Recomendação**: 
  - ⚠️ **CONSIDERAR PROTEGER**
  - ✅ **MANTER PÚBLICA** apenas se necessário

#### 9. **`GET /api/reload`**
- **Risco**: ⚠️⚠️ **Médio**
- **O que faz**: Recarrega o estado atual
- **Impacto**:
  - ⚠️ Pode causar pequenas interrupções
  - ⚠️ Menos crítico que outras ações
- **Recomendação**: 
  - ✅ **MANTER PÚBLICA** - operação relativamente segura

## Rotas em `/api/public/*`

Todas as rotas em `/api/public/*` têm os mesmos riscos das rotas acima, pois são apenas wrappers.

## Recomendações por Cenário

### 🏠 **Rede Local Confiável (Recomendado)**
**Cenário**: Servidor rodando em rede local, apenas pessoas autorizadas têm acesso físico/na rede.

**Rotas Seguras para Manter Públicas**:
- ✅ `/api/version`
- ✅ `/api/poll`
- ✅ `/api/start`
- ✅ `/api/pause`
- ✅ `/api/stop`
- ✅ `/api/load`
- ✅ `/api/addtime`
- ✅ `/api/roll`
- ✅ `/api/reload`

**Justificativa**: Em rede local confiável, o risco é baixo. As rotas são necessárias para operação remota via Companion/Stream Deck.

### 🌐 **Acessível Publicamente na Internet**
**Cenário**: Servidor acessível de qualquer lugar na internet.

**Rotas Seguras para Manter Públicas**:
- ✅ `/api/version` - Informação pública
- ✅ `/api/poll` - Necessário para displays públicos

**Rotas que DEVEM ser Protegidas**:
- ❌ `/api/start` - Pode ser abusado
- ❌ `/api/pause` - Pode interromper apresentações
- ❌ `/api/stop` - Pode parar apresentações
- ❌ `/api/load` - Pode alterar eventos
- ❌ `/api/addtime` - Pode alterar tempos
- ❌ `/api/roll` - Pode avançar eventos
- ⚠️ `/api/reload` - Considerar proteger

**Justificativa**: Com acesso público, qualquer pessoa pode interferir nas apresentações.

### 🏢 **Ambiente Corporativo/Produção**
**Cenário**: Ambiente profissional com múltiplos usuários.

**Recomendação**: 
- ✅ Manter apenas `/api/poll` e `/api/version` públicos
- ❌ Proteger todas as ações de controle
- 💡 Implementar autenticação para Companion/Stream Deck

## Mitigações de Segurança

Se você precisa manter rotas públicas mas quer reduzir riscos:

### 1. **Rate Limiting**
Limite o número de requisições por IP:
```javascript
// Exemplo: máximo 10 requisições por minuto por IP
```

### 2. **Whitelist de IPs**
Permita apenas IPs específicos:
```javascript
// Exemplo: apenas IPs da rede local
const allowedIPs = ['192.168.1.0/24', '10.0.0.0/8'];
```

### 3. **Firewall**
Configure firewall para bloquear acesso externo:
- Permita apenas rede local (192.168.x.x, 10.x.x.x)
- Bloqueie acesso público

### 4. **VPN**
Use VPN para acesso remoto seguro em vez de expor portas publicamente.

### 5. **Autenticação por Token**
Mesmo para rotas "públicas", use tokens simples:
```javascript
// Exemplo: token simples na query string
GET /api/start?token=abc123
```

## Dados NÃO Expostos pelas Rotas Públicas

✅ **Seguro**: As rotas públicas NÃO expõem:
- Senhas ou hashes de senha
- API keys do Supabase ou outros serviços
- Configurações sensíveis do sistema
- Dados de usuários (e-mails, etc.)
- Chaves de criptografia
- Informações de autenticação

## Conclusão

### Rotas Mais Seguras (Manter Públicas):
1. ✅ `/api/version` - Sempre seguro
2. ✅ `/api/poll` - Necessário para displays públicos

### Rotas de Controle (Avaliar Contexto):
- ⚠️ Todas as outras rotas (`start`, `pause`, `stop`, etc.) devem ser avaliadas baseado em:
  - Se o servidor está acessível publicamente
  - Se a rede é confiável
  - Se há necessidade operacional

### Recomendação Final:
- **Rede Local**: ✅ Todas as rotas podem ser públicas
- **Internet Pública**: ❌ Proteger todas exceto `version` e `poll`
- **Produção**: ⚠️ Implementar autenticação mesmo para rotas "públicas"
