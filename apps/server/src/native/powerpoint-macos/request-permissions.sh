#!/bin/bash

echo "=== SOLICITANDO PERMISSÕES DE CAPTURA DE TELA/ÁUDIO ==="
echo ""
echo "Este script vai tentar solicitar permissões acessando o ScreenCaptureKit."
echo "O macOS deve mostrar um diálogo pedindo permissão."
echo ""
echo "Se o diálogo não aparecer, você precisa ativar manualmente:"
echo "1. Abra: Sistema > Configurações (ou Preferências do Sistema)"
echo "2. Vá em: Privacidade e Segurança"
echo "3. Selecione: Gravação do Áudio do Sistema e da Tela"
echo "4. Ative para: Terminal (ou Node.js)"
echo ""
read -p "Pressione Enter para continuar..."

# Executa um teste simples que vai tentar acessar ScreenCaptureKit
node -e "
const { getPowerPointStatus } = require('./index.js');
console.log('Testando acesso ao ScreenCaptureKit...');
try {
    const result = getPowerPointStatus();
    console.log('Status:', result);
} catch (e) {
    console.log('Erro:', e.message);
}
"

echo ""
echo "Verifique o Console.app para ver os logs de permissão."
echo "Abra o Console.app e filtre por 'ScreenCaptureKit' ou 'permissão'"





