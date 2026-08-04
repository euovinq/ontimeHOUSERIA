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
const { dialog, app } = require('electron');

// Depois do boot, sem disputar com a abertura da janela e o servidor interno.
const ATRASO_INICIAL_MS = 8000;

let janela = null;
let emAndamento = false;
let jaBaixado = false;

/** Só instala quando o usuário mandar — nunca no meio de um evento ao vivo. */
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function log(...args) {
  if (!app.isPackaged) console.log('[updater]', ...args);
}

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
    autoUpdater.autoInstallOnAppQuit = true;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  } else {
    // Instala sozinho no próximo encerramento, sem perguntar de novo.
    autoUpdater.autoInstallOnAppQuit = true;
  }
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

/** Liga os eventos e agenda a checagem de entrada. Chamar uma vez, após criar a janela. */
function iniciarUpdater(janelaPrincipal) {
  janela = janelaPrincipal;

  let ultimaFoiManual = false;
  const marcar = (manual) => {
    ultimaFoiManual = manual;
  };

  autoUpdater.on('update-available', (info) => {
    log('disponível', info.version);
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
    if (janela && !janela.isDestroyed()) janela.setProgressBar(-1);
    ofereceInstalar(info);
  });

  autoUpdater.on('error', (erro) => {
    emAndamento = false;
    if (janela && !janela.isDestroyed()) janela.setProgressBar(-1);
    log('erro', erro);
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
