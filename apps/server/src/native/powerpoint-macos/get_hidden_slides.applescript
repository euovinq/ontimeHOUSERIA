tell application "Microsoft Powerpoint"
	tell active presentation
		set slideList to slides
		set hiddenSlides to {}
		
		repeat with aSlide in slideList
			try
				set slideTransition to slide show transition of aSlide
				set isHidden to hidden of slideTransition
				if isHidden then
					set slideNumber to slide number of aSlide
					set end of hiddenSlides to slideNumber
				end if
			end try
		end repeat
		
		return hiddenSlides
	end tell
end tell






