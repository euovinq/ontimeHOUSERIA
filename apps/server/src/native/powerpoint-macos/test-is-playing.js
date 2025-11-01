const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTANDO DETECÇÃO DE isPlaying ===\n');
console.log('Por favor, inicie a reprodução do vídeo no PowerPoint\n');
console.log('Aguardando 3 segundos...\n');

setTimeout(() => {
    console.log('Testando agora...\n');
    
    const result = getPowerPointStatus();
    
    if (result.isAvailable && result.video && result.video.hasVideo) {
        console.log('Resultado do AppleScript e Scripting Bridge:');
        console.log('  isPlaying (direto):', result.video.isPlaying);
        console.log('  currentTime:', result.video.currentTime);
        console.log('  duration:', result.video.duration);
        console.log('\nTeste 2: Aguardando 2 segundos e testando novamente...\n');
        
        setTimeout(() => {
            const result2 = getPowerPointStatus();
            
            if (result2.video) {
                console.log('Resultado após 2 segundos:');
                console.log('  isPlaying:', result2.video.isPlaying);
                console.log('  currentTime:', result2.video.currentTime);
                console.log('  duration:', result2.video.duration);
                
                // Se currentTime mudou, está tocando
                if (result2.video.currentTime > result.video.currentTime) {
                    console.log('\n✅ DETECTADO: currentTime mudou, vídeo está tocando!');
                } else if (result2.video.currentTime === result.video.currentTime && result2.video.currentTime > 0) {
                    console.log('\n⚠️  currentTime não mudou, mas é > 0. Pode estar tocando em loop ou pausado.');
                } else {
                    console.log('\n❌ currentTime ainda é 0. PowerPoint pode não estar expondo essa informação.');
                }
            }
        }, 2000);
    }
}, 3000);





