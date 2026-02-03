# Atualização: Machine ID ao invés de IP

## Resumo das Mudanças

O sistema foi atualizado para usar **Machine ID** (identificador único baseado em hardware) ao invés de **IP** para identificar máquinas. Isso é mais confiável porque:

- ✅ Machine ID não muda mesmo se o IP mudar
- ✅ Machine ID é único por máquina física
- ✅ Mais seguro e difícil de falsificar
- ✅ Funciona mesmo em redes dinâmicas (DHCP, VPN, etc)

## Mudanças no Electron

### 1. Dependência Adicionada

```json
"dependencies": {
  "node-machine-id": "^1.1.12"
}
```

### 2. AuthService.js

- Adicionada captura automática de Machine ID no construtor
- Machine ID é enviado no body do login: `{ email, password, machineId }`
- Fallback para ID baseado em hostname se `node-machine-id` falhar

## Mudanças no Servidor

### 1. auth.controller.ts

- Endpoint `/auth/login` agora recebe `machineId` opcional no body
- `machineId` será armazenado em `machine_info.machineId` no JSONB

### 2. Estrutura de machine_info

**Antes (usando IP):**
```json
{
  "ip": "177.181.0.12",
  "userAgent": "node",
  "timestamp": "2026-01-22T22:43:55.416Z"
}
```

**Agora (usando Machine ID):**
```json
{
  "machineId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "ip": "177.181.0.12",  // Mantido para referência
  "userAgent": "node",
  "timestamp": "2026-01-22T22:43:55.416Z"
}
```

## Script SQL Corrigido

Foi criado o arquivo `TRIGGER_CHECK_MAX_SESSIONS_CORRIGIDO.sql` que corrige o erro:

```
operator does not exist: timestamp with time zone > time with time zone
```

### Como Aplicar

1. Acesse o SQL Editor do Supabase
2. Execute o script `TRIGGER_CHECK_MAX_SESSIONS_CORRIGIDO.sql`
3. Verifique se o trigger foi recriado corretamente

### Correções no Trigger

- Garantia explícita de tipos TIMESTAMPTZ
- Uso de `NOW()` para garantir tipo correto
- Comparações explícitas de tipo

## Próximos Passos

1. ✅ Adicionar `node-machine-id` ao Electron
2. ✅ Atualizar AuthService para enviar Machine ID
3. ✅ Atualizar servidor para receber Machine ID
4. ⏳ Atualizar sistema de sessões no servidor para usar Machine ID
5. ⏳ Executar script SQL corrigido no Supabase
6. ⏳ Testar login com Machine ID

## Notas Importantes

- O Machine ID é gerado automaticamente no Electron
- Se `node-machine-id` falhar, um fallback é usado
- O IP ainda é coletado para referência, mas não é usado como identificador principal
- O Machine ID é único por máquina e não muda mesmo após reinstalação do sistema (baseado em hardware)
