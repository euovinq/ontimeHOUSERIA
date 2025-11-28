# Configuração de Assinatura Digital para macOS

## Requisitos

1. **Conta Apple Developer** (paga - $99/ano)
   - Acesse: https://developer.apple.com/programs/
   - Faça login e ative sua conta

2. **Certificado Developer ID Application**
   - Acesse: https://developer.apple.com/account/resources/certificates/list
   - Clique em "+" para criar novo certificado
   - Selecione "Developer ID Application"
   - Siga as instruções para criar o certificado

## Método 1: Configuração com Variáveis de Ambiente (Recomendado)

### Passo 1: Exportar o certificado

1. Abra o **Keychain Access** no Mac
2. Encontre o certificado "Developer ID Application: [Seu Nome]"
3. Clique com botão direito → **Exportar**
4. Salve como arquivo `.p12` (será solicitada uma senha - anote essa senha!)

### Passo 2: Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto ou configure as variáveis no seu sistema:

```bash
# Senha do arquivo .p12 (senha que você definiu ao exportar)
export CSC_KEY_PASSWORD="sua-senha-aqui"

# Caminho para o arquivo .p12 (ou base64 do certificado)
export CSC_LINK="/caminho/para/seu/certificado.p12"

# Ou use base64:
# export CSC_LINK="$(cat /caminho/para/seu/certificado.p12 | base64)"

# Seu Apple ID (email)
export APPLE_ID="seu-email@exemplo.com"

# Senha específica do app (gerada em https://appleid.apple.com)
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# Team ID (encontre em https://developer.apple.com/account)
export APPLE_TEAM_ID="ABC123XYZ"
```

### Passo 3: Gerar App-Specific Password

1. Acesse: https://appleid.apple.com
2. Vá em **Sign-In and Security** → **App-Specific Passwords**
3. Clique em **Generate an app-specific password**
4. Use essa senha em `APPLE_APP_SPECIFIC_PASSWORD`

### Passo 4: Encontrar Team ID

1. Acesse: https://developer.apple.com/account
2. No canto superior direito, você verá seu Team ID
3. Copie esse ID para `APPLE_TEAM_ID`

### Passo 5: Construir o aplicativo

```bash
pnpm build:electron
pnpm dist-mac
```

## Método 2: Configuração Local (Sem CI/CD)

Se você já tem o certificado instalado no Keychain:

1. O `electron-builder` automaticamente detectará o certificado
2. Certifique-se de que o certificado está marcado como "Always Trust"
3. Execute normalmente:

```bash
pnpm build:electron
pnpm dist-mac
```

## Método 3: Desabilitar Assinatura (Apenas para desenvolvimento)

Para builds locais sem assinatura (não recomendado para distribuição):

```bash
pnpm dist-mac:local
```

Ou ajuste o `package.json` para desabilitar:

```json
"mac": {
  "identity": null,
  "notarize": false,
  ...
}
```

## Verificar Certificados Instalados

Para verificar quais certificados você tem:

```bash
security find-identity -v -p codesigning
```

## Troubleshooting

### Erro: "No identity found"
- Certifique-se de que o certificado está instalado no Keychain
- Verifique se o certificado é do tipo "Developer ID Application"
- Certifique-se de que o certificado está válido (não expirado)

### Erro: "Notarization failed"
- Verifique se `APPLE_ID` e `APPLE_APP_SPECIFIC_PASSWORD` estão corretos
- Verifique se `APPLE_TEAM_ID` está correto
- Certifique-se de que a senha específica do app está correta

### Erro: "Code signing failed"
- Verifique se `CSC_KEY_PASSWORD` está correto
- Verifique se `CSC_LINK` aponta para o arquivo correto
- Certifique-se de que o certificado não expirou




