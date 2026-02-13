-- Migração: Adicionar coluna edit_access_codes na tabela ontime_realtime
-- Execute este script no SQL Editor do Supabase se a coluna ainda não existir.

ALTER TABLE ontime_realtime
ADD COLUMN IF NOT EXISTS edit_access_codes JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ontime_realtime.edit_access_codes IS 'Códigos de acesso para edição sem autenticação, por campo customizado (ex: {"PALCO": "abc123", "ROTEIRO": "def456"})';
