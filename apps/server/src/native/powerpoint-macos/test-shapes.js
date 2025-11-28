const { getPowerPointStatus } = require('./index.js');

console.log('=== INSPECIONANDO SHAPES DO SLIDE 3 ===\n');

// Script AppleScript para listar shapes
const { exec } = require('child_process');

const applescript = `
tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			set shapeCount to count of shapeList
			log "Número de shapes: " & shapeCount
			
			repeat with i from 1 to shapeCount
				try
					set aShape to item i of shapeList
					set shapeName to name of aShape
					set shapeTypeNum to type of aShape as integer
					log "Shape " & i & ":"
					log "  Nome: " & shapeName
					log "  Tipo (número): " & shapeTypeNum
					
					-- Tenta obter outras propriedades
					try
						set shapeAutoShapeType to auto shape type of aShape as integer
						log "  AutoShape Type: " & shapeAutoShapeType
					end try
					
					try
						set shapeHasTextFrame to has text frame of aShape
						log "  Tem TextFrame: " & shapeHasTextFrame
					end try
					
					try
						set shapeMediaType to media type of aShape as integer
						log "  Media Type: " & shapeMediaType
					end try
					
					try
						set shapeMediaFormatLength to length of media format of aShape
						log "  Media Format Length (ms): " & shapeMediaFormatLength
					end try
					
				end try
			end repeat
		end tell
	end tell
end tell
`;

exec(`osascript -e '${applescript.replace(/'/g, "'\\''")}'`, (error, stdout, stderr) => {
	if (error) {
		console.error('Erro ao executar AppleScript:', error);
		return;
	}
	
	const output = (stderr || stdout || '').trim();
	console.log('Saída do AppleScript:');
	console.log(output);
	console.log('\n');
	
	// Também tenta via módulo nativo
	console.log('=== TENTANDO VIA MÓDULO NATIVO ===\n');
	const status = getPowerPointStatus();
	console.log('Status atual:', JSON.stringify(status, null, 2));
});














