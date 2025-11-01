# PowerPoint API

API HTTP para obter informações do PowerPoint em tempo real, com suporte a módulos nativos (macOS/Windows COM) e app Windows via rede.

## Endpoints

### Status do PowerPoint
```
GET /api/powerpoint/status
```

Retorna o status atual do PowerPoint. Usa módulo nativo se disponível, senão usa o app Windows como fallback.

### Configuração do App Windows
```
GET /api/powerpoint/windows/status
POST /api/powerpoint/windows/config
POST /api/powerpoint/windows/start
POST /api/powerpoint/windows/stop
```

## Resposta

```json
{
  "isAvailable": true,
  "slideCount": 14,
  "visibleSlideCount": 14,
  "currentSlide": 5,
  "isInSlideShow": true,
  "slidesRemaining": 9,
  "hiddenSlides": [],
  "video": {
    "hasVideo": true,
    "isPlaying": true,
    "duration": 0,
    "currentTime": 308,
    "remainingTime": 0,
    "volume": 0,
    "muted": false,
    "fileName": "",
    "sourceUrl": "",
    "time": "00:05:08",
    "hours": 0,
    "minutes": 5,
    "seconds": 8
  },
  "timestamp": 1698745600000
}
```

## Configuração

### Variáveis de Ambiente

- `POWERPOINT_WINDOWS_URL`: URL do app Windows (padrão: `http://192.168.0.240:7800`)
- `POWERPOINT_WINDOWS_POLL_INTERVAL`: Intervalo de polling em ms (padrão: `500`)

### Configuração via API

```bash
POST /api/powerpoint/windows/config
Content-Type: application/json

{
  "url": "http://192.168.0.240:7800",
  "pollInterval": 500
}
```

## Integração com Supabase

Os dados são automaticamente enviados para o Supabase quando:
1. O serviço Windows está ativo
2. O Supabase está configurado e conectado
3. Os dados mudam (com debouncing de 500ms)

### Criar Tabela no Supabase

**IMPORTANTE**: Antes de usar, você precisa criar a tabela no Supabase:

1. Acesse o SQL Editor do Supabase
2. Execute o script: `supabase-migrations/001_create_powerpoint_realtime.sql`
3. Execute também: `supabase-migrations/002_add_project_code.sql` (para suporte multi-projeto)
4. Ou copie e cole o conteúdo dos arquivos no SQL Editor

Veja `supabase-migrations/README.md` para instruções detalhadas.

### Estrutura no Supabase (Multi-Projeto)

**Importante**: Cada projeto tem sua própria linha na tabela `powerpoint_realtime`, identificada pelo `project_code` do projeto.

Os dados são salvos na tabela `powerpoint_realtime` (ou `ontime_realtime` como fallback):

```json
{
  "id": "ABC12",
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

**Nota**: O campo `id` é o `project_code` do projeto (ex: "ABC12"), não mais um valor fixo.

### Consumo via Supabase Realtime (Frontend)

Cada projeto deve filtrar por seu próprio `project_code`:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(supabaseUrl, supabaseKey);

// Obter project_code do projeto atual
const projectCode = 'ABC12'; // Substitua pelo project_code do seu projeto

// Escutar mudanças em tempo real para este projeto específico
const subscription = supabase
  .channel('powerpoint-updates')
  .on('postgres_changes', 
    { 
      event: '*', 
      schema: 'public', 
      table: 'powerpoint_realtime',
      filter: `id=eq.${projectCode}` // Filtra apenas este projeto
    }, 
    (payload) => {
      const status = payload.new.data;
      console.log('Slide atual:', status.currentSlide);
      if (status.video?.hasVideo) {
        console.log('Vídeo:', status.video.time);
      }
    }
  )
  .subscribe();
```

**Comportamento Multi-Projeto**:

- Quando você habilita o botão PPT (verde): envia o último dado disponível imediatamente para o Supabase
- Quando você desabilita o botão PPT (vermelho): apaga a linha correspondente ao `project_code` do projeto atual
- Cada projeto conectado cria/atualiza sua própria linha na tabela
- Múltiplos projetos podem usar o sistema simultaneamente sem interferência

## Funcionamento

### Módulo Nativo (Prioridade 1)
- **macOS**: Usa Accessibility API + AppleScript + ScreenCaptureKit
- **Windows**: Usa API COM do PowerPoint (mais rico e confiável)

### App Windows (Fallback)
- Faz polling HTTP para o app Windows na rede
- Parseia resposta em formato query string
- Normaliza dados para formato consistente
- Funciona em qualquer plataforma (não requer módulo nativo)

## Cache

A API usa cache de 250ms para evitar sobrecarga. Pode ser acessada com segurança a cada 1 segundo.

## Arquivos

- **powerpoint.controller.ts**: Controller com lógica de cache, fallback e tratamento de erros
- **powerpoint.router.ts**: Definição das rotas HTTP
- **powerpoint-windows.service.ts**: Serviço de polling do app Windows
- **powerpoint-supabase.service.ts**: Integração com Supabase para tempo real

## Troubleshooting

### App Windows não conecta
1. Verifique se o app está rodando na URL configurada
2. Teste conectividade: `nc -zv 192.168.0.240 7800`
3. Verifique logs do servidor para erros de conexão
4. Configure URL manualmente via API

### Dados não aparecem no Supabase
1. Verifique se Supabase está configurado e conectado
2. Verifique tabela `powerpoint_realtime` existe (ou usa `ontime_realtime`)
3. Verifique políticas RLS no Supabase
4. Verifique logs do servidor para erros de envio

### Vídeo não detectado
- O app Windows só envia dados de vídeo quando há vídeo tocando
- Verifique se `hours`, `minutes`, `seconds` estão presentes na resposta
- Verifique se está em modo apresentação
