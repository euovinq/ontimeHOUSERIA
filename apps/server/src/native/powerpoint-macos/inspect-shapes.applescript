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














