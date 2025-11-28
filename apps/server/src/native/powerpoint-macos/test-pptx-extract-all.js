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

try {
    const pptxPath = execSync(`osascript -e '${applescript}'`, { encoding: 'utf8' }).trim();
    console.log('Caminho do .pptx:', pptxPath);
    
    if (!fs.existsSync(pptxPath)) {
        console.log('❌ Arquivo não existe!');
        process.exit(1);
    }
    
    console.log('✅ Arquivo existe!\n');
    
    // Extrai TUDO do .pptx
    const tempDir = require('os').tmpdir() + '/pptx-full-test-' + Date.now();
    fs.mkdirSync(tempDir, { recursive: true });
    
    console.log('Extraindo TUDO do .pptx...');
    try {
        execSync(`unzip -q -o "${pptxPath}" -d "${tempDir}"`, { stdio: 'inherit' });
        
        // Busca recursivamente por TODOS os arquivos de vídeo
        const videoExtensions = ['mp4', 'mov', 'avi', 'm4v', 'wmv', 'flv', 'mkv', 'webm', 'mpg', 'mpeg'];
        const videos = [];
        
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
                        videos.push({
                            path: relativePath,
                            fullPath: fullPath,
                            size: stats.size,
                            sizeMB: (stats.size / 1024 / 1024).toFixed(2)
                        });
                    }
                }
            });
        };
        
        findVideos(tempDir);
        
        if (videos.length > 0) {
            console.log(`\n✅ Encontrados ${videos.length} vídeo(s):\n`);
            videos.forEach((v, i) => {
                console.log(`${i + 1}. ${v.path}`);
                console.log(`   Tamanho: ${v.sizeMB} MB`);
                console.log(`   Caminho completo: ${v.fullPath}\n`);
            });
        } else {
            console.log('\n❌ Nenhum vídeo encontrado no .pptx');
            console.log('\nO PowerPoint pode estar usando link para o vídeo externo.');
            console.log('Listando estrutura de diretórios...\n');
            
            const listDirs = (dir, level = 0) => {
                const indent = '  '.repeat(level);
                try {
                    const files = fs.readdirSync(dir, { withFileTypes: true });
                    files.slice(0, 10).forEach(f => {
                        const fullPath = path.join(dir, f.name);
                        if (f.isDirectory()) {
                            console.log(`${indent}📁 ${f.name}/`);
                            if (level < 2) {
                                listDirs(fullPath, level + 1);
                            }
                        } else {
                            const ext = path.extname(f.name).toLowerCase();
                            const size = fs.statSync(fullPath).size;
                            if (size > 1024 * 1024) { // > 1MB
                                console.log(`${indent}  📄 ${f.name} (${(size / 1024 / 1024).toFixed(2)} MB)`);
                            }
                        }
                    });
                } catch (e) {
                    // Ignora
                }
            };
            
            listDirs(tempDir);
        }
        
        // Limpa
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
        console.error('Erro ao extrair:', err.message);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
} catch (error) {
    console.error('Erro:', error.message);
}













