# Migrações Supabase - PowerPoint Realtime

Scripts SQL para criar e configurar a tabela `powerpoint_realtime` no Supabase.

## Como executar

### Opção 1: Via SQL Editor do Supabase (Recomendado)

1. Acesse o [Dashboard do Supabase](https://supabase.com/dashboard)
2. Selecione seu projeto
3. Vá em **SQL Editor**
4. Clique em **New Query**
5. Copie e cole o conteúdo de `001_create_powerpoint_realtime.sql`
6. Clique em **Run** (ou pressione Ctrl+Enter)

### Opção 2: Via CLI do Supabase

```bash
# Se você tem Supabase CLI instalado
supabase db push
```

### Opção 3: Via psql

```bash
psql -h <seu-host> -U postgres -d postgres -f 001_create_powerpoint_realtime.sql
```

## Verificação

Após executar, verifique:

1. **Tabela criada**:
   ```sql
   SELECT * FROM powerpoint_realtime;
   ```

2. **Realtime habilitado**:
   - Vá em **Database** → **Replication**
   - Verifique se `powerpoint_realtime` está listada

3. **Políticas RLS**:
   - Vá em **Authentication** → **Policies**
   - Verifique políticas da tabela `powerpoint_realtime`

## Estrutura da Tabela

```sql
powerpoint_realtime
├── id (TEXT, PRIMARY KEY) - Sempre "powerpoint_current"
├── data (JSONB) - Dados do PowerPoint
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

## Exemplo de Dados

```json
{
  "id": "powerpoint_current",
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

## Troubleshooting

### Erro: "relation already exists"
A tabela já existe. Execute apenas as partes que faltam ou remova `IF NOT EXISTS` se quiser recriar.

### Realtime não funciona
1. Verifique se a publicação `supabase_realtime` existe
2. Verifique se a tabela está na publicação: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';`

### Políticas RLS bloqueando
1. Verifique as políticas em **Authentication** → **Policies**
2. Se necessário, ajuste as políticas para permitir acesso













