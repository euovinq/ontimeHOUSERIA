tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			set shapeCount to count of shapeList
			set resultText to "Numero de shapes: " & shapeCount & return
			
			repeat with i from 1 to shapeCount
				try
					set aSquare to item i of shapeList
					set shapeName to name of aSquare
					set shapeTypeNum to type of aSquare as integer
					set resultText to resultText & "Shape " & i & " - Nome: " & shapeName & " - Tipo: " & shapeTypeNum & return
				end try
			end repeat
			
			return resultText
		end tell
	end tell
end tell






