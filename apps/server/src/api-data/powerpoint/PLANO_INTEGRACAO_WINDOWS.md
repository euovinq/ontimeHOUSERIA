# Plano de Integração - App Windows PowerPoint com Supabase

## Objetivo
Integrar o app Windows do PowerPoint (rodando em `192.168.0.240:7800`) com o sistema, expondo dados via API REST e Supabase para visualização em tempo real nas páginas.

## Análise dos Dados

### Formato de Resposta do App Windows
O app retorna dados em formato query string (sem headers HTTP padrão):
```
slide_info=Slide%205%20%2F%2014hours=00&minutes=05&seconds=08&time=00:05:08
```

### Campos Identificados
- `slide_info`: "Slide 5 / 14" → slide atual / total de slides
- `hours`: Horas do vídeo (00-23)
- `minutes`: Minutos do vídeo (00-59)
- `seconds`: Segundos do vídeo (00-59)
- `time`: Tempo formatado "HH:MM:SS"

### Observações
- O app envia dados em streaming contínuo (atualiza em tempo real)
- Dados de vídeo só aparecem quando há vídeo tocando
- Formato não-HTTP padrão (resposta direta em query string)

## Estrutura da Implementação

### Fase 1: Serviço de Polling do App Windows

#### 1.1 Criar Serviço de Comunicação
**Arquivo**: `apps/server/src/api-data/powerpoint/powerpoint-windows.service.ts`

**Responsabilidades**:
- Conectar ao app Windows via TCP/HTTP
- Fazer polling a cada 500ms
- Parsear resposta query string
- Normalizar dados para formato `PowerPointStatus`
- Gerenciar reconexão em caso de falha
- Manter estado interno (último valor recebido)

**Métodos**:
- `constructor(config?: { url?: string, pollInterval?: number })`
- `start()`: Inicia polling
- `stop()`: Para polling
- `getStatus()`: Retorna último status recebido
- `isConnected()`: Verifica se está conectado
- `private poll()`: Faz requisição HTTP
- `private parseResponse(data: string)`: Parseia query string
- `private normalizeData(parsed: any): PowerPointStatus`: Normaliza dados

**Lógica de Normalização**:
- `slide_info` "Slide 5 / 14" → `currentSlide: 5, slideCount: 14`
- `hours`, `minutes`, `seconds` → `currentTime` (em segundos)
- Presença de `hours/minutes/seconds` → `hasVideo: true`
- Mudança de `time` entre polls → `isPlaying: true`
- `remainingTime` = `duration - currentTime` (se `duration` disponível)

#### 1.2 Gerenciamento de Estado
- Último status recebido
- Timestamp da última atualização
- Estado de conexão (connected/disconnected/error)
- Contador de erros consecutivos (para backoff)
- EventEmitter para notificar mudanças

### Fase 2: Integração com Controller Existente

#### 2.1 Atualizar Controller
**Arquivo**: `apps/server/src/api-data/powerpoint/powerpoint.controller.ts`

**Modificações**:
- Importar `PowerPointWindowsService`
- Adicionar instância singleton do serviço
- Modificar `getPowerPointStatusController` para:
  1. Tentar módulo nativo primeiro (macOS/Windows COM)
  2. Se não disponível, usar `PowerPointWindowsService`
  3. Retornar dados normalizados em formato consistente

**Código**:
```typescript
let windowsService: PowerPointWindowsService | null = null;

// Inicializar serviço Windows se necessário
if (!getPowerPointStatus && !windowsService) {
  const windowsUrl = process.env.POWERPOINT_WINDOWS_URL || 'http://192.168.0.240:7800';
  windowsService = new PowerPointWindowsService({ url: windowsUrl });
  windowsService.start();
}

// No controller:
if (getPowerPointStatus) {
  // Usar módulo nativo
  status = getPowerPointStatus();
} else if (windowsService) {
  // Usar serviço Windows
  status = windowsService.getStatus();
}
```

#### 2.2 Configuração
- Variável de ambiente: `POWERPOINT_WINDOWS_URL` (padrão: `http://192.168.0.240:7800`)
- Variável de ambiente: `POWERPOINT_WINDOWS_POLL_INTERVAL` (padrão: 500ms)

### Fase 3: Integração com Supabase

#### 3.1 Criar Serviço de Integração Supabase
**Arquivo**: `apps/server/src/api-data/powerpoint/powerpoint-supabase.service.ts`

**Responsabilidades**:
- Escutar mudanças do `PowerPointWindowsService`
- Enviar dados para Supabase
- Usar debouncing para evitar muitas atualizações
- Gerenciar erros de conexão

**Estrutura de Dados no Supabase**:
```json
{
  "id": "powerpoint_current",
  "data": {
    "currentSlide": 5,
    "slideCount": 14,
    "isInSlideShow": true,
    "video": {
      "hasVideo": true,
      "isPlaying": true,
      "currentTime": 308,
      "time": "00:05:08",
      "hours": 0,
      "minutes": 5,
      "seconds": 8
    }
  },
  "updated_at": "2025-01-XXT..."
}
```

**Métodos**:
- `constructor(supabaseAdapter: SupabaseAdapter, windowsService: PowerPointWindowsService)`
- `start()`: Inicia escuta e envio
- `stop()`: Para escuta
- `private onStatusChange(status: PowerPointStatus)`: Handler de mudanças
- `private sendToSupabase(status: PowerPointStatus)`: Envia para Supabase
- `private debounce()`: Debouncing de atualizações

#### 3.2 Integração com SupabaseAdapter
- Reutilizar `SupabaseAdapter` existente
- Criar método `sendPowerPointData(data: any)` ou usar método genérico
- Usar mesma tabela `ontime_realtime` ou criar `powerpoint_realtime`
- Verificar política RLS no Supabase

### Fase 4: Rotas de Configuração

#### 4.1 Adicionar Rotas
**Arquivo**: `apps/server/src/api-data/powerpoint/powerpoint.router.ts`

**Novas Rotas**:
- `GET /windows/status`: Status da conexão e último dado
- `POST /windows/config`: Configurar URL do app Windows
- `POST /windows/start`: Iniciar polling
- `POST /windows/stop`: Parar polling

#### 4.2 Controller de Configuração
**Arquivo**: `apps/server/src/api-data/powerpoint/powerpoint.controller.ts`

**Novos Métodos**:
- `getWindowsStatusController`: Retorna status do serviço Windows
- `configureWindowsController`: Configura e reinicia serviço
- `startWindowsController`: Inicia polling
- `stopWindowsController`: Para polling

**Resposta de Status**:
```json
{
  "connected": true,
  "url": "http://192.168.0.240:7800",
  "lastUpdate": "2025-01-XXT...",
  "pollInterval": 500,
  "status": {
    "currentSlide": 5,
    "slideCount": 14,
    ...
  }
}
```

### Fase 5: Frontend/Visualização

#### 5.1 Exposição via Supabase Realtime
As páginas podem se conectar diretamente ao Supabase para receber atualizações em tempo real:

```javascript
const supabase = createClient(supabaseUrl, supabaseKey);

const subscription = supabase
  .channel('powerpoint-updates')
  .on('postgres_changes', 
    { 
      event: '*', 
      schema: 'public', 
      table: 'powerpoint_realtime',
      filter: 'id=eq.powerpoint_current'
    }, 
    (payload) => {
      const status = payload.new.data;
      // Atualizar UI
      updateSlideDisplay(status.currentSlide, status.slideCount);
      if (status.video?.hasVideo) {
        updateVideoTime(status.video.time);
      }
    }
  )
  .subscribe();
```

#### 5.2 API REST Alternativa
Se preferir polling via API:
```
GET /api/powerpoint/status
```

Retorna dados normalizados no formato `PowerPointStatus`.

### Fase 6: Tratamento de Erros

#### 6.1 Reconexão Automática
- Backoff exponencial em caso de falhas
- Tentar reconectar após 1s, 2s, 4s, 8s... (max 30s)
- Log de erros para debugging

#### 6.2 Validação de Dados
- Validar formato de resposta antes de parsear
- Validar valores numéricos (slides, tempo)
- Tratar casos edge (vídeo sem tempo, slide inválido, etc.)

### Fase 7: Documentação

#### 7.1 README Atualizado
**Arquivo**: `apps/server/src/api-data/powerpoint/README.md`

**Conteúdo**:
- Configuração do app Windows
- Estrutura de dados
- Exemplos de uso
- Integração com Supabase
- Troubleshooting

#### 7.2 Exemplos de Código
- Exemplo de consumo via Supabase Realtime
- Exemplo de consumo via API REST
- Exemplo de configuração

## Ordem de Implementação

1. **Fase 1**: Criar serviço de polling (`powerpoint-windows.service.ts`)
2. **Fase 2**: Integrar no controller existente
3. **Fase 4**: Adicionar rotas de configuração
4. **Fase 3**: Integração com Supabase
5. **Fase 6**: Tratamento de erros e robustez
6. **Fase 5**: Documentação e exemplos
7. **Fase 7**: Testes e validação

## Arquivos a Criar/Modificar

### Novos Arquivos
- `apps/server/src/api-data/powerpoint/powerpoint-windows.service.ts`
- `apps/server/src/api-data/powerpoint/powerpoint-supabase.service.ts`

### Arquivos Modificados
- `apps/server/src/api-data/powerpoint/powerpoint.controller.ts`
- `apps/server/src/api-data/powerpoint/powerpoint.router.ts`
- `apps/server/src/api-data/powerpoint/README.md`

### Arquivos de Configuração
- `.env` ou variáveis de ambiente do servidor

## Dependências

### Bibliotecas Node.js
- `http`, `net` (nativos)
- `events` (EventEmitter - nativo)

### Integrações
- `SupabaseAdapter` existente
- Tabela no Supabase (criar se necessário)

## Testes

### Testes Unitários
- Parser de query string
- Normalização de dados
- Cálculo de `currentTime`
- Detecção de `isPlaying`

### Testes de Integração
- Conexão com app Windows
- Envio para Supabase
- Rotas de API
- Reconexão automática

## Métricas e Monitoramento

- Taxa de atualização (updates por segundo)
- Latência de conexão
- Taxa de erros
- Status de conexão
- Última atualização bem-sucedida

## Segurança

- Validar URL do app Windows (evitar SSRF)
- Sanitizar dados recebidos
- Rate limiting nas rotas de configuração
- Autenticação nas rotas de administração (se necessário)













