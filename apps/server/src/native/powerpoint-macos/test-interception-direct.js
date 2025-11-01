const { getPowerPointStatus } = require('./index.js');

console.log('=== INTERCEPTAÇÃO DIRETA DE ÁUDIO E VÍDEO ===\n');
console.log('🎯 Este script vai interceptar diretamente o áudio e vídeo do PowerPoint');
console.log('📊 Abra o Console.app para ver os logs detalhados:\n');
console.log('   - Filtre por: "CAPTURADO" ou "ScreenCaptureKit"');
console.log('   - Você verá: "🎵 ÁUDIO CAPTURADO!" ou "🎬 VÍDEO CAPTURADO!"');
console.log('\n⚠️  Certifique-se de que tem permissões ativadas!\n');

let iteration = 0;

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
            process.stdout.write(`ℹ️  Slide ${result.currentSlide} | Sem vídeo | Aguardando...`);
            return;
        }
        
        const status = v.isPlaying ? '▶️ ' : '⏸️ ';
        const mode = result.isInSlideShow ? 'Apresentação' : 'Edição';
        
        const output = [
            `${status} Slide ${result.currentSlide} | Modo: ${mode}`,
            `| Tocando: ${v.isPlaying ? 'SIM ✅' : 'NÃO'}`,
            `| Duração: ${v.duration > 0 ? v.duration.toFixed(1) + 's' : 'N/A'}`,
            `| Tempo: ${v.currentTime > 0 ? v.currentTime.toFixed(1) + 's' : '0s'}`,
        ].join(' ');
        
        process.stdout.write(output);
        
        // Mostra instrução periodicamente
        if (iteration % 40 === 0) {
            console.log('\n💡 Verifique o Console.app para ver logs de interceptação!');
            console.log('   Procure por: "🎵 ÁUDIO CAPTURADO" ou "🎬 VÍDEO CAPTURADO"');
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
    console.log('\n📋 Para ver logs de interceptação:');
    console.log('   1. Abra o Console.app');
    console.log('   2. Filtre por: "ScreenCaptureKit" ou "CAPTURADO"');
    console.log('   3. Procure por mensagens de áudio/vídeo capturado');
    process.exit(0);
});





