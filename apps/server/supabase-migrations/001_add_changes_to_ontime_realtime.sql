-- Migração: Adicionar coluna changes na tabela ontime_realtime
-- Execute este script no SQL Editor do Supabase se a coluna ainda não existir.

ALTER TABLE ontime_realtime
ADD COLUMN IF NOT EXISTS changes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ontime_realtime.changes IS 'Fila de alterações propostas pela web, pendentes de aprovação no desktop.';
