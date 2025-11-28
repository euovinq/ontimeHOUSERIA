const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTE FORÇADO DE isPlaying ===\n');
console.log('Por favor, certifique-se de que:');
console.log('  1. O vídeo está TOCANDO no PowerPoint');
console.log('  2. O slide com o vídeo está VISÍVEL');
console.log('  3. O PowerPoint está em modo de APRESENTAÇÃO (F5) ou o vídeo está reproduzindo\n');
console.log('Aguardando 2 segundos...\n');

setTimeout(() => {
    const result = getPowerPointStatus();
    
    console.log('Resultado completo:\n');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.isAvailable && result.video && result.video.hasVideo) {
        console.log('\n=== ANÁLISE ===');
        console.log(`isPlaying: ${result.video.isPlaying}`);
        console.log(`currentTime: ${result.video.currentTime}`);
        console.log(`duration: ${result.video.duration}`);
        console.log(`isInSlideShow: ${result.isInSlideShow || false}`);
        
        if (!result.video.isPlaying) {
            console.log('\n⚠️  PROBLEMA: isPlaying está false mesmo com vídeo tocando');
            console.log('\nPossíveis causas:');
            console.log('  1. PowerPoint não está expondo isPlaying para vídeos linkados');
            console.log('  2. Vídeo não está realmente tocando (pausado ou parado)');
            console.log('  3. Slide não está visível ou PowerPoint não carregou o estado');
            console.log('  4. Limitação do PowerPoint para vídeos linkados externamente');
        } else {
            console.log('\n✅ SUCESSO: isPlaying está sendo detectado corretamente!');
        }
    }
}, 2000);













