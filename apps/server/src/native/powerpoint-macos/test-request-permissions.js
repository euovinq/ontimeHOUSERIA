const { getPowerPointStatus } = require('./index.js');

console.log('=== SOLICITANDO PERMISSÕES DE CAPTURA DE TELA/ÁUDIO ===\n');
console.log('⚠️  IMPORTANTE: O macOS pode não solicitar permissão automaticamente.');
console.log('   Se não aparecer um diálogo, siga os passos abaixo:\n');
console.log('1. Abra: Sistema > Configurações');
console.log('2. Vá em: Privacidade e Segurança');
console.log('3. Selecione: Gravação do Áudio do Sistema e da Tela');
console.log('4. Procure por: Terminal (ou Node.js)');
console.log('5. Ative a permissão\n');
console.log('Aguardando 3 segundos antes de testar...\n');

setTimeout(() => {
    console.log('🔍 Testando acesso ao ScreenCaptureKit...\n');
    
    try {
        // Isso vai tentar acessar o ScreenCaptureKit e deve solicitar permissão
        const result = getPowerPointStatus();
        
        console.log('\n📊 Resultado do teste:');
        console.log(JSON.stringify(result, null, 2));
        
        console.log('\n💡 Abra o Console.app para ver os logs detalhados:');
        console.log('   - Filtre por: "permissão" ou "ScreenCaptureKit"');
        console.log('   - Procure por: "❌ PERMISSÃO DE CAPTURA DE TELA NEGADA!"');
        console.log('   - Ou: "✅ Permissões de captura de tela OK"');
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error('\n💡 Verifique o Console.app para mais detalhes');
    }
}, 3000);





