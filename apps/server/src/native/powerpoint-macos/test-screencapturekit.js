const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTE ScreenCaptureKit - Interceptação de Áudio/Vídeo ===\n');
console.log('⚠️  IMPORTANTE: Este teste requer permissões de captura de tela/áudio!');
console.log('   1. Vá em: Sistema > Privacidade e Segurança');
console.log('   2. Selecione: Gravação do Áudio do Sistema e da Tela');
console.log('   3. Ative para: Terminal (ou Node.js)\n');
console.log('Pressione Ctrl+C para parar\n');

let iteration = 0;
let lastAudioDetected = false;
let lastVideoDetected = false;

const test = () => {
    iteration++;
    try {
        const result = getPowerPointStatus();
        
        // Limpa linha anterior
        process.stdout.write('\x1b[2K\r');
        
        if (!result.isAvailable) {
            process.stdout.write(`❌ PowerPoint não está disponível`);
            return;
        }
        
        const v = result.video;
        const hasVideo = v && v.hasVideo;
        
        if (!hasVideo) {
            process.stdout.write(`ℹ️  Slide ${result.currentSlide} | Sem vídeo | Modo: ${result.isInSlideShow ? 'Apresentação' : 'Edição'}`);
            return;
        }
        
        // Status de interceptação (via logs do Console.app ou verificando isPlaying)
        const status = v.isPlaying ? '▶️ ' : '⏸️ ';
        const mode = result.isInSlideShow ? 'Apresentação' : 'Edição';
        
        let audioStatus = '❓';
        let videoStatus = '❓';
        
        // Se isPlaying mudou para true, pode ser que a interceptação detectou
        if (v.isPlaying && !lastAudioDetected && !lastVideoDetected) {
            audioStatus = '🎵?';
            videoStatus = '🎬?';
        }
        
        const output = [
            `${status} Slide ${result.currentSlide} | Modo: ${mode}`,
            `| Tocando: ${v.isPlaying ? 'SIM ✅' : 'NÃO ❌'}`,
            `| Duração: ${v.duration > 0 ? v.duration.toFixed(1) + 's' : 'N/A'}`,
            `| Tempo: ${v.currentTime > 0 ? v.currentTime.toFixed(1) + 's' : '0s'}`,
        ].join(' ');
        
        process.stdout.write(output);
        
        // Verifica logs no Console.app
        if (iteration % 20 === 0) {
            console.log('\n💡 Verifique o Console.app para logs de interceptação:');
            console.log('   Procure por: "ÁUDIO DETECTADO" ou "VÍDEO DETECTADO"');
        }
        
    } catch (error) {
        process.stdout.write(`❌ Erro: ${error.message}`);
    }
};

// Executa imediatamente
test();

// Depois executa a cada 500ms
const interval = setInterval(test, 500);

// Para quando receber Ctrl+C
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n✅ Teste finalizado!');
    console.log('\n📋 Dica: Abra o Console.app e filtre por "ScreenCaptureKit" ou "PowerPoint"');
    console.log('   para ver os logs detalhados de interceptação.');
    process.exit(0);
});





