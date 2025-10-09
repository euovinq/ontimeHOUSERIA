# 🚀 Integração Supabase Realtime com Ontime

## 📋 Configuração do Supabase

### 1. Criar Tabela no Supabase

```sql
-- Criar tabela para dados em tempo real
CREATE TABLE ontime_realtime (
  id TEXT PRIMARY KEY DEFAULT 'current',
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE ontime_realtime ENABLE ROW LEVEL SECURITY;

-- Política para permitir leitura pública (opcional)
CREATE POLICY "Allow public read access" ON ontime_realtime
  FOR SELECT USING (true);

-- Política para permitir inserção/atualização (opcional)
CREATE POLICY "Allow public upsert" ON ontime_realtime
  FOR ALL USING (true);

-- Criar índice para performance
CREATE INDEX idx_ontime_realtime_updated_at ON ontime_realtime(updated_at);
```

### 2. Configurar Ontime

```bash
# Configure as variáveis de ambiente do Supabase
export SUPABASE_URL="https://seu-projeto.supabase.co"
export SUPABASE_ANON_KEY="sua-chave-anonima"
export SUPABASE_TABLE="ontime_realtime"
```

### 3. Configurar via API

```bash
# Configurar Supabase no Ontime
curl -X POST http://localhost:3001/data/supabase/configure \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://seu-projeto.supabase.co",
    "anonKey": "sua-chave-anonima",
    "tableName": "ontime_realtime",
    "enabled": true
  }'
```

## 🔄 Como Funciona

### Arquitetura
```
Ontime Timer → EventStore → SupabaseAdapter → Supabase Realtime
     ↓              ↓              ↓              ↓
  Atualizações → WebSocket → Transformação → Banco de Dados
```

### Fluxo de Dados
1. **Timer atualiza** → EventStore recebe mudanças
2. **EventStore** → Dispara WebSocket + SupabaseAdapter
3. **SupabaseAdapter** → Transforma dados e envia para Supabase
4. **Supabase** → Atualiza tabela e notifica clientes via Realtime

## 📡 APIs Disponíveis

### Configurar Supabase
```bash
POST /data/supabase/configure
{
  "url": "https://seu-projeto.supabase.co",
  "anonKey": "sua-chave",
  "tableName": "ontime_realtime",
  "enabled": true
}
```

### Testar Conexão
```bash
GET /data/supabase/test
```

### Status da Conexão
```bash
GET /data/supabase/status
```

### Dados em Tempo Real
```bash
GET /data/realtime
# ou
GET /public/realtime
```

## 🖥️ Cliente JavaScript (Supabase)

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://seu-projeto.supabase.co',
  'sua-chave-anonima'
)

// Escutar mudanças em tempo real
const subscription = supabase
  .channel('ontime-updates')
  .on('postgres_changes', 
    { 
      event: '*', 
      schema: 'public', 
      table: 'ontime_realtime' 
    }, 
    (payload) => {
      console.log('Dados atualizados:', payload.new.data)
      
      // Atualizar UI com novos dados
      updateTimer(payload.new.data.timer)
      updateCurrentEvent(payload.new.data.currentEvent)
      updateNextEvent(payload.new.data.nextEvent)
      updateDelay(payload.new.data.delay)
    }
  )
  .subscribe()

// Função para atualizar timer
function updateTimer(timer) {
  document.getElementById('timer-current').textContent = 
    formatTime(timer.current)
  document.getElementById('timer-playback').textContent = 
    timer.playback
}

// Função para atualizar evento atual
function updateCurrentEvent(event) {
  if (event) {
    document.getElementById('current-title').textContent = event.title
    document.getElementById('current-cue').textContent = event.cue
  }
}
```

## 🎯 Vantagens desta Implementação

### ✅ **Integrado ao Sistema Existente**
- Usa a mesma arquitetura de tempo real do Ontime
- Não duplica lógica ou dados
- Performance otimizada

### ✅ **Tempo Real Verdadeiro**
- Atualizações automáticas via WebSocket
- Sem polling desnecessário
- Latência mínima

### ✅ **Flexível e Configurável**
- Pode ser habilitado/desabilitado
- Configuração via API
- Suporte a múltiplas tabelas

### ✅ **Robusto**
- Reconexão automática
- Tratamento de erros
- Logs detalhados

## 🔧 Troubleshooting

### Problema: Dados não atualizam
```bash
# Verificar status
curl http://localhost:3001/data/supabase/status

# Testar conexão
curl http://localhost:3001/data/supabase/test
```

### Problema: Erro de permissão
```sql
-- Verificar políticas RLS
SELECT * FROM pg_policies WHERE tablename = 'ontime_realtime';
```

### Problema: Performance
```sql
-- Verificar índices
SELECT * FROM pg_indexes WHERE tablename = 'ontime_realtime';
```

## 📊 Monitoramento

### Logs do Ontime
```bash
# Verificar logs do SupabaseAdapter
tail -f logs/ontime.log | grep "Supabase"
```

### Métricas do Supabase
- Dashboard do Supabase → Logs
- Monitorar queries e performance
- Verificar uso de Realtime

## 🚀 Próximos Passos

1. **Configurar Supabase** com a tabela
2. **Configurar Ontime** via API
3. **Testar conexão** e dados
4. **Implementar cliente** JavaScript
5. **Monitorar performance** e logs

---

**Resultado**: Dados do Ontime em tempo real no Supabase! 🎉
