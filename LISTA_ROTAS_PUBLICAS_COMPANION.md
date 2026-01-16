# 📋 Lista de Rotas Públicas para Companion

## Configuração Base
- **Host**: `127.0.0.1` ou `localhost`
- **Porta**: `4001`
- **Protocolo**: `http`
- **Base URL**: `http://127.0.0.1:4001`

---

## 🔵 Rotas de Controle do Timer (`/api/*`)

### Controles Básicos
1. `GET http://127.0.0.1:4001/api/start`
   - Iniciar timer

2. `GET http://127.0.0.1:4001/api/pause`
   - Pausar timer

3. `GET http://127.0.0.1:4001/api/stop`
   - Parar timer

4. `GET http://127.0.0.1:4001/api/poll`
   - Obter status atual do timer (retorna dados em tempo real)

5. `GET http://127.0.0.1:4001/api/load`
   - Carregar evento

6. `GET http://127.0.0.1:4001/api/roll`
   - Roll (avançar para próximo evento)

7. `GET http://127.0.0.1:4001/api/reload`
   - Recarregar

8. `GET http://127.0.0.1:4001/api/addtime`
   - Adicionar tempo ao timer atual

### Controles Avançados
9. `GET http://127.0.0.1:4001/api/start/next`
   - Iniciar próximo evento

10. `GET http://127.0.0.1:4001/api/start/previous`
    - Iniciar evento anterior

11. `GET http://127.0.0.1:4001/api/start/index/:id`
    - Iniciar evento específico por ID

12. `GET http://127.0.0.1:4001/api/message`
    - Controlar mensagens

13. `GET http://127.0.0.1:4001/api/change`
    - Modificar eventos

14. `GET http://127.0.0.1:4001/api/auxtimer`
    - Controlar timer auxiliar

15. `GET http://127.0.0.1:4001/api/client`
    - Controlar clientes

16. `GET http://127.0.0.1:4001/api/offsetmode`
    - Modo de offset

17. `GET http://127.0.0.1:4001/api/version`
    - Versão da API

### Health Check
18. `GET http://127.0.0.1:4001/api/`
    - Health check da API

---

## 🟢 Rotas Públicas do Companion (`/api/public/*`)

### Controles Básicos
19. `GET http://127.0.0.1:4001/api/public/start`
    - Iniciar timer

20. `GET http://127.0.0.1:4001/api/public/pause`
    - Pausar timer

21. `GET http://127.0.0.1:4001/api/public/stop`
    - Parar timer

22. `GET http://127.0.0.1:4001/api/public/poll`
    - Obter status atual do timer

23. `GET http://127.0.0.1:4001/api/public/load`
    - Carregar evento

24. `GET http://127.0.0.1:4001/api/public/roll`
    - Roll

25. `GET http://127.0.0.1:4001/api/public/reload`
    - Recarregar

26. `GET http://127.0.0.1:4001/api/public/addtime`
    - Adicionar tempo

### PowerPoint
27. `GET http://127.0.0.1:4001/api/public/powerpoint/toggle`
    - Toggle PowerPoint

28. `POST http://127.0.0.1:4001/api/public/powerpoint/toggle`
    - Toggle PowerPoint (POST)

29. `GET http://127.0.0.1:4001/api/public/powerpoint/toggle/status`
    - Status do toggle do PowerPoint

30. `GET http://127.0.0.1:4001/api/public/powerpoint/status/complete`
    - Status completo do PowerPoint

31. `GET http://127.0.0.1:4001/api/public/powerpoint/status/slide`
    - Status do slide atual

32. `GET http://127.0.0.1:4001/api/public/powerpoint/status/slide/query`
    - Status do slide com query params

33. `GET http://127.0.0.1:4001/api/public/powerpoint/status/video`
    - Status do vídeo

34. `GET http://127.0.0.1:4001/api/public/togglepowerpoint`
    - Toggle PowerPoint (alias)

35. `GET http://127.0.0.1:4001/api/public/getpowerpointstatus`
    - Obter status do PowerPoint (alias)

### PowerPoint OSC
36. `POST http://127.0.0.1:4001/api/public/powerpoint/osc/config`
    - Configurar OSC do PowerPoint

37. `POST http://127.0.0.1:4001/api/public/powerpoint/osc/start`
    - Iniciar OSC do PowerPoint

38. `POST http://127.0.0.1:4001/api/public/powerpoint/osc/stop`
    - Parar OSC do PowerPoint

39. `GET http://127.0.0.1:4001/api/public/powerpoint/osc/status`
    - Status do OSC do PowerPoint

### Supabase
40. `GET http://127.0.0.1:4001/api/public/supabase/toggle`
    - Toggle Supabase

41. `POST http://127.0.0.1:4001/api/public/supabase/toggle`
    - Toggle Supabase (POST)

42. `GET http://127.0.0.1:4001/api/public/supabase/toggle/status`
    - Status do toggle do Supabase

43. `GET http://127.0.0.1:4001/api/public/togglesupabase`
    - Toggle Supabase (alias)

44. `GET http://127.0.0.1:4001/api/public/getsupabasestatus`
    - Obter status do Supabase (alias)

### Health Check
45. `GET http://127.0.0.1:4001/api/public/`
    - Health check do router público

---

## 🟡 Rotas de Dados (`/data/*`)

### Dados em Tempo Real
46. `GET http://127.0.0.1:4001/data/realtime`
    - Dados em tempo real do timer

### Configurações e Projeto
47. `GET http://127.0.0.1:4001/data/automations`
    - Configurações de automação

48. `GET http://127.0.0.1:4001/data/custom-fields`
    - Campos customizados

49. `GET http://127.0.0.1:4001/data/db`
    - Download do projeto atual

50. `GET http://127.0.0.1:4001/data/project`
    - Dados do projeto

51. `GET http://127.0.0.1:4001/data/settings`
    - Configurações gerais

52. `GET http://127.0.0.1:4001/data/view-settings`
    - Configurações de visualização

53. `GET http://127.0.0.1:4001/data/url-presets`
    - Presets de URL

### Sessão e Relatórios
54. `GET http://127.0.0.1:4001/data/session`
    - Estatísticas de sessão

55. `GET http://127.0.0.1:4001/data/session/info`
    - Informações da sessão

56. `GET http://127.0.0.1:4001/data/report`
    - Relatórios

### Rundown (Eventos)
57. `GET http://127.0.0.1:4001/data/rundown`
    - Todos os eventos

58. `GET http://127.0.0.1:4001/data/rundown/normalised`
    - Rundown normalizado (formato usado pelo Companion)

59. `GET http://127.0.0.1:4001/data/rundowns`
    - Alias (plural) para compatibilidade

60. `GET http://127.0.0.1:4001/data/rundowns/current`
    - Rundown atual (alias para normalised)

---

## 🔴 Rotas de Autenticação (`/auth/*`)

61. `POST http://127.0.0.1:4001/auth/login`
    - Login (se necessário)

62. `GET http://127.0.0.1:4001/auth/license`
    - Informações de licença

---

## 📝 Como Usar no Companion

### Para cada rota:
1. **Tipo**: HTTP Request
2. **Método**: GET (ou POST quando especificado)
3. **URL**: Use a URL completa da rota
4. **Headers**: Não necessário (todas são públicas)
5. **Body**: Não necessário para GET

### Exemplo de Configuração:
- **Label**: "Start Timer"
- **Type**: HTTP Request
- **Method**: GET
- **URL**: `http://127.0.0.1:4001/api/start`
- **Headers**: (vazio)
- **Body**: (vazio)

---

## 🎯 Rotas Mais Importantes para Começar

Se quiser testar apenas as essenciais primeiro:

1. `GET http://127.0.0.1:4001/api/poll` - Status do timer
2. `GET http://127.0.0.1:4001/api/start` - Iniciar
3. `GET http://127.0.0.1:4001/api/pause` - Pausar
4. `GET http://127.0.0.1:4001/api/stop` - Parar
5. `GET http://127.0.0.1:4001/data/realtime` - Dados em tempo real
6. `GET http://127.0.0.1:4001/data/rundown/normalised` - Rundown

---

## ⚠️ Notas Importantes

- Todas as rotas acima são **públicas** (não requerem autenticação)
- Use `GET` para todas, exceto quando especificado `POST`
- O servidor deve estar rodando na porta `4001`
- Se usar `localhost`, certifique-se de que o Companion consegue resolver o DNS
- Recomendado usar `127.0.0.1` em vez de `localhost`
