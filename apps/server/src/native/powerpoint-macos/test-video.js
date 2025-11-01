const { getPowerPointStatus } = require('./index.js');

console.log('=== TESTANDO CAPTURA DE VÍDEO ===\n');
console.log('Certifique-se de que há um vídeo rodando em um slide do PowerPoint\n');

try {
    const result = getPowerPointStatus();
    console.log('Resultado completo:', JSON.stringify(result, null, 2));
    
    if (result.isAvailable) {
        console.log('\n✅ PowerPoint detectado!');
        console.log(`📍 Slide atual: ${result.currentSlide}`);
        
        if (result.video) {
            console.log('\n🎬 INFORMAÇÕES DO VÍDEO:');
            console.log(`   Tem vídeo: ${result.video.hasVideo ? 'Sim' : 'Não'}`);
            console.log(`   Está reproduzindo: ${result.video.isPlaying ? 'Sim' : 'Não'}`);
            
            if (result.video.hasVideo) {
                const duration = result.video.duration;
                const currentTime = result.video.currentTime;
                const remaining = result.video.remainingTime;
                const volume = result.video.volume || 0;
                const muted = result.video.muted || false;
                const fileName = result.video.fileName || '';
                const sourceUrl = result.video.sourceUrl || '';
                
                // Formata em minutos:segundos
                const formatTime = (seconds) => {
                    const mins = Math.floor(seconds / 60);
                    const secs = Math.floor(seconds % 60);
                    return `${mins}:${secs.toString().padStart(2, '0')}`;
                };
                
                const isPlaying = result.video.isPlaying || false;
                
                if (duration > 0) {
                    console.log(`   Duração total: ${duration.toFixed(2)}s`);
                    console.log(`   Tempo atual: ${currentTime.toFixed(2)}s`);
                    console.log(`   ⏱️  Tempo restante: ${remaining.toFixed(2)}s`);
                    console.log(`   📊 Duração: ${formatTime(duration)}`);
                    console.log(`   ⏯️  Atual: ${formatTime(currentTime)}`);
                    console.log(`   ⏳ Restante: ${formatTime(remaining)}`);
                    
                    if (currentTime === 0 && isPlaying) {
                        console.log(`   ⚠️  NOTA: currentTime sempre 0 - limitação do PowerPoint para vídeos linkados externamente.`);
                        console.log(`      O PowerPoint não expõe currentPosition em tempo real para vídeos linkados.`);
                        console.log(`      Para rastrear o progresso, considere incorporar o vídeo ao invés de apenas linká-lo.`);
                    }
                } else {
                    console.log(`   ⚠️  Duração e tempo não disponíveis`);
                    console.log(`   💡 Para vídeos incorporados no slide, o PowerPoint só expõe`);
                    console.log(`      duration e currentTime quando:`);
                    console.log(`      • O vídeo está reproduzindo`);
                    console.log(`      • O slide está VISÍVEL na tela (não minimizado/oculto)`);
                    console.log(`   💡 Se o vídeo está tocando, mas ainda mostra 0, certifique-se`);
                    console.log(`      de que o slide está visível e o vídeo está realmente tocando.`);
                }
                
                console.log(`   🔊 Volume: ${(volume * 100).toFixed(0)}%`);
                console.log(`   🔇 Mudo: ${muted ? 'Sim' : 'Não'}`);
                
                if (fileName) {
                    console.log(`   📁 Arquivo: ${fileName}`);
                }
                if (sourceUrl && sourceUrl !== fileName) {
                    console.log(`   🔗 URL/Caminho: ${sourceUrl}`);
                } else if (!sourceUrl && fileName) {
                    console.log(`   📝 Nota: Vídeo incorporado no slide (sem caminho externo)`);
                }
            }
        } else {
            console.log('\n⚠️  Nenhuma informação de vídeo disponível');
        }
    } else {
        console.log('\n❌ Erro:', result.error);
    }
} catch (error) {
    console.error('Erro ao executar:', error);
}


