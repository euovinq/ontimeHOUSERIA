import { type CSSProperties, useCallback, useRef, useState, useEffect } from 'react';

import { AutoTextArea } from '../../../../common/components/input/auto-text-area/AutoTextArea';
import useReactiveTextInput from '../../../../common/components/input/text-input/useReactiveTextInput';
import * as Editor from '../../../editors/editor-utils/EditorUtils';
import { EditorUpdateFields } from '../EventEditor';

interface CountedTextAreaProps {
  className?: string;
  field: EditorUpdateFields;
  label: string;
  initialValue: string;
  style?: CSSProperties;
  submitHandler: (field: EditorUpdateFields, value: string) => void;
}

export default function EventTextArea(props: CountedTextAreaProps) {
  const { className, field, label, initialValue, style: givenStyles, submitHandler } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  const submitCallback = useCallback((newValue: string) => {
    submitHandler(field, newValue);
    setIsEditing(false);
  }, [field, submitHandler]);

  const { value, onChange, onBlur, onKeyDown } = useReactiveTextInput(initialValue, submitCallback, ref, {
    submitOnCtrlEnter: true,
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

  return (
    <div>
      <Editor.Label className={className} htmlFor={field} style={givenStyles}>
        {label}
      </Editor.Label>
      {!isEditing && displayValue ? (
        <div
          onClick={handleClick}
          style={{
            minHeight: '2rem',
            padding: '0.5rem',
            fontSize: '0.875rem',
            cursor: 'text',
            width: '100%',
            lineHeight: '1.5',
            border: '1px solid',
            borderColor: 'var(--chakra-colors-gray-200)',
            borderRadius: '0.375rem',
            backgroundColor: 'transparent',
          }}
          dangerouslySetInnerHTML={{ __html: displayValue }}
        />
      ) : (
        <AutoTextArea
          id={field}
          inputref={ref}
          rows={1}
          size='sm'
          resize='none'
          variant='ontime-filled'
          data-testid='input-textarea'
          value={displayValue}
          onChange={onChange}
          onBlur={handleBlur}
          onKeyDown={onKeyDown}
          autoFocus={isEditing}
        />
      )}
    </div>
  );
}
