tell application "Microsoft Powerpoint"
	tell active presentation
		tell slide 3
			set shapeList to shapes
			repeat with aShape in shapeList
				try
					set shapeTypeNum to type of aShape as integer
					if shapeTypeNum is 17 then
						set mf to media format of aShape
						
						try
							set play1 to is playing of mf
							log "is playing (direto): " & play1
							
							return "is playing: " & play1
						on error errMsg1
							log "Erro ao obter is playing: " & errMsg1
							
							try
								set playState to play state of mf
								log "play state: " & playState
								return "play state: " & playState
							on error errMsg2
								log "Erro ao obter play state: " & errMsg2
								return "Erro: " & errMsg1 & " | " & errMsg2
							end try
						end try
					end if
				end try
			end repeat
			return "Nenhum vídeo encontrado"
		end tell
	end tell
end tell





