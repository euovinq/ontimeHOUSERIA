# Rotas Não Públicas na Porta 4001

## Resumo

Este documento lista todas as rotas que **NÃO são públicas** na porta 4001, ou seja, rotas que requerem autenticação.

## Rotas Públicas (para referência)

As seguintes rotas são **públicas** (não requerem autenticação):
- `/login` - Router de login (HTML)
- `/auth/*` - Router de autenticação Supabase
- `/api/public/*` - Router público para Stream Deck/Companion
- `/api/start`, `/api/pause`, `/api/stop`, `/api/poll`, `/api/load`, `/api/roll`, `/api/reload`, `/api/addtime` - Controles básicos do timer
- `/external/*` - Arquivos estáticos externos
- `/user/*` - Arquivos estáticos do usuário
- Assets públicos específicos: `/favicon.ico`, `/manifest.json`, `/ontime-logo.png`, `/robots.txt`, `/site.webmanifest`

## Rotas Não Públicas (requerem autenticação)

### 1. Rotas de Dados da Aplicação (`/data/*`)

Todas as rotas sob `/data` requerem autenticação via middleware `authenticate`:

#### `/data/automations/*`
- `GET /data/automations` - Obter configurações de automação
- `POST /data/automations` - Salvar configurações de automação
- `POST /data/automations/trigger` - Criar trigger
- `PUT /data/automations/trigger/:id` - Atualizar trigger
- `DELETE /data/automations/trigger/:id` - Deletar trigger
- `POST /data/automations/automation` - Criar automação
- `PUT /data/automations/automation/:id` - Editar automação
- `DELETE /data/automations/automation/:id` - Deletar automação
- `POST /data/automations/test` - Testar saída

#### `/data/custom-fields/*`
- `GET /data/custom-fields` - Obter campos customizados
- `POST /data/custom-fields` - Criar campo customizado
- `PUT /data/custom-fields/:label` - Editar campo customizado
- `DELETE /data/custom-fields/:label` - Deletar campo customizado

#### `/data/db/*`
- `GET /data/db` - Download do projeto atual
- `POST /data/db/download` - Download de projeto específico
- `POST /data/db/upload` - Upload de arquivo de projeto
- `PATCH /data/db` - Atualizar parcialmente projeto
- `POST /data/db/new` - Criar novo projeto
- `POST /data/db/quick` - Criar projeto rápido
- `GET /data/db/all` - Listar todos os projetos
- `POST /data/db/load` - Carregar projeto
- `POST /data/db/demo` - Carregar projeto demo
- `POST /data/db/:filename/duplicate` - Duplicar projeto
- `PUT /data/db/:filename/rename` - Renomear projeto
- `DELETE /data/db/:filename` - Deletar projeto

#### `/data/project/*`
- `GET /data/project` - Obter dados do projeto
- `POST /data/project` - Salvar dados do projeto
- `POST /data/project/upload` - Upload de logo do projeto

#### `/data/rundown/*`
- `GET /data/rundown` - Obter todos os eventos (não usado no frontend)
- `GET /data/rundown/paginated` - Obter eventos paginados (não usado no frontend)
- `GET /data/rundown/normalised` - Obter rundown normalizado
- `GET /data/rundown/:eventId` - Obter evento por ID (não usado no frontend)
- `POST /data/rundown` - Criar evento
- `PUT /data/rundown` - Atualizar eventos
- `PUT /data/rundown/batch` - Atualizar eventos em lote
- `PATCH /data/rundown/reorder` - Reordenar eventos
- `PATCH /data/rundown/swap` - Trocar eventos
- `PATCH /data/rundown/applydelay/:eventId` - Aplicar delay
- `DELETE /data/rundown` - Deletar eventos
- `DELETE /data/rundown/all` - Deletar todos os eventos

#### `/data/settings/*`
- `GET /data/settings` - Obter configurações
- `POST /data/settings` - Salvar configurações
- `POST /data/settings/welcomedialog` - Configurar diálogo de boas-vindas

#### `/data/sheets/*`
- `GET /data/sheets/connect` - Verificar autenticação Google Sheets
- `POST /data/sheets/:sheetId/connect` - Conectar a planilha
- `POST /data/sheets/revoke` - Revogar autenticação
- `POST /data/sheets/:sheetId/worksheets` - Obter nomes de worksheets
- `POST /data/sheets/:sheetId/read` - Ler da planilha
- `POST /data/sheets/:sheetId/write` - Escrever na planilha

#### `/data/excel/*`
- `POST /data/excel/upload` - Upload de arquivo Excel
- `GET /data/excel/worksheets` - Obter worksheets
- `POST /data/excel/preview` - Preview de importação

#### `/data/url-presets/*`
- `GET /data/url-presets` - Obter presets de URL
- `POST /data/url-presets` - Salvar presets de URL

#### `/data/session/*`
- `GET /data/session` - Obter estatísticas de sessão
- `GET /data/session/info` - Obter informações da sessão
- `POST /data/session/url` - Gerar URL autenticada

#### `/data/view-settings/*`
- `GET /data/view-settings` - Obter configurações de visualização
- `POST /data/view-settings` - Salvar configurações de visualização

#### `/data/report/*`
- `GET /data/report` - Obter todos os relatórios
- `DELETE /data/report/all` - Deletar todos os relatórios
- `DELETE /data/report/:eventId` - Deletar relatório por evento

#### `/data/assets/*`
- `GET /data/assets/css` - Obter CSS override
- `POST /data/assets/css` - Salvar CSS override
- `POST /data/assets/css/restore` - Restaurar CSS

#### `/data/realtime/*`
- `GET /data/realtime` - Obter dados em tempo real

#### `/data/supabase/*`
- `POST /data/supabase/configure` - Configurar Supabase
- `GET /data/supabase/test` - Testar conexão Supabase
- `GET /data/supabase/status` - Obter status do Supabase
- `GET /data/supabase/projects` - Obter projetos ativos (requer auth Supabase)
- `GET /data/supabase/project/:projectCode` - Obter dados do projeto (requer auth Supabase)
- `POST /data/supabase/cleanup` - Limpar projetos antigos
- `POST /data/supabase/toggle` - Alternar Supabase
- `GET /data/supabase/toggle/status` - Obter status do toggle

#### `/data/powerpoint/*`
- `GET /data/powerpoint/status` - Obter status do PowerPoint
- `GET /data/powerpoint/windows/status` - Obter status do Windows
- `POST /data/powerpoint/windows/config` - Configurar Windows
- `POST /data/powerpoint/windows/start` - Iniciar Windows
- `POST /data/powerpoint/windows/stop` - Parar Windows
- `POST /data/powerpoint/toggle` - Alternar PowerPoint
- `GET /data/powerpoint/toggle/status` - Obter status do toggle
- `GET /data/powerpoint/status/complete` - Obter status completo
- `GET /data/powerpoint/status/slide` - Obter status do slide
- `GET /data/powerpoint/status/slide/query` - Obter status do slide com query params
- `GET /data/powerpoint/status/video` - Obter status do vídeo
- `POST /data/powerpoint/osc/config` - Configurar OSC
- `POST /data/powerpoint/osc/start` - Iniciar OSC
- `POST /data/powerpoint/osc/stop` - Parar OSC
- `GET /data/powerpoint/osc/status` - Obter status do OSC
- `POST /data/powerpoint/discovery/broadcast/start` - Iniciar broadcast de descoberta
- `POST /data/powerpoint/discovery/broadcast/stop` - Parar broadcast de descoberta
- `GET /data/powerpoint/discovery/servers` - Descobrir servidores
- `GET /data/powerpoint/discovery/status` - Obter status da descoberta

### 2. Rotas de Integração (`/api/*`)

#### Rotas Públicas de Controle do Timer (`/api/*` - ações específicas)
As seguintes rotas de controle básico do timer são **públicas** (não requerem autenticação):
- `GET /api/start` - Iniciar timer
- `GET /api/pause` - Pausar timer
- `GET /api/stop` - Parar timer
- `GET /api/poll` - Poll de status
- `GET /api/load` - Carregar evento
- `GET /api/roll` - Roll
- `GET /api/reload` - Recarregar
- `GET /api/addtime` - Adicionar tempo

#### Rotas Protegidas de Integração (`/api/*` - outras ações)
Todas as outras rotas sob `/api` (exceto `/api/public` e as ações de controle acima) requerem autenticação via middleware `authenticate`:

O `integrationRouter` aceita qualquer outra ação via GET:
- `GET /api/change` - Alterar evento
- `GET /api/message` - Controlar mensagens
- E qualquer outra ação suportada pelo dispatcher (exceto as listadas acima como públicas)

### 3. Rotas de Visualização (requerem `authenticateAndRedirect`)

Todas as rotas de visualização requerem autenticação e redirecionam para `/login` se não autenticadas:

- `/` - Redireciona para `/timer`
- `/timer` - Visualização do timer (Presenter/Stage)
- `/minimal` - Timer minimalista
- `/clock` - Relógio simples
- `/backstage` - Visualização de bastidores
- `/countdown` - Contagem regressiva
- `/studio` - Relógio de estúdio
- `/timeline` - Timeline
- `/public` - Visualização pública/Foyer
- `/lower` - Lower Thirds
- `/info` - Informações do projeto
- `/editor` - Interface de controle (protegida)
- `/cuesheet` - Cuesheets em tempo real (protegida)
- `/op` ou `/operator` - Visualizações automatizadas para operadores (protegida)
- `/rundown` - Rundown (protegida)
- `/timercontrol` - Controle de timer (protegida)
- `/messagecontrol` - Controle de mensagens (protegida)
- `/testing` - Página de testes (protegida)
- Qualquer outra rota não listada acima

## Notas Importantes

1. **Middleware de Autenticação**: 
   - `authenticate` - Usado para rotas `/data` e `/api`
   - `authenticateAndRedirect` - Usado para rotas de visualização (redireciona para `/login`)

2. **Autenticação Supabase**: 
   - Algumas rotas em `/data/supabase` usam `ensureSupabaseAuth` em vez do middleware padrão

3. **Assets Públicos**: 
   - Arquivos estáticos específicos são permitidos sem autenticação (favicon, manifest, etc.)

4. **Rotas de Login**: 
   - `/login` e `/auth/*` são públicas para permitir autenticação

5. **Rotas Públicas para Integração**: 
   - `/api/public/*` é público para permitir integração com Stream Deck/Companion sem autenticação
