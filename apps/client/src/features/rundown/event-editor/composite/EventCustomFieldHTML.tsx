import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonGroup, Tooltip } from '@chakra-ui/react';

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
  /** Modo compacto (ex: célula de tabela) - oculta label e reduz tamanho */
  compact?: boolean;
}

/**
 * Detecta se uma string contém HTML válido
 */
function isHTML(str: string): boolean {
  if (!str || str.trim().length === 0) return false;

  const trimmed = str.trim();
  const htmlTagPattern = /<[a-z][\s\S]*>/i;

  if (!htmlTagPattern.test(trimmed)) return false;

  const openTags = (trimmed.match(/<[^/!][^>]*>/g) || []).length;
  const closeTags = (trimmed.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (trimmed.match(/<[^>]+\/>/g) || []).length;

  return openTags > 0 || closeTags > 0 || selfClosingTags > 0;
}

function nl2br(html: string): string {
  return String(html ?? '').replace(/\n/g, '<br />');
}

/**
 * Normaliza HTML: remove divs redundantes, padroniza quebras de linha
 * e corrige estrutura malformada (ex: texto solto após </p>).
 */
function normalizeHtml(html: string): string {
  let result = String(html ?? '')
    .replace(/\n/g, '<br />')
    .replace(/<div><br\s*\/?><\/div>/gi, '<br />')
    .replace(/<div><\/div>/gi, '<br />');
  // <div><br><div>conteúdo</div></div> → <br />conteúdo
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<div><br\s*\/?>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi, '<br />$1');
  } while (result !== prev);
  // Corrige texto solto após </p> (ex: </p>e editado! :)</p> → </p><p>e editado! :)</p>)
  result = result.replace(/<\/p>\s*([^<]+?)\s*<\/p>/g, '</p><p>$1</p>');
  return result;
}

const headingStyles = {
  '& h1': { fontSize: '1.75em', fontWeight: 'bold', margin: '0.25em 0', lineHeight: 1.2 },
  '& h2': { fontSize: '1.35em', fontWeight: 'bold', margin: '0.25em 0', lineHeight: 1.3 },
  '& h3': { fontSize: '1.15em', fontWeight: 'bold', margin: '0.2em 0', lineHeight: 1.3 },
  '& p': { fontSize: 'inherit', margin: '0.5em 0', lineHeight: 1.6, minHeight: '1em' },
  '& p + p': { marginTop: '0.6em' },
  '& br': { display: 'block', marginTop: '0.5em', marginBottom: '0.25em', lineHeight: 1.6 },
};

const contentEditableBoxStyles = {
  minH: '32px',
  p: 2,
  fontSize: '0.875rem',
  fontFamily: '"Open Sans", "Segoe UI", sans-serif',
  border: '1px solid',
  borderColor: 'gray.600',
  borderRadius: '3px',
  bg: '#262626',
  color: '#e2e2e2',
  outline: 'none',
  '& *': { maxWidth: '100%' },
  ...headingStyles,
};

const compactEditableStyles = {
  minH: '2rem',
  p: 1,
  pt: '0.25rem',
  fontSize: '1rem',
  fontFamily: '"Open Sans", "Segoe UI", sans-serif',
  border: '1px solid',
  borderColor: 'gray.600',
  borderRadius: '3px',
  bg: '#262626',
  color: '#e2e2e2',
  outline: 'none',
  '& *': { maxWidth: '100%' },
  ...headingStyles,
};

export default function EventCustomFieldHTML(props: EventCustomFieldHTMLProps) {
  const { className, field, label, initialValue, style: givenStyles, submitHandler, compact = false } = props;
  const ref = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const submitCallback = useCallback(
    (newValue: string) => {
      submitHandler(field, newValue);
      setIsEditing(false);
    },
    [field, submitHandler],
  );

  const { value, onChange, onBlur, onKeyDown } = useReactiveTextInput(initialValue, submitCallback, ref, {
    submitOnCtrlEnter: true,
  });

  const containsHTML = isHTML(value);

  // Quando entra em modo edição HTML, inicializa o contentEditable e foca
  useEffect(() => {
    if (isEditing && containsHTML && editRef.current) {
      editRef.current.innerHTML = normalizeHtml(value);
      editRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só definir ao entrar em modo edição
  }, [isEditing]);

  const handleContentEditableBlur = useCallback(
    (e?: React.FocusEvent) => {
      if (!editRef.current) return;
      // Não sair do modo edição se o foco foi para a toolbar
      if (e?.relatedTarget && toolbarRef.current?.contains(e.relatedTarget as Node)) return;
      const html = normalizeHtml(editRef.current.innerHTML);
      if (html !== value) {
        submitHandler(field, html);
      }
      setIsEditing(false);
    },
    [field, submitHandler, value],
  );

  const handleContentEditableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editRef.current) editRef.current.innerHTML = value;
        setIsEditing(false);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleContentEditableBlur();
      }
    },
    [value, handleContentEditableBlur],
  );

  const toolbarBtnStyle = {
    bg: '#1a1a1a',
    color: '#e2e2e2',
    _hover: { bg: '#2d2d2d' },
  };

  const execFormat = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editRef.current?.focus();
  }, []);

  // Texto sem HTML: sempre usa textarea
  if (!containsHTML) {
    return (
      <div>
        {!compact && (
          <Editor.Label className={className} htmlFor={field} style={givenStyles}>
            {label}
          </Editor.Label>
        )}
        <AutoTextArea
          id={field}
          inputref={ref}
          rows={1}
          size='sm'
          resize='none'
          variant={compact ? 'ontime-transparent' : 'ontime-filled'}
          style={compact ? { minHeight: '2rem', padding: 0, paddingTop: '0.25rem', fontSize: '1rem' } : undefined}
          transition={compact ? 'none' : undefined}
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

  // HTML + modo edição: contentEditable WYSIWYG com toolbar
  if (isEditing) {
    return (
      <div>
        {!compact && (
          <Editor.Label className={className} htmlFor={field} style={givenStyles}>
            {label}
          </Editor.Label>
        )}
        <Box ref={toolbarRef}>
          <ButtonGroup
            size='xs'
            spacing={0.5}
            mb={1}
            flexWrap='wrap'
          >
          <Tooltip label='Negrito' placement='top'>
            <Button size='xs' aria-label='Negrito' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('bold'); }} onMouseDown={(e) => e.preventDefault()} fontWeight='bold'>
              B
            </Button>
          </Tooltip>
          <Tooltip label='Itálico' placement='top'>
            <Button size='xs' aria-label='Itálico' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('italic'); }} onMouseDown={(e) => e.preventDefault()} fontStyle='italic'>
              I
            </Button>
          </Tooltip>
          <Tooltip label='Sublinhado' placement='top'>
            <Button size='xs' aria-label='Sublinhado' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('underline'); }} onMouseDown={(e) => e.preventDefault()} textDecoration='underline'>
              U
            </Button>
          </Tooltip>
          <Tooltip label='Riscado' placement='top'>
            <Button size='xs' aria-label='Riscado' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('strikeThrough'); }} onMouseDown={(e) => e.preventDefault()} textDecoration='line-through'>
              S
            </Button>
          </Tooltip>
          <Tooltip label='Título (H1)' placement='top'>
            <Button size='xs' aria-label='Título' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('formatBlock', 'h1'); }} onMouseDown={(e) => e.preventDefault()} fontSize='lg'>
              H1
            </Button>
          </Tooltip>
          <Tooltip label='Subtítulo (H2)' placement='top'>
            <Button size='xs' aria-label='Subtítulo' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('formatBlock', 'h2'); }} onMouseDown={(e) => e.preventDefault()} fontSize='md'>
              H2
            </Button>
          </Tooltip>
          <Tooltip label='Corpo (parágrafo)' placement='top'>
            <Button size='xs' aria-label='Corpo' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('formatBlock', 'p'); }} onMouseDown={(e) => e.preventDefault()}>
              P
            </Button>
          </Tooltip>
          <Tooltip label='Lista com marcadores' placement='top'>
            <Button size='xs' aria-label='Lista' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('insertUnorderedList'); }} onMouseDown={(e) => e.preventDefault()}>
              •
            </Button>
          </Tooltip>
          <Tooltip label='Lista numerada' placement='top'>
            <Button size='xs' aria-label='Lista numerada' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('insertOrderedList'); }} onMouseDown={(e) => e.preventDefault()}>
              1.
            </Button>
          </Tooltip>
          <Tooltip label='Alinhar à esquerda' placement='top'>
            <Button size='xs' aria-label='Esquerda' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('justifyLeft'); }} onMouseDown={(e) => e.preventDefault()}>
              L
            </Button>
          </Tooltip>
          <Tooltip label='Centralizar' placement='top'>
            <Button size='xs' aria-label='Centro' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('justifyCenter'); }} onMouseDown={(e) => e.preventDefault()}>
              C
            </Button>
          </Tooltip>
          <Tooltip label='Alinhar à direita' placement='top'>
            <Button size='xs' aria-label='Direita' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('justifyRight'); }} onMouseDown={(e) => e.preventDefault()}>
              R
            </Button>
          </Tooltip>
          <Tooltip label='Limpar formatação' placement='top'>
            <Button size='xs' aria-label='Limpar' {...toolbarBtnStyle} onClick={(e) => { e.preventDefault(); execFormat('removeFormat'); }} onMouseDown={(e) => e.preventDefault()}>
              ✕
            </Button>
          </Tooltip>
          {[
            { hex: '#d30000', name: 'Vermelho' },
            { hex: '#0066cc', name: 'Azul' },
            { hex: '#068f06', name: 'Verde' },
            { hex: '#ffcc00', name: 'Amarelo' },
            { hex: '#9933ff', name: 'Roxo' },
            { hex: '#ff6600', name: 'Laranja' },
          ].map(({ hex, name }) => (
            <Tooltip key={hex} label={name} placement='top'>
              <Button
                size='xs'
                variant='unstyled'
                aria-label={name}
                onClick={(e) => {
                  e.preventDefault();
                  execFormat('foreColor', hex);
                }}
                onMouseDown={(e) => e.preventDefault()}
                bg={hex}
                _hover={{ opacity: 0.9 }}
                sx={{ minW: 6, h: 6, border: '1px solid', borderColor: 'gray.500', borderRadius: '2px' }}
              />
            </Tooltip>
          ))}
          </ButtonGroup>
        </Box>
        <Box
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => handleContentEditableBlur(e)}
          onKeyDown={handleContentEditableKeyDown}
          title='Ctrl+Enter para salvar, Esc para cancelar'
          sx={compact ? compactEditableStyles : contentEditableBoxStyles}
        />
      </div>
    );
  }

  // HTML + modo preview: clicável para editar
  return (
    <div>
      {!compact && (
        <Editor.Label className={className} htmlFor={field} style={givenStyles}>
          {label}
        </Editor.Label>
      )}
      <Box
        position='relative'
        minH={compact ? '2rem' : '32px'}
        p={compact ? 1 : 2}
        pt={compact ? '0.25rem' : undefined}
        fontSize={compact ? '1rem' : '0.875rem'}
        fontFamily='"Open Sans", "Segoe UI", sans-serif'
        border='1px solid'
        borderColor='transparent'
        borderRadius='3px'
        bg='#262626'
        color='#e2e2e2'
        cursor='pointer'
        onClick={() => setIsEditing(true)}
        title='Clique para editar'
        dangerouslySetInnerHTML={{ __html: containsHTML ? normalizeHtml(value) : nl2br(value) }}
        sx={{
          '& *': {
            maxWidth: '100%',
          },
          ...headingStyles,
          '&:hover': {
            bg: '#2d2d2d',
          },
          ...(!compact && {
            '&::after': {
              content: '"📝 HTML"',
              position: 'absolute',
              top: '4px',
              right: '8px',
              fontSize: '10px',
              color: '#9d9d9d',
              pointerEvents: 'none',
            },
          }),
        }}
      />
    </div>
  );
}
