tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			set shapeCount to count of shapeList
			log "Numero de shapes: " & shapeCount
			
			repeat with i from 1 to shapeCount
				try
					set aSquare to item i of shapeList
					set shapeName to name of aSquare
					set shapeTypeNum to type of aSquare as integer
					log "Shape " & i & " - Nome: " & shapeName & " - Tipo: " & shapeTypeNum
				end try
			end repeat
		end tell
	end tell
end tell














