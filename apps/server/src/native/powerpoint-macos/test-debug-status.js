const { getPowerPointStatus } = require('./index.js');

console.log('=== DIAGNÓSTICO COMPLETO ===\n');

const test = () => {
    try {
        const result = getPowerPointStatus();
        
        console.log('📊 Status completo:');
        console.log(JSON.stringify(result, null, 2));
        console.log('\n');
        
        if (result.isAvailable && result.video) {
            console.log('🎬 Análise do vídeo:');
            console.log(`   hasVideo: ${result.video.hasVideo}`);
            console.log(`   isPlaying: ${result.video.isPlaying}`);
            console.log(`   duration: ${result.video.duration}s`);
            console.log(`   currentTime: ${result.video.currentTime}s`);
            console.log(`   remainingTime: ${result.video.remainingTime}s`);
            console.log(`   isInSlideShow: ${result.isInSlideShow || false}`);
            console.log(`   currentSlide: ${result.currentSlide}`);
            
            console.log('\n🔍 Diagnóstico:');
            if (result.video.hasVideo && result.video.isPlaying && result.video.currentTime === 0) {
                console.log('   ⚠️  Vídeo está tocando mas currentTime é 0');
                console.log('   → PowerPoint não está expondo currentPosition');
                console.log('   → Timer deveria iniciar para estimar o tempo');
            } else if (result.video.hasVideo && !result.video.isPlaying && result.video.duration > 0) {
                console.log('   ℹ️  Vídeo detectado mas não está tocando');
            } else if (result.video.hasVideo && result.video.isPlaying && result.video.currentTime > 0) {
                console.log('   ✅ Tudo funcionando! PowerPoint está expondo currentTime');
            }
        }
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error(error.stack);
    }
};

test();





