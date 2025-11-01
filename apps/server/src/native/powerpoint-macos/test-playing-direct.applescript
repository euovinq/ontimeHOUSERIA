tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			repeat with aShape in shapeList
				try
					set shapeTypeNum to type of aShape as integer
					if shapeTypeNum is 17 then
						set mf to media format of aShape
						
						-- Tenta obter is playing de diferentes formas
						try
							set play1 to is playing of mf
							log "is playing: " & play1
						on error err1
							log "Erro ao obter is playing: " & err1
						end try
						
						try
							set play2 to play state of mf
							log "play state: " & play2
						on error err2
							log "Erro ao obter play state: " & err2
						end try
						
						try
							set pos to current position of mf
							log "current position: " & pos
						on error err3
							log "Erro ao obter current position: " & err3
						end try
						
						try
							set len to length of mf
							log "length: " & len
						on error err4
							log "Erro ao obter length: " & err4
						end try
						
						return "Teste completo"
					end if
				end try
			end repeat
		end tell
	end tell
end tell





