const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Tenta obter o caminho do arquivo .pptx usando AppleScript
const applescript = `
tell application "Microsoft Powerpoint"
    if it is running then
        tell active presentation
            return full name of it
        end tell
    end if
end tell
`;

console.log('=== VERIFICANDO SE O VÍDEO ESTÁ INCORPORADO NO .PPTX ===\n');

try {
    const pptxPath = execSync(`osascript -e '${applescript}'`, { encoding: 'utf8' }).trim();
    console.log('📄 Arquivo .pptx:', pptxPath);
    
    if (!fs.existsSync(pptxPath)) {
        console.log('❌ Arquivo não existe!');
        process.exit(1);
    }
    
    // Verifica o tamanho do arquivo
    const stats = fs.statSync(pptxPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`📊 Tamanho do arquivo: ${sizeMB} MB\n`);
    
    // Extrai TUDO do .pptx
    const tempDir = require('os').tmpdir() + '/pptx-check-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });
    
    console.log('📦 Extraindo conteúdo do .pptx...');
    try {
        execSync(`unzip -q -o "${pptxPath}" -d "${tempDir}"`, { stdio: 'inherit' });
        
        // Busca recursivamente por TODOS os arquivos de vídeo
        const videoExtensions = ['mp4', 'mov', 'avi', 'm4v', 'wmv', 'flv', 'mkv', 'webm', 'mpg', 'mpeg'];
        const videos = [];
        let totalVideoSize = 0;
        
        const findVideos = (dir) => {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            files.forEach(f => {
                const fullPath = path.join(dir, f.name);
                if (f.isDirectory()) {
                    findVideos(fullPath);
                } else {
                    const ext = path.extname(f.name).toLowerCase().slice(1);
                    if (videoExtensions.includes(ext)) {
                        const stats = fs.statSync(fullPath);
                        const relativePath = path.relative(tempDir, fullPath);
                        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                        totalVideoSize += stats.size;
                        videos.push({
                            path: relativePath,
                            fullPath: fullPath,
                            size: stats.size,
                            sizeMB: sizeMB,
                            fileName: f.name
                        });
                    }
                }
            });
        };
        
        findVideos(tempDir);
        
        if (videos.length > 0) {
            console.log(`\n✅ VÍDEO(S) ENCONTRADO(S) DENTRO DO .PPTX!\n`);
            console.log(`   Total: ${videos.length} vídeo(s)`);
            console.log(`   Tamanho total dos vídeos: ${(totalVideoSize / 1024 / 1024).toFixed(2)} MB\n`);
            
            videos.forEach((v, i) => {
                console.log(`${i + 1}. ${v.fileName}`);
                console.log(`   📍 Localização: ${v.path}`);
                console.log(`   📊 Tamanho: ${v.sizeMB} MB\n`);
            });
            
            console.log('✅ CONCLUSÃO: O vídeo ESTÁ incorporado no .pptx!');
            console.log('   O PowerPoint deve expor currentTime quando o vídeo estiver reproduzindo.\n');
        } else {
            console.log('\n❌ NENHUM VÍDEO ENCONTRADO DENTRO DO .PPTX!\n');
            console.log('⚠️  O vídeo ainda está LINKADO externamente.');
            console.log('   Isso significa que:');
            console.log('   • O vídeo não está dentro do arquivo .pptx');
            console.log('   • O PowerPoint apenas referencia o arquivo externo');
            console.log('   • O PowerPoint pode não expor currentTime para vídeos linkados\n');
            console.log('💡 Para incorporar o vídeo:');
            console.log('   1. Clique com botão direito no vídeo no PowerPoint');
            console.log('   2. Procure por "Salvar como mídia incorporada" ou "Incorporar vídeo"');
            console.log('   3. Ou delete o vídeo atual e reinsira usando "Inserir > Vídeo > Vídeo da Biblioteca de Mídia"');
            console.log('   4. Certifique-se de escolher "Inserir" ao invés de "Linkar para arquivo"');
            console.log('   5. Salve o arquivo novamente\n');
        }
        
        // Limpa
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
        console.error('❌ Erro ao extrair:', err.message);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
} catch (error) {
    console.error('❌ Erro:', error.message);
}





