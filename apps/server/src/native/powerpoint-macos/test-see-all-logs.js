const { spawn } = require('child_process');
const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTE COM LOGS VISÍVEIS ===\n');
console.log('Este teste vai mostrar os logs diretamente no terminal.\n');
console.log('Também abra o Console.app para ver todos os logs do sistema.\n');
console.log('Pressione Ctrl+C para parar\n');

let count = 0;

const test = () => {
    count++;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`ITERAÇÃO ${count} - ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(50));
    
    try {
        console.log('📞 Chamando getPowerPointStatus()...');
        const result = getPowerPointStatus();
        
        console.log('\n📊 RESULTADO:');
        console.log(`  PowerPoint disponível: ${result.isAvailable}`);
        if (!result.isAvailable) {
            console.log(`  Erro: ${result.error || 'Desconhecido'}`);
        } else {
            console.log(`  Slide atual: ${result.currentSlide}`);
            console.log(`  Total de slides: ${result.slideCount}`);
            console.log(`  Modo apresentação: ${result.isInSlideShow ? 'SIM ✅' : 'NÃO ❌'}`);
            
            if (result.video) {
                const v = result.video;
                console.log(`\n🎬 VÍDEO:`);
                console.log(`  Tem vídeo: ${v.hasVideo ? 'SIM ✅' : 'NÃO ❌'}`);
                console.log(`  Está tocando: ${v.isPlaying ? 'SIM ✅' : 'NÃO ❌'}`);
                console.log(`  Duração: ${v.duration}s`);
                console.log(`  Tempo atual: ${v.currentTime}s`);
                console.log(`  Tempo restante: ${v.remainingTime}s`);
                console.log(`  Volume: ${(v.volume * 100).toFixed(0)}%`);
                console.log(`  Mudo: ${v.muted ? 'SIM' : 'NÃO'}`);
                if (v.fileName) {
                    console.log(`  Arquivo: ${v.fileName}`);
                }
            } else {
                console.log(`\n🎬 VÍDEO: Não detectado`);
            }
        }
        
        console.log('\n💡 LOGS DO SISTEMA:');
        console.log('   Abra o Console.app e procure por:');
        console.log('   - "isAudioPlayingFromPowerPoint"');
        console.log('   - "startAudioVideoMonitoring"');
        console.log('   - "ScreenCaptureKit"');
        console.log('   - "permissão"');
        console.log('   - "CAPTURADO"');
        
    } catch (error) {
        console.error('\n❌ ERRO:', error.message);
        console.error('Stack:', error.stack);
    }
};

// Executa imediatamente
test();

// Depois executa a cada 5 segundos
const interval = setInterval(test, 5000);

// Para quando receber Ctrl+C
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n✅ Teste finalizado!');
    process.exit(0);
});













