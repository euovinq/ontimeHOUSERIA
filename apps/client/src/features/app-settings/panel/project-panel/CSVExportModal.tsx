import { useCallback, useEffect, useState } from 'react';
import { IoDownloadOutline } from 'react-icons/io5';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';

import { getDb } from '../../../../common/api/db';
import { makeCSVFromArrayOfArrays } from '../../../../common/utils/csv';
import { makeTable } from '../../../../views/cuesheet/cuesheet.utils';

interface CSVExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filename: string;
}

export default function CSVExportModal({ isOpen, onClose, filename }: CSVExportModalProps) {
  const [tableData, setTableData] = useState<string[][]>([]);
  const [selectedColumns, setSelectedColumns] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjectData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getDb(filename);
      const { project, rundown, customFields } = response.data;
      const table = makeTable(project, rundown, customFields);

      // Filtrar apenas os dados do rundown (pular metadados)
      // makeTable retorna: [metadata], [project info], [headers], [data rows...]
      const headerRowIndex = table.findIndex(row => row.includes('Time Start'));
      const rundownData = headerRowIndex >= 0 ? table.slice(headerRowIndex) : table;

      setTableData(rundownData);
      
      // Colunas que devem vir desativadas por padrão
      const disabledByDefault = ['ID', 'Colour', 'Cue', 'Note', 'Is Public? (x)', 'Skip?', 'Type'];
      
      // Selecionar apenas as colunas que NÃO estão na lista de desabilitadas
      const defaultSelected = rundownData[0]?.map((column, index) => {
        const isDisabled = disabledByDefault.some(disabledCol => 
          column.toLowerCase().includes(disabledCol.toLowerCase()) ||
          disabledCol.toLowerCase().includes(column.toLowerCase())
        );
        return isDisabled ? null : index;
      }).filter(index => index !== null) ?? [];
      
      setSelectedColumns(defaultSelected);
    } catch (err) {
      console.error('❌ Erro ao carregar dados:', err);
      setError('Erro ao carregar dados do projeto');
    } finally {
      setLoading(false);
    }
  }, [filename]);

  useEffect(() => {
    if (isOpen && filename) {
      loadProjectData();
    }
  }, [isOpen, filename, loadProjectData]);

  const handleColumnToggle = (columnIndex: number, isChecked: boolean) => {
    setSelectedColumns((prev) => {
      if (isChecked) {
        // Adicionar mantendo a ordem original das colunas
        const newSelection = [...prev, columnIndex];
        return newSelection.sort((a, b) => a - b);
      }
      return prev.filter((index) => index !== columnIndex);
    });
  };

  const handleDownload = () => {
    if (selectedColumns.length === 0) return;

    const filteredData = tableData.map((row) => selectedColumns.map((columnIndex) => row[columnIndex]));

    const csv = makeCSVFromArrayOfArrays(filteredData, ';');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const fileName = filename.endsWith('.csv') ? filename : `${filename}.csv`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);

    onClose();
  };

  const headerRow = tableData[0] ?? [];
  const previewRows = tableData.slice(1, 6);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size='6xl' isCentered>
      <ModalOverlay bg='blackAlpha.600' />
      <ModalContent bg='#1a1a1a' color='white'>
        <ModalHeader>
          Export CSV Rundown
          <Text fontSize='sm' color='gray.500' mt={2}>
            Projeto: {filename}
          </Text>
          <Text fontSize='xs' color='gray.400' mt={1}>
            Visualize e selecione as colunas do rundown para exportar em formato Excel
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {loading && (
            <Text textAlign='center' py={8}>
              Carregando dados do projeto...
            </Text>
          )}

          {error && (
            <Text color='red.500' textAlign='center' py={8}>
              {error}
            </Text>
          )}

          {!loading && !error && tableData.length > 0 && (
            <VStack align='stretch' spacing={6}>
              <FormControl>
                <FormLabel fontWeight='semibold'>
                  Selecione as colunas do rundown para incluir na exportação ({headerRow.length} colunas disponíveis):
                </FormLabel>
                <SimpleGrid columns={[1, 2, 3]} spacingY={2} spacingX={6}>
                  {headerRow.map((column, index) => {
                    const isDisabledByDefault = ['ID', 'Colour', 'Cue', 'Note', 'Is Public? (x)', 'Skip?', 'Type'].some(disabledCol => 
                      column.toLowerCase().includes(disabledCol.toLowerCase()) ||
                      disabledCol.toLowerCase().includes(column.toLowerCase())
                    );
                    
                    return (
                      <Checkbox
                        key={`${column}-${index}`}
                        isChecked={selectedColumns.includes(index)}
                        onChange={(event) => handleColumnToggle(index, event.target.checked)}
                        colorScheme={isDisabledByDefault ? 'orange' : 'blue'}
                      >
                        {column || `Coluna ${index + 1}`}
                        {isDisabledByDefault && <Text as="span" fontSize="xs" color="orange.400" ml={1}>(desabilitada por padrão)</Text>}
                      </Checkbox>
                    );
                  })}
                </SimpleGrid>
                {selectedColumns.length === 0 && (
                  <Text mt={2} fontSize='sm' color='orange.400'>
                    Pelo menos uma coluna deve ser selecionada
                  </Text>
                )}
                <Text mt={2} fontSize='sm' color='gray.500'>
                  {selectedColumns.length} de {headerRow.length} colunas selecionadas
                </Text>
              </FormControl>

              <VStack align='stretch' spacing={3}>
                <HStack justify='space-between'>
                  <Text fontWeight='semibold'>
                    Prévia do Rundown (primeiras 5 linhas de {tableData.length - 1} eventos)
                  </Text>
                  <Text fontSize='sm' color='gray.500'>
                    Delimitador: ; (ponto e vírgula) - ✅ Compatível com Excel BR
                  </Text>
                </HStack>

                <Box overflowX='auto' maxW='100%'>
                  <Table size='sm' variant='simple' bg='#2d3748' minW='800px'>
                  <Thead>
                    <Tr bg='#4a5568'>
                      {selectedColumns.map((columnIndex) => (
                        <Th key={`header-${columnIndex}`} color='white' borderColor='#718096'>
                          {headerRow[columnIndex]}
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {previewRows.length === 0 && (
                      <Tr>
                        <Td colSpan={selectedColumns.length || 1} textAlign='center' color='gray.400'>
                          Nenhum dado disponível para prévia
                        </Td>
                      </Tr>
                    )}
                    {previewRows.map((row, rowIndex) => (
                      <Tr key={`row-${rowIndex}`} _hover={{ bg: '#4a5568' }}>
                        {selectedColumns.map((columnIndex) => (
                          <Td 
                            key={`row-${rowIndex}-col-${columnIndex}`} 
                            color='white' 
                            borderColor='#718096'
                          >
                            {row[columnIndex]}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </Tbody>
                  </Table>
                </Box>
              </VStack>
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack spacing={4}>
            <Button
              variant='ontime-subtle'
              leftIcon={<IoDownloadOutline />}
              size='sm'
              onClick={handleDownload}
              isDisabled={selectedColumns.length === 0 || loading}
              bg='#2d3748'
              color='white'
              _hover={{ bg: '#4a5568' }}
            >
              Baixar CSV
            </Button>
            <Button 
              variant='ghost' 
              onClick={onClose}
              color='white'
              _hover={{ bg: '#4a5568' }}
            >
              Fechar
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
