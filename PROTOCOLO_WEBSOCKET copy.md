# Documentação do Protocolo WebSocket

## Visão Geral

O servidor transmite dados em tempo real sobre apresentações PowerPoint em execução via WebSocket. Todas as mensagens são enviadas no formato JSON e são transmitidas automaticamente quando ocorrem eventos relevantes.

**URL de Conexão**: `ws://<IP>:<PORTA>` (ex: `ws://192.168.0.102:7800`)

## Descoberta Automática

Antes de conectar, você pode usar o sistema de descoberta automática para encontrar o servidor na rede local:

- **Porta UDP**: 7899
- **Protocolo**: UDP Broadcast
- **Formato**: JSON

```json
{
  "service": "houseria-ppt-control",
  "version": "1.0",
  "ip": "192.168.0.102",
  "port": 7800,
  "device_name": "PC-Vinicius",
  "timestamp": 1234567890
}
```

Veja `discovery_client.py` para exemplo de implementação.

---

## Tipos de Mensagens

### 1. Mensagem de Boas-Vindas (`connected`)

**Quando é enviada**: Imediatamente após um cliente se conectar ao WebSocket.

**Formato**:
```json
{
  "type": "connected",
  "message": "Conectado ao servidor PowerPoint"
}
```

**Campos**:
- `type` (string): Sempre `"connected"`
- `message` (string): Mensagem de confirmação

**Exemplo de uso**:
```javascript
websocket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "connected") {
    console.log("Conectado com sucesso!");
  }
};
```

---

### 2. Informações de Todos os Slides (`slides_info`)

**Quando é enviada**:
- Imediatamente após abrir uma apresentação
- A cada 2 segundos durante o monitoramento (para manter sincronização)

**Formato**:
```json
{
  "type": "slides_info",
  "total_slides": 10,
  "slides": [
    {
      "index": 0,
      "title": "Introdução",
      "hidden": false,
      "has_video": false,
      "notes": "Notas do apresentador sobre este slide"
    },
    {
      "index": 1,
      "title": "Visão Geral",
      "hidden": false,
      "has_video": true,
      "notes": ""
    },
    {
      "index": 2,
      "title": "",
      "hidden": true,
      "has_video": false,
      "notes": ""
    }
  ]
}
```

**Campos**:
- `type` (string): Sempre `"slides_info"`
- `total_slides` (integer): Número total de slides na apresentação
- `slides` (array): Lista de objetos, cada um representando um slide
  - `index` (integer): Índice do slide (0-based)
  - `title` (string): Título do slide (vazio se não tiver título)
  - `hidden` (boolean): `true` se o slide está oculto na apresentação
  - `has_video` (boolean): `true` se o slide contém um vídeo
  - `notes` (string): Notas do apresentador (vazio se não tiver notas)

**Exemplo de uso**:
```javascript
if (data.type === "slides_info") {
  console.log(`Total de slides: ${data.total_slides}`);
  
  data.slides.forEach(slide => {
    console.log(`Slide ${slide.index + 1}: ${slide.title || "Sem título"}`);
    if (slide.has_video) {
      console.log("  ⚠️  Este slide tem vídeo");
    }
    if (slide.hidden) {
      console.log("  👁️  Slide oculto");
    }
  });
}
```

---

### 3. Slide Atual (`current_slide`)

**Quando é enviada**:
- Ao abrir uma apresentação (mostra o slide inicial)
- Sempre que o usuário avança/retrocede slides durante a apresentação

**Formato**:
```json
{
  "type": "current_slide",
  "slide_index": 5,
  "slide_title": "Recursos Principais",
  "slide_notes": "Destacar os 3 recursos principais do produto"
}
```

**Campos**:
- `type` (string): Sempre `"current_slide"`
- `slide_index` (integer): Índice do slide atual (0-based)
- `slide_title` (string): Título do slide atual (vazio se não tiver)
- `slide_notes` (string): Notas do apresentador para este slide (vazio se não tiver)

**Nota**: Para obter o número do slide (1-based), some 1 ao `slide_index`.

**Exemplo de uso**:
```javascript
if (data.type === "current_slide") {
  const slideNumber = data.slide_index + 1;
  console.log(`Agora no slide ${slideNumber}`);
  console.log(`Título: ${data.slide_title || "Sem título"}`);
  
  if (data.slide_notes) {
    console.log(`Notas: ${data.slide_notes}`);
  }
}
```

---

### 4. Status de Vídeo (`video_status`)

**Quando é enviada**:
- Quando um vídeo é detectado no slide atual
- A cada segundo enquanto o vídeo está reproduzindo (se a duração estiver disponível)
- Quando não há mais vídeo no slide (transição para slide sem vídeo)

**Formato - Vídeo Reproduzindo**:
```json
{
  "type": "video_status",
  "slide_index": 5,
  "is_playing": true,
  "current_time": 12.5,
  "duration": 60.0,
  "remaining_time": 47.5,
  "has_video": true
}
```

**Formato - Sem Vídeo**:
```json
{
  "type": "video_status",
  "slide_index": 5,
  "is_playing": false,
  "current_time": 0,
  "duration": 0,
  "remaining_time": 0
}
```

**Campos**:
- `type` (string): Sempre `"video_status"`
- `slide_index` (integer): Índice do slide onde o vídeo está (0-based)
- `is_playing` (boolean): `true` se o vídeo está reproduzindo, `false` caso contrário
- `current_time` (float): Tempo atual do vídeo em segundos
- `duration` (float): Duração total do vídeo em segundos (0 se não disponível)
- `remaining_time` (float): Tempo restante do vídeo em segundos
- `has_video` (boolean): `true` se há vídeo no slide (pode estar `true` mesmo se `is_playing` for `false`)

**Notas Importantes**:
- `duration` pode ser `0` se a API COM do PowerPoint não conseguir obter essa informação
- `current_time` e `remaining_time` são calculados baseados no tempo decorrido desde que o vídeo foi detectado (quando `duration > 0`)
- Se `duration` for `0`, apenas `has_video` e `is_playing` estarão disponíveis

**Exemplo de uso**:
```javascript
if (data.type === "video_status") {
  if (data.has_video && data.is_playing) {
    if (data.duration > 0) {
      const currentMin = Math.floor(data.current_time / 60);
      const currentSec = Math.floor(data.current_time % 60);
      const remainingMin = Math.floor(data.remaining_time / 60);
      const remainingSec = Math.floor(data.remaining_time % 60);
      
      console.log(`🎬 Vídeo no slide ${data.slide_index + 1}`);
      console.log(`   Tempo: ${currentMin}:${currentSec.toString().padStart(2, '0')}`);
      console.log(`   Restante: ${remainingMin}:${remainingSec.toString().padStart(2, '0')}`);
    } else {
      console.log(`🎬 Vídeo reproduzindo no slide ${data.slide_index + 1} (duração não disponível)`);
    }
  } else {
    console.log(`Sem vídeo no slide ${data.slide_index + 1}`);
  }
}
```

---

### 5. Resposta a Ping (`pong`)

**Quando é enviada**: Quando o cliente envia a string `"ping"` (sem JSON).

**Formato**:
```json
{
  "type": "pong"
}
```

**Campos**:
- `type` (string): Sempre `"pong"`

**Exemplo de uso**:
```javascript
// Enviar ping para testar conexão
websocket.send("ping");

// Receber pong
websocket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "pong") {
    console.log("Conexão está viva!");
  }
};
```

---

## Fluxo de Dados Típico

### 1. Conexão Inicial

```
Cliente conecta
  ↓
Servidor envia: {"type": "connected", ...}
```

### 2. Abertura de Apresentação

```
PPT é aberto
  ↓
Servidor envia: {"type": "slides_info", ...}  (lista completa)
Servidor envia: {"type": "current_slide", ...}  (slide inicial)
```

### 3. Durante a Apresentação

```
Usuário avança slide
  ↓
Servidor envia: {"type": "current_slide", ...}

Se slide tem vídeo:
  ↓
Servidor envia: {"type": "video_status", ...}  (quando detecta)
Servidor envia: {"type": "video_status", ...}  (a cada segundo)

Usuário avança para slide sem vídeo:
  ↓
Servidor envia: {"type": "current_slide", ...}
Servidor envia: {"type": "video_status", "is_playing": false, ...}
```

### 4. Monitoramento Contínuo

```
A cada 2 segundos:
  ↓
Servidor envia: {"type": "slides_info", ...}  (atualização completa)
```

---

## Exemplo Completo de Cliente

### JavaScript (Web Browser)

```javascript
// Descobrir servidor (opcional)
// ... usar discovery_client ou conectar diretamente

const ws = new WebSocket("ws://192.168.0.102:7800");

ws.onopen = () => {
  console.log("Conectado ao servidor");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case "connected":
      console.log("✅", data.message);
      break;
      
    case "slides_info":
      console.log(`📊 ${data.total_slides} slides na apresentação`);
      // Atualizar UI com lista de slides
      break;
      
    case "current_slide":
      console.log(`📄 Slide atual: ${data.slide_index + 1}`);
      // Atualizar UI com slide atual
      break;
      
    case "video_status":
      if (data.is_playing) {
        console.log(`🎬 Vídeo: ${data.current_time.toFixed(1)}s / ${data.duration.toFixed(1)}s`);
        // Atualizar barra de progresso do vídeo
      }
      break;
      
    case "pong":
      console.log("🏓 Pong recebido");
      break;
  }
};

ws.onerror = (error) => {
  console.error("Erro:", error);
};

ws.onclose = () => {
  console.log("Conexão fechada");
};
```

### Python

```python
import asyncio
import websockets
import json
from discovery_client import find_server

async def main():
    # Encontrar servidor automaticamente
    server = find_server(timeout=5.0)
    if not server:
        print("Servidor não encontrado")
        return
    
    uri = f"ws://{server['ip']}:{server['port']}"
    print(f"Conectando em {uri}...")
    
    async with websockets.connect(uri) as websocket:
        async for message in websocket:
            data = json.loads(message)
            
            if data["type"] == "connected":
                print("✅", data["message"])
            elif data["type"] == "slides_info":
                print(f"📊 {data['total_slides']} slides")
            elif data["type"] == "current_slide":
                print(f"📄 Slide {data['slide_index'] + 1}: {data.get('slide_title', 'Sem título')}")
            elif data["type"] == "video_status":
                if data["is_playing"]:
                    print(f"🎬 Vídeo: {data['current_time']:.1f}s / {data['duration']:.1f}s")

asyncio.run(main())
```

---

## Tratamento de Erros

### Conexão Perdida

Se a conexão WebSocket for perdida, o cliente deve:
1. Tentar reconectar automaticamente
2. Usar descoberta automática novamente para encontrar o servidor (caso o IP tenha mudado)

### Mensagens Inválidas

Se receber uma mensagem que não seja JSON válido, ignore e continue escutando.

### Timeout

O servidor não fecha conexões por timeout, mas é recomendado que o cliente envie `"ping"` periodicamente para verificar se a conexão está viva.

---

## Limitações Conhecidas

1. **Informações de Vídeo**: Dependendo da versão do PowerPoint e da API COM disponível, algumas propriedades de vídeo podem não estar disponíveis:
   - `duration` pode ser `0` mesmo que o vídeo tenha duração
   - `current_time` é calculado baseado no tempo decorrido, não no tempo real do player

2. **Frequência de Atualização**: 
   - `slides_info` é enviado a cada 2 segundos (não em tempo real)
   - `video_status` é enviado a cada segundo quando há vídeo com duração

3. **Múltiplos Vídeos**: Se um slide tiver múltiplos vídeos, apenas o primeiro será detectado.

---

## Versão do Protocolo

**Versão Atual**: 1.0

**Identificador**: `"houseria-ppt-control"` (usado na descoberta automática)

---

## Suporte

Para questões ou problemas com o protocolo, consulte:
- `README.md` - Documentação geral do projeto
- `exemplo_cliente.py` - Exemplo de implementação em Python
- `discovery_client.py` - Código fonte do cliente de descoberta

