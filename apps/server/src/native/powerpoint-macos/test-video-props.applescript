tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set firstShape to item 1 of shapes
			
			try
				set mf to media format of firstShape
				set len to length of mf
				set pos to current position of mf
				set play to is playing of mf
				
				return "Length: " & len & " | Position: " & pos & " | Playing: " & play
			on error errMsg
				return "Erro: " & errMsg
			end try
		end tell
	end tell
end tell














