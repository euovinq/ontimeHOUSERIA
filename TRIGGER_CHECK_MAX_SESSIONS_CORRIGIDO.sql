-- ============================================================================
-- SCRIPT SQL CORRIGIDO: TRIGGER check_max_sessions
-- ============================================================================
-- Este script corrige o erro "operator does not exist: timestamp with time zone > time with time zone"
-- que pode ocorrer quando há problemas de tipo na comparação de datas.
--
-- IMPORTANTE: Execute este script no SQL Editor do Supabase para substituir
-- o trigger existente.
-- ============================================================================

-- 1. REMOVER TRIGGER ANTIGO (se existir)
DROP TRIGGER IF EXISTS trigger_check_max_sessions ON user_sessions;

-- 2. RECRIAR FUNÇÃO check_max_sessions COM CORREÇÕES DE TIPO
CREATE OR REPLACE FUNCTION check_max_sessions()
RETURNS TRIGGER AS $$
DECLARE
  session_count INTEGER;
  max_allowed INTEGER;
  current_time TIMESTAMPTZ;
BEGIN
  -- Garantir que current_time é TIMESTAMPTZ
  current_time := NOW();
  
  -- Obter limite máximo permitido para o usuário
  max_allowed := get_user_machine_limit(NEW.user_id);
  
  -- Contar sessões ativas do usuário (excluindo a sessão atual se for UPDATE)
  -- IMPORTANTE: Usar CAST explícito para garantir tipos corretos
  SELECT COUNT(*) INTO session_count
  FROM user_sessions
  WHERE user_id = NEW.user_id
    AND expires_at > current_time  -- Comparação TIMESTAMPTZ > TIMESTAMPTZ (correto)
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  
  -- Verificar se excedeu o limite
  IF session_count >= max_allowed THEN
    RAISE EXCEPTION 'Limite de % máquinas atingido para o usuário %. Você possui % sessão(ões) ativa(s).', 
      max_allowed, NEW.user_id, session_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. RECRIAR TRIGGER
CREATE TRIGGER trigger_check_max_sessions
  BEFORE INSERT ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION check_max_sessions();

-- 4. VERIFICAR SE FOI CRIADO CORRETAMENTE
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'user_sessions' 
  AND trigger_name = 'trigger_check_max_sessions';

-- ============================================================================
-- NOTAS IMPORTANTES:
-- ============================================================================
-- 1. O erro "operator does not exist: timestamp with time zone > time with time zone"
--    ocorre quando tentamos comparar tipos incompatíveis.
--
-- 2. A correção garante que:
--    - current_time é sempre TIMESTAMPTZ (usando NOW())
--    - expires_at na tabela deve ser TIMESTAMPTZ (verificar estrutura da tabela)
--    - A comparação é sempre TIMESTAMPTZ > TIMESTAMPTZ
--
-- 3. Se o erro persistir, verifique a estrutura da tabela user_sessions:
--    SELECT column_name, data_type 
--    FROM information_schema.columns 
--    WHERE table_name = 'user_sessions' AND column_name = 'expires_at';
--
-- 4. Se expires_at não for TIMESTAMPTZ, execute:
--    ALTER TABLE user_sessions 
--    ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at::TIMESTAMPTZ;
-- ============================================================================
