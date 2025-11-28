-- Migração para suportar múltiplos projetos na tabela powerpoint_realtime
-- Execute este script no SQL Editor do Supabase APÓS executar 001_create_powerpoint_realtime.sql
-- 
-- IMPORTANTE: Esta migração remove o DEFAULT do id e altera o comportamento
-- para que cada projeto use seu próprio project_code como id

-- Remove o DEFAULT do id (não queremos mais 'powerpoint_current' como padrão)
ALTER TABLE IF EXISTS powerpoint_realtime 
  ALTER COLUMN id DROP DEFAULT;

-- Remove registro antigo se existir (opcional - apenas se quiser limpar dados antigos)
-- DELETE FROM powerpoint_realtime WHERE id = 'powerpoint_current';

-- Adiciona índice em id para melhor performance (já é PRIMARY KEY, mas garantimos)
-- O índice já existe como PRIMARY KEY, mas adicionamos comentário explicativo

-- Atualiza comentários para refletir nova estrutura
COMMENT ON TABLE powerpoint_realtime IS 'Armazena dados do PowerPoint em tempo real do app Windows. Cada projeto tem sua própria linha identificada por project_code.';
COMMENT ON COLUMN powerpoint_realtime.id IS 'ID único do registro (é o project_code do projeto, ex: "ABC12")';
COMMENT ON COLUMN powerpoint_realtime.data IS 'Dados JSON do PowerPoint (slides, vídeo, etc.)';
COMMENT ON COLUMN powerpoint_realtime.updated_at IS 'Timestamp da última atualização';

-- Nota: Não precisamos alterar políticas RLS ou triggers, pois já estão configurados
-- Apenas o comportamento do id muda (de fixo para dinâmico por projeto)













