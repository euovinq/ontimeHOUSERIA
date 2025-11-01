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
							return {len, pos, play}
						on error
							return {0, 0, false}
						end try
					end if
				end try
			end repeat
			return {0, 0, false}
		end tell
	end tell
end tell





