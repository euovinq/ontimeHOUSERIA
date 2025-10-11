// Exemplo de como usar o Cuesheet Viewer no Next.js

// 1. Instalar dependências:
// npm install @supabase/supabase-js

// 2. Criar página: pages/cuesheet.js ou app/cuesheet/page.jsx

import CuesheetViewer from '../components/CuesheetViewer'
import CuesheetCompact from '../components/CuesheetCompact'

// Versão completa
export default function CuesheetPage() {
  return (
    <div>
      <CuesheetViewer />
    </div>
  )
}

// Versão compacta para dashboard
export function DashboardWithCuesheet() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-xl font-bold mb-4">Dashboard</h2>
        {/* Outros componentes do dashboard */}
      </div>
      <div>
        <h2 className="text-xl font-bold mb-4">Cuesheet</h2>
        <CuesheetCompact />
      </div>
    </div>
  )
}

// Versão mobile-friendly
export function MobileCuesheet() {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Cuesheet</h1>
        <p className="text-gray-600">Visualização em tempo real</p>
      </div>
      <CuesheetCompact />
    </div>
  )
}

// 3. Exemplo de uso com Tailwind CSS
// Adicione ao seu tailwind.config.js:
/*
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
*/

// 4. Exemplo de página completa
export function FullCuesheetPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Ontime Cuesheet</h1>
              <p className="text-gray-600">Visualização em tempo real</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Última atualização</div>
              <div className="text-lg font-mono">{new Date().toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CuesheetViewer />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-gray-600">
            Dados em tempo real do Ontime
          </p>
        </div>
      </footer>
    </div>
  )
}

// 5. Exemplo com diferentes layouts
export function CuesheetLayouts() {
  return (
    <div className="space-y-8">
      {/* Layout 1: Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Controles</h3>
            {/* Controles aqui */}
          </div>
        </div>
        <div className="lg:col-span-3">
          <CuesheetViewer />
        </div>
      </div>

      {/* Layout 2: Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            <button className="border-b-2 border-blue-500 py-4 px-1 text-sm font-medium text-blue-600">
              Cuesheet
            </button>
            <button className="border-b-2 border-transparent py-4 px-1 text-sm font-medium text-gray-500 hover:text-gray-700">
              Timer
            </button>
            <button className="border-b-2 border-transparent py-4 px-1 text-sm font-medium text-gray-500 hover:text-gray-700">
              Status
            </button>
          </nav>
        </div>
        <div className="p-6">
          <CuesheetCompact />
        </div>
      </div>

      {/* Layout 3: Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CuesheetCompact />
        </div>
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Timer Atual</h3>
            {/* Timer atual */}
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Próximo Evento</h3>
            {/* Próximo evento */}
          </div>
        </div>
      </div>
    </div>
  )
}




































