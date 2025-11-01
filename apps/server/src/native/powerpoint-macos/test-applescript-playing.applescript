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
							set len to length of mf
							set pos to current position of mf
							set play to is playing of mf
							
							return "VIDEO ENCONTRADO:" & return & "Duração: " & len & " ms" & return & "Posição: " & pos & " ms" & return & "Tocando: " & play
						on error errMsg
							return "Erro ao obter dados do vídeo: " & errMsg
						end try
					end if
				end try
			end repeat
			return "Nenhum vídeo encontrado no slide 3"
		end tell
	end tell
end tell





