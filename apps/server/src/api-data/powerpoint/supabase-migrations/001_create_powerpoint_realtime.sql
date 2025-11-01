-- Criação da tabela powerpoint_realtime no Supabase
-- Execute este script no SQL Editor do Supabase

-- Tabela principal para dados do PowerPoint em tempo real
CREATE TABLE IF NOT EXISTS powerpoint_realtime (
  id TEXT PRIMARY KEY DEFAULT 'powerpoint_current',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para melhor performance em queries 
CREATE INDEX IF NOT EXISTS idx_powerpoint_realtime_updated_at 
ON powerpoint_realtime(updated_at DESC);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_powerpoint_realtime_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_powerpoint_realtime_updated_at ON powerpoint_realtime;
CREATE TRIGGER trigger_update_powerpoint_realtime_updated_at
  BEFORE UPDATE ON powerpoint_realtime
  FOR EACH ROW
  EXECUTE FUNCTION update_powerpoint_realtime_updated_at();

-- Habilitar Realtime na tabela (para subscriptions)
-- Só adiciona se ainda não estiver na publicação
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'powerpoint_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE powerpoint_realtime;
  END IF;
END $$;

-- Políticas RLS (Row Level Security)
-- Permite leitura pública (anon) e escrita apenas para service_role
ALTER TABLE powerpoint_realtime ENABLE ROW LEVEL SECURITY;

-- Política para leitura pública (qualquer um pode ler)
DROP POLICY IF EXISTS "Anyone can read powerpoint_realtime" ON powerpoint_realtime;
CREATE POLICY "Anyone can read powerpoint_realtime"
  ON powerpoint_realtime
  FOR SELECT
  USING (true);

-- Política para inserção/atualização (permite anon também para facilitar)
-- Isso permite que qualquer cliente (incluindo anon) possa fazer upsert
DROP POLICY IF EXISTS "Anyone can modify powerpoint_realtime" ON powerpoint_realtime;
CREATE POLICY "Anyone can modify powerpoint_realtime"
  ON powerpoint_realtime
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comentários na tabela e colunas
COMMENT ON TABLE powerpoint_realtime IS 'Armazena dados do PowerPoint em tempo real do app Windows';
COMMENT ON COLUMN powerpoint_realtime.id IS 'ID único do registro (sempre "powerpoint_current")';
COMMENT ON COLUMN powerpoint_realtime.data IS 'Dados JSON do PowerPoint (slides, vídeo, etc.)';
COMMENT ON COLUMN powerpoint_realtime.updated_at IS 'Timestamp da última atualização';

