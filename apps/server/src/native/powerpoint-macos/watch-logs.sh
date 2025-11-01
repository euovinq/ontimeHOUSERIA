#!/bin/bash

echo "=== MONITORANDO LOGS DO SISTEMA ==="
echo ""
echo "Este script vai mostrar os logs em tempo real."
echo "Os logs do nosso código aparecerão aqui!"
echo ""
echo "Pressione Ctrl+C para parar"
echo ""

# Monitora logs do sistema procurando por mensagens do nosso código
log stream --predicate 'processImagePath contains "node" OR senderImagePath contains "powerpoint_macos"' --level=debug --style=compact 2>&1 | grep -E "(ScreenCaptureKit|PID|permissão|CAPTURADO|interceptação|Audio|Video|🎵|🎬|✅|❌|⚠️|🔍|📊|🎯|📡)" --line-buffered





