tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			set firstShape to item 1 of shapeList
			
			try
				set mf to media format of firstShape
				log "MediaFormat encontrado!"
				
				try
					set len to length of mf
					log "Length: " & len
				end try
				
				try
					set pos to current position of mf
					log "Current Position: " & pos
				end try
				
				try
					set vol to volume of mf
					log "Volume: " & vol
				end try
				
				try
					set play to is playing of mf
					log "Is Playing: " & play
				end try
				
			end try
		end tell
	end tell
end tell






