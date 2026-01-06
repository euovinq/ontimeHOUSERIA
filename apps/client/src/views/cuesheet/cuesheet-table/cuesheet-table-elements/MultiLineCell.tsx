import { memo, useCallback, useRef, useState, useEffect } from 'react';

import { AutoTextArea } from '../../../../common/components/input/auto-text-area/AutoTextArea';
import useReactiveTextInput from '../../../../common/components/input/text-input/useReactiveTextInput';

interface MultiLineCellProps {
  initialValue: string;
  handleUpdate: (newValue: string) => void;
}

export default memo(MultiLineCell, (prevProps, nextProps) => {
  // Only re-render if initialValue actually changed
  return prevProps.initialValue === nextProps.initialValue;
});

function MultiLineCell(props: MultiLineCellProps) {
  const { initialValue, handleUpdate } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  const submitCallback = useCallback((newValue: string) => {
    handleUpdate(newValue);
    setIsEditing(false);
  }, [handleUpdate]);

  const { value, onChange, onBlur, onKeyDown } = useReactiveTextInput(initialValue, submitCallback, ref, {
    submitOnCtrlEnter: true,
    allowKeyboardNavigation: true,
  });

  // Use value if available, otherwise fallback to initialValue
  const displayValue = value || initialValue;

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && ref.current) {
      ref.current.focus();
    }
  }, [isEditing]);

  const handleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    onBlur(e);
    setIsEditing(false);
  };

  // When not editing and has content, render HTML
  if (!isEditing && displayValue) {
    return (
      <div
        onClick={handleClick}
        style={{
          minHeight: '2rem',
          padding: '0.25rem 0',
          fontSize: '1rem',
          cursor: 'text',
          width: '100%',
          lineHeight: '1.5',
          backgroundColor: 'transparent',
        }}
        dangerouslySetInnerHTML={{ __html: displayValue }}
      />
    );
  }

  // When editing or empty, show textarea
  return (
    <AutoTextArea
      inputref={ref}
      rows={1}
      size='sm'
      style={{
        minHeight: '2rem',
        padding: '0',
        paddingTop: '0.25rem',
        fontSize: '1rem',
      }}
      transition='none'
      variant='ontime-transparent'
      value={displayValue}
      onChange={onChange}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoFocus={isEditing}
    />
  );
}
