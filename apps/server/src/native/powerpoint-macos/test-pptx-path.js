const { execSync } = require('child_process');

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

try {
    const result = execSync(`osascript -e '${applescript}'`, { encoding: 'utf8' });
    console.log('Caminho do .pptx:', result.trim());
    
    // Testa se o arquivo existe
    const fs = require('fs');
    const path = result.trim();
    if (fs.existsSync(path)) {
        console.log('✅ Arquivo existe!');
        
        // Tenta extrair e listar vídeos
        const tempDir = require('os').tmpdir() + '/pptx-test-' + Date.now();
        fs.mkdirSync(tempDir, { recursive: true });
        
        console.log('\nExtraindo vídeos do .pptx...');
        try {
            execSync(`unzip -q -o "${path}" "ppt/media/*" -d "${tempDir}"`, { stdio: 'inherit' });
            
            // Lista arquivos extraídos
            const mediaPath = tempDir + '/ppt/media';
            if (fs.existsSync(mediaPath)) {
                const files = fs.readdirSync(mediaPath);
                console.log('\nArquivos encontrados em ppt/media/:');
                files.forEach(file => {
                    const fullPath = mediaPath + '/' + file;
                    const stats = fs.statSync(fullPath);
                    if (!stats.isDirectory()) {
                        console.log(`  - ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                    }
                });
            } else {
                console.log('❌ Pasta ppt/media não encontrada');
            }
            
            // Limpa
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
            console.error('Erro ao extrair:', err.message);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } else {
        console.log('❌ Arquivo não existe!');
    }
} catch (error) {
    console.error('Erro:', error.message);
}

