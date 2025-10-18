import { useMemo, useState } from 'react';
import { IoDownloadOutline, IoEyeOutline, IoTrashBin } from 'react-icons/io5';
import {
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
  useDisclosure,
  VStack,
} from '@chakra-ui/react';

import { deleteAllReport } from '../../../../common/api/report';
import { createBlob, downloadBlob } from '../../../../common/api/utils';
import useReport from '../../../../common/hooks-query/useReport';
import useRundown from '../../../../common/hooks-query/useRundown';
import { cx } from '../../../../common/utils/styleUtils';
import { formatTime } from '../../../../common/utils/time';
import * as Panel from '../../panel-utils/PanelUtils';

import {
  CombinedReport,
  getCombinedReport,
  makeReportCSV,
  ReportColumnKey,
  reportColumns,
} from './reportSettings.utils';

import style from './ReportSettings.module.scss';

const DEFAULT_SELECTED_COLUMNS: ReportColumnKey[] = reportColumns.map((column) => column.key);

export default function ReportSettings() {
  const { data: reportData } = useReport();
  const { data } = useRundown();
  const previewModal = useDisclosure();

  const [selectedColumns, setSelectedColumns] = useState<ReportColumnKey[]>(DEFAULT_SELECTED_COLUMNS);

  const clearReport = async () => await deleteAllReport();
  const handleDownload = (combinedReport: CombinedReport[]) => {
    if (!combinedReport) {
      return;
    }
    const csv = makeReportCSV(combinedReport, selectedColumns);
    const blob = createBlob(csv, 'text/csv;charset=utf-8;');
    downloadBlob(blob, 'ontime-report.csv');
  };

  const combinedReport = useMemo(() => {
    return getCombinedReport(reportData, data.rundown, data.order);
  }, [reportData, data.rundown, data.order]);

  const handleColumnToggle = (column: ReportColumnKey, checked: boolean) => {
    setSelectedColumns((prev) => {
      if (checked) {
        return [...prev, column];
      }
      return prev.filter((key) => key !== column);
    });
  };

  const selectedColumnsConfig = reportColumns.filter((column) => selectedColumns.includes(column.key));
  const previewRows = combinedReport.slice(0, 5);

  return (
    <Panel.Section>
      <Panel.Card>
        <Panel.SubHeader>Report</Panel.SubHeader>
        <Panel.Divider />
        <Panel.Section>
          <Panel.Title>
            Manage report
            <Panel.InlineElements>
              <Button
                variant='ontime-subtle'
                leftIcon={<IoEyeOutline />}
                size='sm'
                onClick={previewModal.onOpen}
                isDisabled={combinedReport.length === 0}
              >
                Preview / Select Columns
              </Button>
              <Button
                variant='ontime-subtle'
                leftIcon={<IoDownloadOutline />}
                size='sm'
                onClick={() => handleDownload(combinedReport)}
                isDisabled={combinedReport.length === 0 || selectedColumns.length === 0}
              >
                Export CSV
              </Button>
              <Button
                variant='ontime-subtle'
                leftIcon={<IoTrashBin />}
                size='sm'
                color='#FA5656'
                onClick={clearReport}
                isDisabled={combinedReport.length === 0}
              >
                Clear All
              </Button>
            </Panel.InlineElements>
          </Panel.Title>
        </Panel.Section>
        <Panel.Section>
          <Panel.Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cue</th>
                <th>Title</th>
                <th>Scheduled Start</th>
                <th>Actual Start</th>
                <th>Scheduled End</th>
                <th>Actual End</th>
              </tr>
            </thead>
            <tbody>
              {combinedReport.length === 0 && (
                <Panel.TableEmpty label='Reports are generated when running through the show.' />
              )}

              {combinedReport.map((entry) => {
                const start = (() => {
                  if (entry.actualStart === null) return null;
                  if (entry.actualStart <= entry.scheduledStart) return 'under';
                  return 'over';
                })();
                const end = (() => {
                  if (entry.actualEnd === null) return null;
                  if (entry.actualEnd <= entry.scheduledEnd) return 'under';
                  return 'over';
                })();
                return (
                  <tr key={entry.index}>
                    <th>{entry.index}</th>
                    <th>{entry.cue}</th>
                    <th>{entry.title}</th>
                    <th className={cx([start && style[start]])}>{formatTime(entry.scheduledStart)}</th>
                    <th className={cx([start && style[start]])}>{formatTime(entry.actualStart)}</th>
                    <th className={cx([end && style[end]])}>{formatTime(entry.scheduledEnd)}</th>
                    <th className={cx([end && style[end]])}>{formatTime(entry.actualEnd)}</th>
                  </tr>
                );
              })}
            </tbody>
          </Panel.Table>
        </Panel.Section>
      </Panel.Card>

      <Modal isOpen={previewModal.isOpen} onClose={previewModal.onClose} size='6xl' isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>CSV Export Preview</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align='stretch' spacing={6}>
              <FormControl>
                <FormLabel fontWeight='semibold'>Select columns to include</FormLabel>
                <SimpleGrid columns={[1, 2, 3]} spacingY={2} spacingX={6}>
                  {reportColumns.map((column) => (
                    <Checkbox
                      key={column.key}
                      isChecked={selectedColumns.includes(column.key)}
                      onChange={(event) => handleColumnToggle(column.key, event.target.checked)}
                    >
                      {column.label}
                    </Checkbox>
                  ))}
                </SimpleGrid>
                {selectedColumns.length === 0 && (
                  <Text mt={2} fontSize='sm' color='orange.400'>
                    At least one column must be selected
                  </Text>
                )}
              </FormControl>

              <VStack align='stretch' spacing={3}>
                <HStack justify='space-between'>
                  <Text fontWeight='semibold'>
                    Preview ({previewRows.length} of {combinedReport.length} rows)
                  </Text>
                  <Text fontSize='sm' color='gray.500'>
                    Delimiter: ; (semicolon)
                  </Text>
                </HStack>

                <Table size='sm' variant='striped'>
                  <Thead>
                    <Tr>
                      {selectedColumnsConfig.map((column) => (
                        <Th key={column.key}>{column.label}</Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {previewRows.length === 0 && (
                      <Tr>
                        <Td colSpan={selectedColumnsConfig.length} textAlign='center'>
                          No data available for preview
                        </Td>
                      </Tr>
                    )}
                    {previewRows.map((row) => (
                      <Tr key={row.index}>
                        {selectedColumnsConfig.map((column) => {
                          const value = (() => {
                            switch (column.key) {
                              case 'index':
                                return row.index;
                              case 'title':
                                return row.title;
                              case 'cue':
                                return row.cue;
                              case 'scheduledStart':
                                return formatTime(row.scheduledStart);
                              case 'actualStart':
                                return formatTime(row.actualStart);
                              case 'scheduledEnd':
                                return formatTime(row.scheduledEnd);
                              case 'actualEnd':
                                return formatTime(row.actualEnd);
                              default:
                                return '';
                            }
                          })();

                          return <Td key={column.key}>{value}</Td>;
                        })}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </VStack>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <HStack spacing={4}>
              <Button
                variant='ontime-subtle'
                leftIcon={<IoDownloadOutline />}
                size='sm'
                onClick={() => handleDownload(combinedReport)}
                isDisabled={combinedReport.length === 0 || selectedColumns.length === 0}
              >
                Export CSV
              </Button>
              <Button variant='ghost' onClick={previewModal.onClose}>
                Close
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Panel.Section>
  );
}
