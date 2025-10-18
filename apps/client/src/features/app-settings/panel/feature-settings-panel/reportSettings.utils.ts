import { isOntimeEvent, MaybeNumber, NormalisedRundown, OntimeReport } from 'houseriaapp-types';

import { makeCSVFromArrayOfArrays } from '../../../../common/utils/csv';
import { formatTime } from '../../../../common/utils/time';

export type CombinedReport = {
  index: number;
  title: string;
  cue: string;
  scheduledStart: number;
  actualStart: MaybeNumber;
  scheduledEnd: number;
  actualEnd: MaybeNumber;
};

/**
 * Creates a combined report with the rundown data
 */
export function getCombinedReport(report: OntimeReport, rundown: NormalisedRundown, order: string[]): CombinedReport[] {
  if (Object.keys(report).length === 0) return [];
  if (order.length === 0) return [];

  const combinedReport: CombinedReport[] = [];

  for (const [key, value] of Object.entries(report)) {
    if (!rundown[key] || !isOntimeEvent(rundown[key])) continue;

    combinedReport.push({
      index: order.findIndex((id) => id === key),
      title: rundown[key].title,
      cue: rundown[key].cue,
      scheduledStart: rundown[key].timeStart,
      actualEnd: value.endedAt,
      scheduledEnd: rundown[key].timeEnd,
      actualStart: value.startedAt,
    });
  }

  return combinedReport;
}

export type ReportColumnKey =
  | 'index'
  | 'title'
  | 'cue'
  | 'scheduledStart'
  | 'actualStart'
  | 'scheduledEnd'
  | 'actualEnd';

type ReportColumnConfig = {
  key: ReportColumnKey;
  label: string;
};

export const reportColumns: ReportColumnConfig[] = [
  { key: 'index', label: 'Index' },
  { key: 'title', label: 'Title' },
  { key: 'cue', label: 'Cue' },
  { key: 'scheduledStart', label: 'Scheduled Start' },
  { key: 'actualStart', label: 'Actual Start' },
  { key: 'scheduledEnd', label: 'Scheduled End' },
  { key: 'actualEnd', label: 'Actual End' },
];

/**
 * Transforms a CombinedReport into a CSV string using selected columns and semicolon delimiter
 */
export function makeReportCSV(combinedReport: CombinedReport[], selectedColumns: ReportColumnKey[]) {
  const columns = reportColumns.filter((column) => selectedColumns.includes(column.key));

  const csv: string[][] = [];
  csv.push(columns.map((col) => col.label));

  for (const entry of combinedReport) {
    csv.push(
      columns.map((column) => {
        switch (column.key) {
          case 'index':
            return String(entry.index);
          case 'title':
            return entry.title;
          case 'cue':
            return entry.cue;
          case 'scheduledStart':
            return formatTime(entry.scheduledStart);
          case 'actualStart':
            return formatTime(entry.actualStart);
          case 'scheduledEnd':
            return formatTime(entry.scheduledEnd);
          case 'actualEnd':
            return formatTime(entry.actualEnd);
          default:
            return '';
        }
      })
    );
  }

  return makeCSVFromArrayOfArrays(csv, ';');
}
