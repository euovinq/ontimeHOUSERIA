const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTE DE DEBUG - INTERCEPTAÇÃO ===\n');
console.log('Este teste vai chamar getPowerPointStatus e mostrar logs detalhados.\n');
console.log('Abra o Console.app e filtre por:');
console.log('   - "ScreenCaptureKit"');
console.log('   - "interceptação"');
console.log('   - "PID"');
console.log('   - "permissão"\n');
console.log('Pressione Ctrl+C para parar\n');

let count = 0;

const test = () => {
    count++;
    console.log(`\n--- Iteração ${count} ---`);
    
    try {
        const result = getPowerPointStatus();
        
        console.log('Resultado:');
        console.log(`  - PowerPoint disponível: ${result.isAvailable}`);
        console.log(`  - Slide atual: ${result.currentSlide}`);
        console.log(`  - Modo apresentação: ${result.isInSlideShow}`);
        
        if (result.video) {
            const v = result.video;
            console.log(`  - Tem vídeo: ${v.hasVideo}`);
            console.log(`  - Está tocando: ${v.isPlaying}`);
            console.log(`  - Duração: ${v.duration}s`);
            console.log(`  - Tempo atual: ${v.currentTime}s`);
        }
        
        console.log('\n💡 Verifique o Console.app para logs detalhados da interceptação!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error(error.stack);
    }
};

// Executa imediatamente
test();

// Depois executa a cada 3 segundos
const interval = setInterval(test, 3000);

// Para quando receber Ctrl+C
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n✅ Teste finalizado!');
    console.log('\n📋 Para ver todos os logs:');
    console.log('   1. Abra o Console.app');
    console.log('   2. Filtre por: "ScreenCaptureKit", "PID", "permissão"');
    console.log('   3. Procure por mensagens de erro ou sucesso');
    process.exit(0);
});





