const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTANDO CAPTURA DE VÍDEO (MODO CONTÍNUO) ===\n');
console.log('💡 Instruções:');
console.log('   1. Abra o PowerPoint com o slide que contém o vídeo');
console.log('   2. Vá para o modo de apresentação (F5) ou clique em "Reproduzir" no vídeo');
console.log('   3. Este script vai atualizar a cada 1 segundo\n');
console.log('Pressione Ctrl+C para parar\n');

const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

let lastCurrentTime = 0;
let stableCount = 0;

const test = () => {
    try {
        const result = getPowerPointStatus();
        
        // Limpa a linha anterior (Unix/Linux/Mac)
        process.stdout.write('\x1b[2K\r');
        
        if (result.isAvailable) {
            if (result.video && result.video.hasVideo) {
                const v = result.video;
                const status = v.isPlaying ? '▶️' : '⏸️';
                
                if (v.duration > 0) {
                    // Vídeo com dados completos
                    // Se currentTime é 0 mas está tocando, mostra estimativa baseada no tempo decorrido
                    const hasValidCurrentTime = v.currentTime > 0;
                    const progress = hasValidCurrentTime ? (v.currentTime / v.duration * 100).toFixed(1) : 0;
                    const progressBar = hasValidCurrentTime ? ('█'.repeat(Math.floor(progress / 2)) + '░'.repeat(50 - Math.floor(progress / 2))) : '░'.repeat(50);
                    
                    process.stdout.write(
                        `${status} Slide ${result.currentSlide} | ` +
                        `${formatTime(v.currentTime)}/${formatTime(v.duration)} ` +
                        (hasValidCurrentTime ? `(${progress}%)` : '(progresso não disponível)') +
                        ` | Restante: ${formatTime(v.remainingTime)} | ` +
                        `🔊 ${(v.volume * 100).toFixed(0)}%`
                    );
                    
                    // Detecta se o vídeo está realmente tocando
                    if (v.isPlaying && v.currentTime !== lastCurrentTime && v.currentTime > 0) {
                        stableCount = 0;
                        lastCurrentTime = v.currentTime;
                    } else if (v.isPlaying && v.currentTime === lastCurrentTime && v.currentTime === 0) {
                        stableCount++;
                        if (stableCount > 2) {
                            process.stdout.write(' ⚠️ (currentTime não disponível - limitação do PowerPoint para vídeos linkados)');
                        }
                    }
                } else {
                    // Vídeo detectado mas sem dados de tempo ainda
                    process.stdout.write(
                        `🎬 Vídeo detectado no slide ${result.currentSlide} mas dados de tempo ainda não disponíveis...`
                    );
                }
            } else {
                process.stdout.write(`📄 Slide ${result.currentSlide} - Nenhum vídeo detectado`);
            }
        } else {
            process.stdout.write(`❌ PowerPoint não detectado: ${result.error || 'não aberto'}`);
        }
        
        // Move cursor para o final da linha mas não quebra
        process.stdout.write('\r');
    } catch (error) {
        process.stdout.write(`❌ Erro: ${error.message}`);
    }
};

// Executa imediatamente
test();

// Depois executa a cada 1 segundo
const interval = setInterval(test, 1000);

// Para quando receber Ctrl+C
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n✅ Teste finalizado!');
    process.exit(0);
});

