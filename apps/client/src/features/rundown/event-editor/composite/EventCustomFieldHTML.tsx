import { type CSSProperties, useCallback, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';

import { AutoTextArea } from '../../../../common/components/input/auto-text-area/AutoTextArea';
import useReactiveTextInput from '../../../../common/components/input/text-input/useReactiveTextInput';
import * as Editor from '../../../editors/editor-utils/EditorUtils';
import { EditorUpdateFields } from '../EventEditor';

interface EventCustomFieldHTMLProps {
  className?: string;
  field: EditorUpdateFields;
  label: string;
  initialValue: string;
  style?: CSSProperties;
  submitHandler: (field: EditorUpdateFields, value: string) => void;
}

/**
 * Detecta se uma string contém HTML válido
 */
function isHTML(str: string): boolean {
  if (!str || str.trim().length === 0) return false;
  
  // Remove espaços em branco no início e fim
  const trimmed = str.trim();
  
  // Verifica se contém tags HTML (pelo menos uma tag de abertura e fechamento, ou tag auto-fechada)
  // Padrão: <tag> conteúdo </tag> ou <tag/> ou <tag atributos>
  const htmlTagPattern = /<[a-z][\s\S]*>/i;
  
  if (!htmlTagPattern.test(trimmed)) return false;
  
  // Verifica se não é apenas texto com < e > sem formar tags válidas
  // Conta tags de abertura e fechamento
  const openTags = (trimmed.match(/<[^/!][^>]*>/g) || []).length;
  const closeTags = (trimmed.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (trimmed.match(/<[^>]+\/>/g) || []).length;
  
  // Se tem tags de abertura/fechamento ou auto-fechadas, provavelmente é HTML
  return openTags > 0 || closeTags > 0 || selfClosingTags > 0;
}

export default function EventCustomFieldHTML(props: EventCustomFieldHTMLProps) {
  const { className, field, label, initialValue, style: givenStyles, submitHandler } = props;
  const ref = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const submitCallback = useCallback((newValue: string) => {
    submitHandler(field, newValue);
    setIsEditing(false);
  }, [field, submitHandler]);

  const { value, onChange, onBlur, onKeyDown } = useReactiveTextInput(initialValue, submitCallback, ref, {
    submitOnCtrlEnter: true,
  });

  const containsHTML = isHTML(value);

  // Se não contém HTML ou está editando, mostra textarea normal
  if (!containsHTML || isEditing) {
    return (
      <div>
        <Editor.Label className={className} htmlFor={field} style={givenStyles}>
          {label}
        </Editor.Label>
        <AutoTextArea
          id={field}
          inputref={ref}
          rows={1}
          size='sm'
          resize='none'
          variant='ontime-filled'
          data-testid='input-textarea'
          value={value}
          onChange={onChange}
          onBlur={(e) => {
            onBlur(e);
            setIsEditing(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setIsEditing(true)}
        />
      </div>
    );
  }

  // Se contém HTML e não está editando, mostra preview renderizado
  return (
    <div>
      <Editor.Label className={className} htmlFor={field} style={givenStyles}>
        {label}
      </Editor.Label>
      <Box
        position='relative'
        minH='32px'
        p={2}
        border='1px solid'
        borderColor='transparent'
        borderRadius='3px'
        bg='#262626'
        color='#e2e2e2'
        cursor='pointer'
        onClick={() => {
          setIsEditing(true);
          // Foca no textarea após um pequeno delay para garantir que ele foi renderizado
          setTimeout(() => {
            ref.current?.focus();
          }, 50);
        }}
        title='Clique para editar HTML'
        dangerouslySetInnerHTML={{ __html: value }}
        sx={{
          '& *': {
            maxWidth: '100%',
          },
          '&:hover': {
            bg: '#2d2d2d',
          },
          '&::after': {
            content: '"📝 HTML"',
            position: 'absolute',
            top: '4px',
            right: '8px',
            fontSize: '10px',
            color: '#9d9d9d',
            pointerEvents: 'none',
          },
        }}
      />
    </div>
  );
}
