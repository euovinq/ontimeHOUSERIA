/**
 * Atualização automática.
 *
 * O manifesto e o pacote ficam num bucket R2 público (provider `generic` do
 * electron-updater): ele lê `latest-mac.yml`, compara a versão, baixa o .zip e
 * troca o app na próxima abertura. Não há servidor no meio.
 *
 * Dois gatilhos, o MESMO fluxo:
 *   • na entrada do app, alguns segundos depois de abrir;
 *   • no menu "Buscar atualização...".
 *
 * A diferença é só o silêncio: a checagem automática não incomoda quando não
 * há nada novo nem quando a internet está fora; a manual sempre responde,
 * porque quem clicou está esperando resposta.
 *
 * IMPORTANTE (macOS): o Squirrel só aceita pacote ASSINADO E NOTARIZADO. Sem
 * isso a troca falha na hora de instalar, depois de já ter baixado tudo.
 */

const { autoUpdater } = require('electron-updater');
const { dialog, app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Depois do boot, sem disputar com a abertura da janela e o servidor interno.
const ATRASO_INICIAL_MS = 8000;

let janela = null;
let emAndamento = false;
let jaBaixado = false;
let ultimoErro = null;
/** Avisa o main.js que a troca vai começar (desarma o "esconder ao fechar"). */
let aoTrocarVersao = null;

/**
 * Nada é baixado sem o usuário mandar — o app roda em cima de show ao vivo.
 */
autoUpdater.autoDownload = false;

/**
 * PRECISA ser `true`, e ANTES do download. Não é preferência: é o que faz a
 * atualização existir no macOS.
 *
 * O `MacUpdater` do electron-updater baixa o zip por conta própria e sobe um
 * proxy local, mas só manda o Squirrel BUSCAR e PREPARAR a troca dentro de
 * `if (this.autoInstallOnAppQuit)`. Com `false`, ele resolve e para — o
 * Squirrel nunca recebe nada, e `squirrelDownloadedUpdate` fica `false`.
 *
 * Aí `quitAndInstall()` cai no ramo `else`, que só dispara o gatilho de
 * recuperação `if (!this.autoInstallOnAppQuit)`. Ou seja: ligar a flag na hora
 * de instalar (o que este arquivo fazia) fecha as DUAS portas — registra um
 * listener para um evento que ninguém vai emitir. Sem erro, sem log, para
 * sempre. Foi o defeito que fez o botão "Reiniciar agora" não fazer nada nas
 * versões 1.0.5 a 1.0.8.
 *
 * `true` aqui NÃO reinicia nada sozinho: sem `downloadUpdate()` não há o que
 * instalar, e o download continua dependendo do "Baixar agora".
 */
autoUpdater.autoInstallOnAppQuit = true;

// ── Log em arquivo ────────────────────────────────────────────────────
// O `log()` daqui só escrevia quando NÃO estava empacotado, e o handler de
// `error` só chamava esse log. Ou seja: em produção, o updater falhava em
// silêncio absoluto — foi por isso que o impasse acima sobreviveu a quatro
// versões. Agora tudo (inclusive o que o electron-updater escreve) vai para
// um arquivo no diretório de logs do app.
const arquivoLog = path.join(app.getPath('logs'), 'updater.log');

function log(...args) {
  const linha = `[${new Date().toISOString()}] ${args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ')}\n`;
  if (!app.isPackaged) console.log('[updater]', ...args);
  try {
    fs.mkdirSync(path.dirname(arquivoLog), { recursive: true });
    fs.appendFileSync(arquivoLog, linha);
  } catch {
    // Log é diagnóstico: não pode derrubar o app se o disco recusar.
  }
}

/** O electron-updater escreve o passo a passo aqui — é o que faltava ver. */
autoUpdater.logger = {
  info: (m) => log('info:', m),
  warn: (m) => log('warn:', m),
  error: (m) => log('error:', m),
  debug: (m) => log('debug:', m),
};

/**
 * Pergunta antes de baixar.
 * Nunca baixa sozinho: o app roda em cima de show ao vivo, e consumir banda
 * ou reiniciar sem avisar é o tipo de surpresa que não se pode dar.
 */
async function perguntarEBaixar(info, manual) {
  const { response } = await dialog.showMessageBox(janela, {
    type: 'info',
    buttons: ['Baixar agora', 'Depois'],
    defaultId: 0,
    cancelId: 1,
    title: 'Atualização disponível',
    message: `Versão ${info.version} disponível`,
    detail:
      `Você está na ${app.getVersion()}.\n\n` +
      (info.releaseNotes ? `${String(info.releaseNotes).slice(0, 500)}\n\n` : '') +
      'O download acontece em segundo plano. A troca só ocorre quando você fechar o app — nada é interrompido agora.',
  });

  if (response !== 0) {
    log('usuário adiou');
    emAndamento = false;
    return;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (erro) {
    emAndamento = false;
    log('falha no download', erro);
    if (manual) {
      dialog.showMessageBox(janela, {
        type: 'error',
        title: 'Falha ao baixar',
        message: 'Não foi possível baixar a atualização.',
        detail: String(erro && erro.message ? erro.message : erro),
      });
    }
  }
}

/** Baixou: oferece reiniciar, mas deixa continuar trabalhando. */
async function ofereceInstalar(info) {
  jaBaixado = true;
  emAndamento = false;

  const { response } = await dialog.showMessageBox(janela, {
    type: 'info',
    buttons: ['Reiniciar agora', 'Ao fechar o app'],
    defaultId: 1, // o seguro é NÃO reiniciar: pode ter evento no ar
    cancelId: 1,
    title: 'Atualização pronta',
    message: `Versão ${info.version} baixada`,
    detail: 'Se houver evento no ar, escolha "Ao fechar o app".',
  });

  if (response === 0) {
    instalarAgora();
  }
  // "Ao fechar o app": não há nada a fazer. `autoInstallOnAppQuit` já é `true`
  // desde a carga do módulo e o Squirrel já preparou a troca — ela acontece
  // sozinha no encerramento. NÃO mexer na flag aqui (ver o comentário no topo).
}

/**
 * Dispara a troca. Nunca alterar `autoInstallOnAppQuit` antes desta chamada —
 * é exatamente o que travava tudo. Ver o comentário no topo do arquivo.
 *
 * Avisa o main ANTES (`aoTrocarVersao`) porque o `quitAndInstall` do macOS
 * fecha as janelas primeiro e só emite `before-quit` depois: sem o aviso, o
 * handler de `close` esconde a janela em vez de fechá-la e a troca trava.
 */
function instalarAgora() {
  log('instalando: quitAndInstall');
  if (typeof aoTrocarVersao === 'function') {
    try {
      aoTrocarVersao();
    } catch (erro) {
      log('aoTrocarVersao falhou', erro);
    }
  }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (erro) {
      log('quitAndInstall falhou', erro);
      dialog.showMessageBox(janela, {
        type: 'error',
        title: 'Falha ao instalar',
        message: 'Não foi possível aplicar a atualização.',
        detail: `${String(erro && erro.message ? erro.message : erro)}\n\nDetalhes em:\n${arquivoLog}`,
      });
    }
  });
}

/**
 * Dispara a checagem.
 * @param {boolean} manual — veio do menu (responde sempre) ou do boot (silencioso).
 */
async function verificarAtualizacoes(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(janela, {
        type: 'info',
        title: 'Buscar atualização',
        message: 'Atualização não funciona em desenvolvimento.',
        detail: 'Este fluxo só vale no app empacotado e assinado.',
      });
    }
    return;
  }

  if (jaBaixado) {
    if (manual) ofereceInstalar({ version: 'baixada' });
    return;
  }
  if (emAndamento) return;

  emAndamento = true;
  try {
    const resultado = await autoUpdater.checkForUpdates();
    // Sem novidade: o evento `update-not-available` responde ao manual.
    if (!resultado) emAndamento = false;
  } catch (erro) {
    emAndamento = false;
    log('falha ao verificar', erro);
    // Sem internet no boot é situação normal — não vira alerta.
    if (manual) {
      dialog.showMessageBox(janela, {
        type: 'warning',
        title: 'Não foi possível verificar',
        message: 'Não deu para checar atualizações agora.',
        detail: 'Verifique a conexão com a internet e tente de novo.',
      });
    }
  }
}

/**
 * Liga os eventos e agenda a checagem de entrada. Chamar uma vez, após criar a janela.
 *
 * @param janelaPrincipal janela usada como pai dos diálogos
 * @param aoTrocar chamado imediatamente antes do `quitAndInstall` — o main usa
 *   para levantar `isQuitting` e deixar a janela fechar de verdade
 */
function iniciarUpdater(janelaPrincipal, aoTrocar) {
  janela = janelaPrincipal;
  aoTrocarVersao = typeof aoTrocar === 'function' ? aoTrocar : null;

  let ultimaFoiManual = false;
  const marcar = (manual) => {
    ultimaFoiManual = manual;
  };

  autoUpdater.on('update-available', (info) => {
    log('disponível', info.version);
    // Abre o modal da interface com as notas; o diálogo nativo pergunta.
    if (janela && !janela.isDestroyed()) {
      janela.webContents.send('update-check-result', {
        hasUpdate: true,
        version: info.version,
        release_notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
        download_url: null,
      });
    }
    perguntarEBaixar(info, ultimaFoiManual);
  });

  autoUpdater.on('update-not-available', () => {
    log('já está atualizado');
    emAndamento = false;
    if (ultimaFoiManual) {
      dialog.showMessageBox(janela, {
        type: 'info',
        title: 'Buscar atualização',
        message: 'Você já está na versão mais recente.',
        detail: `Versão ${app.getVersion()}.`,
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    log(`baixando ${Math.round(p.percent)}%`);
    if (janela && !janela.isDestroyed()) {
      // Barra no ícone do dock/taskbar — feedback sem roubar o foco de quem
      // está operando um show.
      janela.setProgressBar(p.percent / 100);
      janela.webContents.send('update-download-progress', {
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (janela && !janela.isDestroyed()) {
      janela.setProgressBar(-1);
      janela.webContents.send('update-downloaded', { version: info.version });
    }
    ofereceInstalar(info);
  });

  autoUpdater.on('error', (erro) => {
    emAndamento = false;
    ultimoErro = String(erro && erro.message ? erro.message : erro);
    if (janela && !janela.isDestroyed()) {
      janela.setProgressBar(-1);
      janela.webContents.send('update-check-result', { hasUpdate: false, error: ultimoErro });
    }
    log('erro', erro);
    // Erros do Squirrel nativo chegam por aqui (o MacUpdater os repassa). Se o
    // usuário pediu a ação, ele precisa saber que falhou — engolir o erro foi
    // metade do motivo deste fluxo ter ficado quebrado sem ninguém notar.
    if (ultimaFoiManual || jaBaixado) {
      dialog.showMessageBox(janela, {
        type: 'error',
        title: 'Falha na atualização',
        message: 'A atualização não pôde ser concluída.',
        detail: `${ultimoErro}\n\nDetalhes em:\n${arquivoLog}`,
      });
    }
  });

  // O modal tem o próprio botão de reiniciar — o diálogo nativo cobre quem
  // está com a janela minimizada, este cobre quem está olhando a tela.
  ipcMain.removeAllListeners('update-install-now');
  ipcMain.on('update-install-now', () => {
    if (!jaBaixado) {
      // Antes isto era um `return` mudo — clique sem resposta é indistinguível
      // de app travado, que foi como o defeito do impasse se apresentou.
      log('update-install-now ignorado: nada baixado ainda');
      dialog.showMessageBox(janela, {
        type: 'info',
        title: 'Atualização',
        message: 'Ainda não há atualização baixada.',
        detail: ultimoErro ? `Última falha: ${ultimoErro}` : 'Use "Buscar atualização…" primeiro.',
      });
      return;
    }
    instalarAgora();
  });

  // Entrada no app: checa uma vez, em silêncio.
  setTimeout(() => {
    marcar(false);
    verificarAtualizacoes(false);
  }, ATRASO_INICIAL_MS);

  return {
    /** Chamado pelo item de menu "Buscar atualização...". */
    verificarManual: () => {
      marcar(true);
      return verificarAtualizacoes(true);
    },
  };
}

module.exports = { iniciarUpdater, verificarAtualizacoes };
