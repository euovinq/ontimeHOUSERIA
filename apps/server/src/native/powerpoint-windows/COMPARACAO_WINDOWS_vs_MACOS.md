# Comparação: Windows vs macOS para PowerPoint

## 🏆 Windows é MUITO MELHOR!

### No Windows (API COM):

✅ **duration**: Disponível diretamente via `MediaFormat.Length`
✅ **currentTime**: Disponível diretamente via `MediaFormat.CurrentPosition` (em tempo real!)
✅ **isPlaying**: Reportado corretamente via `MediaFormat.IsPlaying`
✅ **volume**: Disponível via `MediaFormat.Volume`
✅ **muted**: Disponível via `MediaFormat.Muted`
✅ **Não requer permissões especiais**
✅ **Mais rápido e confiável**
✅ **API completa e bem documentada**

### No macOS (AppleScript/Scripting Bridge):

❌ **duration**: Precisa extrair do arquivo .pptx ou inferir
❌ **currentTime**: Frequentemente retorna 0 (limitação do PowerPoint)
❌ **isPlaying**: Não confiável, frequentemente retorna false mesmo quando está tocando
❌ **volume/muted**: Limitado ou não disponível
❌ **Requer permissões de acessibilidade**
❌ **ScreenCaptureKit**: Requer permissões de captura de tela/áudio
❌ **API limitada e pouco documentada**

## Por que Windows é melhor?

O PowerPoint no Windows foi projetado para automação via COM/ActiveX desde o início. A interface `MediaFormat` expõe TODAS as propriedades de mídia diretamente.

No macOS, o PowerPoint usa uma interface AppleScript/Scripting Bridge que não foi projetada para isso e tem limitações significativas.

## Solução mencionada pelo usuário

O usuário mencionou um app que "arrasta o PPT para dentro dele e executa o PowerPoint" - isso faz sentido porque:
1. O app controla o PowerPoint via COM
2. Pode interceptar todos os eventos e propriedades
3. Tem acesso completo ao objeto `MediaFormat`

## Implementação

A implementação para Windows usa:
- `#import "progid:PowerPoint.Application"` - Importa as interfaces COM
- `MediaFormatPtr` - Interface rica do PowerPoint
- Acesso direto a todas as propriedades sem workarounds





