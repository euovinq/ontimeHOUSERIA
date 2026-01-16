# Rotas que Ainda Precisam de Autenticação

## Resumo

As seguintes rotas ainda estão protegidas e requerem autenticação:

## 1. Rotas `/api/*` - Métodos POST/PUT/DELETE/PATCH

⚠️ **IMPORTANTE**: O `publicTimerControlRouter` só captura requisições **GET**. 

**Rotas protegidas:**
- `POST /api/*` - Qualquer ação via POST
- `PUT /api/*` - Qualquer ação via PUT  
- `DELETE /api/*` - Qualquer ação via DELETE
- `PATCH /api/*` - Qualquer ação via PATCH

**Rotas públicas (GET apenas):**
- ✅ `GET /api/*` - Todas as ações via GET estão públicas

## 2. Rotas `/data/*` - Métodos POST/PUT/DELETE/PATCH

Todas as rotas de escrita/modificação em `/data/*` ainda precisam de autenticação:

### Automações (`/data/automations`)
- ✅ `GET /data/automations` - Público
- ❌ `POST /data/automations` - Protegido
- ❌ `POST /data/automations/trigger` - Protegido
- ❌ `PUT /data/automations/trigger/:id` - Protegido
- ❌ `DELETE /data/automations/trigger/:id` - Protegido
- ❌ `POST /data/automations/automation` - Protegido
- ❌ `PUT /data/automations/automation/:id` - Protegido
- ❌ `DELETE /data/automations/automation/:id` - Protegido
- ❌ `POST /data/automations/test` - Protegido

### Campos Customizados (`/data/custom-fields`)
- ✅ `GET /data/custom-fields` - Público
- ❌ `POST /data/custom-fields` - Protegido
- ❌ `PUT /data/custom-fields/:label` - Protegido
- ❌ `DELETE /data/custom-fields/:label` - Protegido

### Banco de Dados/Projetos (`/data/db`)
- ✅ `GET /data/db` - Público (download)
- ❌ `POST /data/db/download` - Protegido
- ❌ `POST /data/db/upload` - Protegido
- ❌ `PATCH /data/db` - Protegido
- ❌ `POST /data/db/new` - Protegido
- ❌ `POST /data/db/quick` - Protegido
- ❌ `POST /data/db/load` - Protegido
- ❌ `POST /data/db/demo` - Protegido
- ❌ `POST /data/db/:filename/duplicate` - Protegido
- ❌ `PUT /data/db/:filename/rename` - Protegido
- ❌ `DELETE /data/db/:filename` - Protegido
- ❌ `GET /data/db/all` - Protegido (lista de projetos)

### Projeto (`/data/project`)
- ✅ `GET /data/project` - Público
- ❌ `POST /data/project` - Protegido
- ❌ `POST /data/project/upload` - Protegido (upload de logo)

### Rundown (`/data/rundown`)
- ✅ `GET /data/rundown` - Público
- ✅ `GET /data/rundown/normalised` - Público
- ✅ `GET /data/rundown/:eventId` - Público
- ❌ `POST /data/rundown` - Protegido (criar evento)
- ❌ `PUT /data/rundown` - Protegido (atualizar evento)
- ❌ `PUT /data/rundown/batch` - Protegido (atualização em lote)
- ❌ `PATCH /data/rundown/reorder` - Protegido (reordenar)
- ❌ `PATCH /data/rundown/swap` - Protegido (trocar ordem)
- ❌ `PATCH /data/rundown/applydelay/:eventId` - Protegido
- ❌ `DELETE /data/rundown` - Protegido (deletar eventos)
- ❌ `DELETE /data/rundown/all` - Protegido (deletar tudo)

### Configurações (`/data/settings`)
- ✅ `GET /data/settings` - Público
- ❌ `POST /data/settings` - Protegido
- ❌ `POST /data/settings/welcomedialog` - Protegido

### Planilhas Google (`/data/sheets`)
- ❌ `GET /data/sheets/connect` - Protegido
- ❌ `POST /data/sheets/:sheetId/connect` - Protegido
- ❌ `POST /data/sheets/revoke` - Protegido
- ❌ `POST /data/sheets/:sheetId/worksheets` - Protegido
- ❌ `POST /data/sheets/:sheetId/read` - Protegido
- ❌ `POST /data/sheets/:sheetId/write` - Protegido

### Excel (`/data/excel`)
- ❌ `POST /data/excel/upload` - Protegido
- ❌ `GET /data/excel/worksheets` - Protegido
- ❌ `POST /data/excel/preview` - Protegido

### Sessão (`/data/session`)
- ✅ `GET /data/session` - Público
- ✅ `GET /data/session/info` - Público
- ❌ `POST /data/session/url` - Protegido (gerar URL autenticada)

### URL Presets (`/data/url-presets`)
- ✅ `GET /data/url-presets` - Público
- ❌ `POST /data/url-presets` - Protegido

### View Settings (`/data/view-settings`)
- ✅ `GET /data/view-settings` - Público
- ❌ `POST /data/view-settings` - Protegido

### Relatórios (`/data/report`)
- ✅ `GET /data/report` - Público
- ❌ `DELETE /data/report/all` - Protegido
- ❌ `DELETE /data/report/:eventId` - Protegido

### Assets (`/data/assets`)
- ❌ `GET /data/assets/css` - Protegido
- ❌ `POST /data/assets/css` - Protegido
- ❌ `POST /data/assets/css/restore` - Protegido

### Supabase (`/data/supabase`)
- ❌ `POST /data/supabase/configure` - Protegido
- ❌ `GET /data/supabase/test` - Protegido
- ❌ `GET /data/supabase/status` - Protegido
- ❌ `GET /data/supabase/projects` - Protegido (requer `ensureSupabaseAuth`)
- ❌ `GET /data/supabase/project/:projectCode` - Protegido (requer `ensureSupabaseAuth`)
- ❌ `POST /data/supabase/cleanup` - Protegido
- ❌ `POST /data/supabase/toggle` - Protegido
- ❌ `GET /data/supabase/toggle/status` - Protegido

### PowerPoint (`/data/powerpoint`)
- ❌ `GET /data/powerpoint/status` - Protegido
- ❌ `GET /data/powerpoint/windows/status` - Protegido
- ❌ `POST /data/powerpoint/windows/config` - Protegido
- ❌ `POST /data/powerpoint/windows/start` - Protegido
- ❌ `POST /data/powerpoint/windows/stop` - Protegido
- ❌ `POST /data/powerpoint/toggle` - Protegido
- ❌ `GET /data/powerpoint/toggle/status` - Protegido
- ❌ `GET /data/powerpoint/status/complete` - Protegido
- ❌ `GET /data/powerpoint/status/slide` - Protegido
- ❌ `GET /data/powerpoint/status/slide/query` - Protegido
- ❌ `GET /data/powerpoint/status/video` - Protegido
- ❌ `POST /data/powerpoint/osc/config` - Protegido
- ❌ `POST /data/powerpoint/osc/start` - Protegido
- ❌ `POST /data/powerpoint/osc/stop` - Protegido
- ❌ `GET /data/powerpoint/osc/status` - Protegido
- ❌ `POST /data/powerpoint/discovery/broadcast/start` - Protegido
- ❌ `POST /data/powerpoint/discovery/broadcast/stop` - Protegido
- ❌ `GET /data/powerpoint/discovery/servers` - Protegido
- ❌ `GET /data/powerpoint/discovery/status` - Protegido

**Nota**: Algumas rotas do PowerPoint estão públicas em `/api/public/powerpoint/*`, mas as rotas em `/data/powerpoint/*` estão protegidas.

## 3. Rotas Estáticas (HTML, CSS, JS)

Todas as rotas que servem arquivos estáticos (interface web) estão protegidas:
- ❌ `GET /` - Protegido (redireciona para `/login` se não autenticado)
- ❌ `GET /*` - Protegido (qualquer rota estática)

## 4. Rotas de Autenticação (`/auth/*`)

- ✅ `POST /auth/login` - Público (precisa ser público para fazer login)
- ✅ `GET /auth/license` - Público

## 5. Rotas de Login (`/login/*`)

- ✅ `GET /login` - Público (página de login)

## Resumo por Categoria

### ✅ Totalmente Públicas (sem autenticação)
- `GET /api/*` - Todas as ações via GET
- `GET /api/public/*` - Todas as rotas do router público
- `GET /data/realtime` - Dados em tempo real
- `GET /data/automations` - Configurações de automação
- `GET /data/custom-fields` - Campos customizados
- `GET /data/db` - Download do projeto atual
- `GET /data/project` - Dados do projeto
- `GET /data/settings` - Configurações
- `GET /data/session` - Estatísticas de sessão
- `GET /data/session/info` - Informações da sessão
- `GET /data/url-presets` - Presets de URL
- `GET /data/view-settings` - Configurações de visualização
- `GET /data/report` - Relatórios
- `GET /data/rundown` - Todos os eventos
- `GET /data/rundown/normalised` - Rundown normalizado
- `GET /data/rundowns` - Alias (plural)
- `GET /data/rundowns/current` - Rundown atual (alias)
- `POST /auth/login` - Login
- `GET /auth/license` - Informações de licença
- `GET /login` - Página de login

### ❌ Protegidas (requerem autenticação)
- **TODAS** as rotas POST/PUT/DELETE/PATCH em `/api/*`
- **TODAS** as rotas POST/PUT/DELETE/PATCH em `/data/*` (exceto as GET listadas acima)
- **TODAS** as rotas estáticas (HTML, CSS, JS) em `/` e `/*`

## Para o Companion

O módulo oficial do Ontime Companion usa apenas:
- ✅ `GET /api/*` - Ações de controle (start, pause, stop, etc.)
- ✅ `GET /data/*` - Leitura de dados (realtime, project, rundown, etc.)

**Conclusão**: Todas as rotas necessárias para o Companion já estão públicas! 🎉
