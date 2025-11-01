const { getPowerPointStatus } = require('./index.js');

function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function clearLine() {
    process.stdout.write('\r\x1b[K');
}

console.log('=== TESTE EM LOOP - Detecção de Vídeo PowerPoint ===\n');
console.log('Pressione Ctrl+C para parar\n');

let lastCurrentTime = 0;
let stableCount = 0;
let iteration = 0;
const UPDATE_INTERVAL = 500; // 500ms

const loop = setInterval(() => {
    iteration++;
    try {
        const result = getPowerPointStatus();
        
        clearLine();
        
        if (!result.isAvailable) {
            process.stdout.write(`❌ PowerPoint não está disponível - ${result.error || 'Não encontrado'}`);
            return;
        }
        
        const v = result.video;
        const hasVideo = v && v.hasVideo;
        
        if (!hasVideo) {
            process.stdout.write(`ℹ️  Slide ${result.currentSlide}/${result.slideCount} | Modo: ${result.isInSlideShow ? 'Apresentação' : 'Edição'} | Nenhum vídeo detectado`);
            stableCount = 0;
            lastCurrentTime = 0;
            return;
        }
        
        // Detalhes do vídeo
        const status = v.isPlaying ? '▶️ ' : '⏸️ ';
        const mode = result.isInSlideShow ? 'Apresentação' : 'Edição';
        
        if (v.duration > 0) {
            // Vídeo com dados completos
            const hasValidCurrentTime = v.currentTime > 0;
            const progress = hasValidCurrentTime ? (v.currentTime / v.duration * 100).toFixed(1) : 0;
            const progressBarLength = 30;
            const filledLength = hasValidCurrentTime ? Math.floor(progress / 100 * progressBarLength) : 0;
            const progressBar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
            
            const output = [
                `${status} Slide ${result.currentSlide}/${result.slideCount}`,
                `| Modo: ${mode}`,
                `| ${formatTime(v.currentTime)}/${formatTime(v.duration)}`,
                hasValidCurrentTime ? `(${progress}%)` : '(tempo não disponível)',
                `| Restante: ${formatTime(v.remainingTime)}`,
                `| 🔊 ${(v.volume * 100).toFixed(0)}%`,
                v.muted ? '🔇' : ''
            ].join(' ');
            
            process.stdout.write(output);
            
            // Detecta se o vídeo está realmente tocando e avançando
            if (v.isPlaying) {
                if (v.currentTime !== lastCurrentTime && v.currentTime > 0) {
                    // currentTime está mudando - vídeo está realmente tocando
                    stableCount = 0;
                    lastCurrentTime = v.currentTime;
                    process.stdout.write(' ✅');
                } else if (v.currentTime === lastCurrentTime && v.currentTime === 0) {
                    // currentTime está em 0 e não muda - pode ser limitação do PowerPoint
                    stableCount++;
                    if (stableCount > 3) {
                        process.stdout.write(' ⚠️ (currentTime não disponível - timer pode estar estimando)');
                    }
                } else {
                    // currentTime mudou ou é > 0
                    lastCurrentTime = v.currentTime;
                    stableCount = 0;
                }
            } else {
                // Não está tocando
                stableCount = 0;
                lastCurrentTime = 0;
            }
        } else {
            // Vídeo detectado mas sem duração
            process.stdout.write(
                `${status} Slide ${result.currentSlide}/${result.slideCount} | ` +
                `Modo: ${mode} | ` +
                `Vídeo detectado (duração não disponível) | ` +
                `Tocando: ${v.isPlaying ? 'Sim' : 'Não'}`
            );
        }
        
        // Informações adicionais
        if (v.fileName) {
            process.stdout.write(` | 📄 ${v.fileName.substring(0, 30)}`);
        }
        
    } catch (error) {
        clearLine();
        process.stdout.write(`❌ Erro: ${error.message}`);
    }
}, UPDATE_INTERVAL);

// Limpa a linha ao sair
process.on('SIGINT', () => {
    clearLine();
    console.log('\n\n✅ Teste finalizado');
    process.exit(0);
});

// Mostra estatísticas a cada 10 segundos
setInterval(() => {
    if (iteration > 0) {
        console.log(`\n📊 Estatísticas: ${iteration} iterações processadas`);
        iteration = 0;
    }
}, 10000);





