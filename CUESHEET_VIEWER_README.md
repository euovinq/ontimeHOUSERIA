# 🎬 Cuesheet Viewer para Next.js

Visualização completa do cuesheet do Ontime em tempo real usando Supabase.

## 📁 Arquivos Criados

- `cuesheet-viewer.jsx` - Versão completa com todos os detalhes
- `cuesheet-compact.jsx` - Versão compacta para dashboards
- `nextjs-cuesheet-example.js` - Exemplos de uso

## 🚀 Como Usar

### 1. Instalar Dependências

```bash
npm install @supabase/supabase-js
```

### 2. Copiar Componentes

Copie os arquivos `.jsx` para sua pasta `components/`:

```bash
cp cuesheet-viewer.jsx components/CuesheetViewer.jsx
cp cuesheet-compact.jsx components/CuesheetCompact.jsx
```

### 3. Usar nos Componentes

#### Versão Completa
```jsx
import CuesheetViewer from '../components/CuesheetViewer'

export default function CuesheetPage() {
  return <CuesheetViewer />
}
```

#### Versão Compacta
```jsx
import CuesheetCompact from '../components/CuesheetCompact'

export default function Dashboard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2>Dashboard</h2>
        {/* Outros componentes */}
      </div>
      <div>
        <h2>Cuesheet</h2>
        <CuesheetCompact />
      </div>
    </div>
  )
}
```

## 🎨 Recursos

### ✅ **Funcionalidades**
- **Tempo real** - Atualizações automáticas via Supabase
- **Visualização completa** - Todos os eventos do rundown
- **Status visual** - Evento atual, próximo e futuros
- **Timer em tempo real** - Contador atual do evento
- **Delay/Offset** - Mostra se está adiantado ou atrasado
- **Custom fields** - Campos personalizados do Ontime
- **Responsivo** - Funciona em desktop e mobile

### 🎯 **Informações Exibidas**
- **Lista completa** de eventos
- **Cue** de cada evento
- **Título** e notas
- **Duração** e horários
- **Status** (atual, próximo, futuro)
- **Timer** em tempo real
- **Delay** do sistema
- **Custom fields** configurados

### 📱 **Layouts Disponíveis**
- **Completo** - Tela cheia com todos os detalhes
- **Compacto** - Para dashboards e sidebars
- **Mobile** - Otimizado para dispositivos móveis

## 🎨 Estilização

### Tailwind CSS
Os componentes usam Tailwind CSS. Adicione ao seu `tailwind.config.js`:

```js
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### Cores e Status
- 🔵 **Azul** - Evento atual
- 🟢 **Verde** - Próximo evento
- ⚪ **Cinza** - Eventos futuros
- 🔴 **Vermelho** - Atrasado
- 🟢 **Verde** - Adiantado

## 📊 Dados em Tempo Real

### Estrutura dos Dados
```javascript
{
  timer: {
    current: 120000,        // Tempo atual (ms)
    duration: 300000,       // Duração total (ms)
    playback: "play",       // Status: play/pause/stop
    phase: "default"        // Fase do timer
  },
  currentEvent: {
    id: "event-123",
    cue: "1",
    title: "PRIMEIRO EVENTO",
    note: "Nota do evento",
    timeStart: 0,
    timeEnd: 600000,
    duration: 600000,
    isPublic: true,
    custom: {}
  },
  nextEvent: { /* ... */ },
  delay: {
    offset: -5000,          // Atraso em ms
    relativeOffset: -3000   // Atraso relativo
  },
  cuesheet: {
    rundown: [              // Array com todos os eventos
      {
        id: "event-123",
        cue: "1",
        title: "PRIMEIRO EVENTO",
        duration: 600000,
        timeStart: 0,
        timeEnd: 600000,
        isPublic: true,
        custom: {}
      }
    ],
    customFields: {         // Campos personalizados
      song: {
        type: "string",
        colour: "#339E4E",
        label: "Song"
      }
    },
    totalEvents: 2,         // Total de eventos
    totalDuration: 1200000  // Duração total (ms)
  }
}
```

## 🔧 Personalização

### Modificar Cores
```jsx
// No componente, altere as classes Tailwind
const getEventStatusColor = (status) => {
  switch (status) {
    case 'current': return 'bg-blue-100 border-blue-500 text-blue-800'
    case 'next': return 'bg-green-100 border-green-500 text-green-800'
    default: return 'bg-gray-100 border-gray-300 text-gray-700'
  }
}
```

### Adicionar Campos
```jsx
// Adicione novos campos no evento
<div className="text-sm text-gray-600">
  {event.custom?.song && (
    <span>Música: {event.custom.song}</span>
  )}
  {event.custom?.artist && (
    <span>Artista: {event.custom.artist}</span>
  )}
</div>
```

### Modificar Layout
```jsx
// Altere o grid para diferentes layouts
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {/* Seus componentes */}
</div>
```

## 🚀 Exemplos de Uso

### 1. Página Dedicada
```jsx
// pages/cuesheet.js
import CuesheetViewer from '../components/CuesheetViewer'

export default function CuesheetPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <CuesheetViewer />
    </div>
  )
}
```

### 2. Dashboard
```jsx
// components/Dashboard.jsx
import CuesheetCompact from './CuesheetCompact'

export default function Dashboard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        {/* Outros componentes */}
      </div>
      <div>
        <CuesheetCompact />
      </div>
    </div>
  )
}
```

### 3. Modal/Popup
```jsx
// components/CuesheetModal.jsx
import { useState } from 'react'
import CuesheetCompact from './CuesheetCompact'

export default function CuesheetModal() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button onClick={() => setIsOpen(true)}>
        Ver Cuesheet
      </button>
      
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="p-4 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold">Cuesheet</h2>
                <button onClick={() => setIsOpen(false)}>×</button>
              </div>
            </div>
            <div className="p-4">
              <CuesheetCompact />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

## 🎯 Próximos Passos

1. **Copie os arquivos** para seu projeto Next.js
2. **Instale as dependências** necessárias
3. **Customize** conforme sua necessidade
4. **Teste** com dados reais do Ontime
5. **Deploy** e compartilhe!

## 📞 Suporte

Se precisar de ajuda ou quiser customizações específicas, me avise! 🚀












































