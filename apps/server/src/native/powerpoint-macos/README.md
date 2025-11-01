# PowerPoint macOS Integration

Módulo nativo para capturar informações do PowerPoint no macOS.

## Arquivos

- **powerpoint_accessibility.mm**: Código principal em Objective-C++ que usa Accessibility API
- **index.js**: Wrapper JavaScript que expõe a função `getPowerPointStatus()`
- **binding.gyp**: Configuração para compilar o módulo nativo com node-gyp
- **package.json**: Dependências e scripts de build
- **get_hidden_slides.applescript**: Script AppleScript para detectar slides ocultos

## Build

```bash
cd apps/server/src/native/powerpoint-macos
npm install
npm run build
```

## Uso

O módulo é usado pela API HTTP em `apps/server/src/api-data/powerpoint/`

Endpoint: `GET /api/powerpoint/status`
