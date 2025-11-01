# PowerPoint Integration para Windows

Este módulo nativo usa a API **COM/ActiveX** do PowerPoint no Windows, que é **muito mais rica e confiável** que no macOS!

## Vantagens no Windows

✅ **API COM Completa**: O PowerPoint expõe todas as propriedades via COM
✅ **duration e currentTime em tempo real**: Disponíveis diretamente via `MediaFormat`
✅ **isPlaying confiável**: Reportado corretamente pelo PowerPoint
✅ **Volume e Mute**: Acessíveis diretamente
✅ **Não requer permissões especiais**: Diferente do macOS
✅ **Mais rápido**: COM é mais eficiente que AppleScript

## Como funciona

O código usa a interface COM do PowerPoint (`PowerPoint.Application`) para:
- Obter slide atual
- Detectar vídeos no slide
- Ler `MediaFormat.Length` (duração)
- Ler `MediaFormat.CurrentPosition` (tempo atual)
- Ler `MediaFormat.IsPlaying` (status de reprodução)

## Instalação

```bash
cd apps/server/src/native/powerpoint-windows
npm install
npm run build
```

## Estrutura

- `powerpoint_com.cpp`: Implementação usando COM
- `binding.gyp`: Configuração de build
- `index.js`: Interface JavaScript
- `package.json`: Dependências

## Dependências

- Node.js com node-gyp
- Visual Studio Build Tools (para Windows)
- PowerPoint instalado (para ter as interfaces COM)

## Uso

```javascript
const { getPowerPointStatus } = require('./index.js');
const status = getPowerPointStatus();

if (status.video?.hasVideo) {
  console.log(`Duração: ${status.video.duration}s`);
  console.log(`Tempo atual: ${status.video.currentTime}s`);
  console.log(`Tocando: ${status.video.isPlaying}`);
}
```





