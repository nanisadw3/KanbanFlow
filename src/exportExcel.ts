import type { Activity, User, Team } from './db';
import type { ExportData, ExportTaskRow } from './export';
import { buildExportData } from './export';

// Builds the .xlsx (exceljs is loaded on demand, so it never weighs on the initial page load)
// and hands it to the browser as a download.

const BLUE = 'FF2F4EC4';
const WHITE = 'FFFFFFFF';
const STATUS_COLOR: Record<string, string> = {
  'Por hacer': 'FF9A4306',
  'En curso': 'FF2F4EC4',
  'Hecha': 'FF11692F',
  'Cancelada': 'FF555B66',
};
const RED = 'FFB0211A';
const DATE_FMT = 'dd/mm/yyyy';
const DATETIME_FMT = 'dd/mm/yyyy hh:mm';

// Excel dates carry no time zone. Calendar days become UTC midnight; timestamps are written as
// the local wall-clock time so the sheet shows what the user saw in the app.
const ymdToDate = (ymd: string): Date | null => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const isoToLocalWallClock = (iso: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
};

type ExcelNS = typeof import('exceljs');
type Sheet = import('exceljs').Worksheet;

const loadExcel = async (): Promise<ExcelNS> => {
  const mod = (await import('exceljs')) as unknown as { default?: ExcelNS } & ExcelNS;
  return mod.default ?? mod;
};

function styleHeader(ws: Sheet, columns: number) {
  const header = ws.getRow(1);
  header.height = 24;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
}

function addTaskSheet(wb: InstanceType<ExcelNS['Workbook']>, name: string, rows: ExportTaskRow[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: 'Usuario', key: 'userName', width: 28 },
    { header: 'Correo', key: 'email', width: 32 },
    { header: 'Tarea', key: 'title', width: 44 },
    { header: 'Descripción', key: 'description', width: 52 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Prioridad', key: 'priority', width: 11 },
    { header: 'Avance (%)', key: 'progress', width: 12 },
    { header: 'Inicio', key: 'start', width: 12 },
    { header: 'Fin', key: 'end', width: 12 },
    { header: 'Retrasada', key: 'overdue', width: 11 },
    { header: 'Días de retraso', key: 'overdueDays', width: 15 },
    { header: 'Asignada por', key: 'assignedBy', width: 18 },
    { header: 'Ámbito', key: 'scope', width: 16 },
    { header: 'Creada', key: 'createdAt', width: 17 },
    { header: 'Completada', key: 'completedAt', width: 17 },
  ];
  for (const r of rows) {
    const row = ws.addRow({
      ...r,
      progress: r.progress,
      start: ymdToDate(r.start),
      end: ymdToDate(r.end),
      overdue: r.overdue ? 'Sí' : 'No',
      createdAt: isoToLocalWallClock(r.createdAt),
      completedAt: isoToLocalWallClock(r.completedAt),
    });
    row.getCell('start').numFmt = DATE_FMT;
    row.getCell('end').numFmt = DATE_FMT;
    row.getCell('createdAt').numFmt = DATETIME_FMT;
    row.getCell('completedAt').numFmt = DATETIME_FMT;
    row.getCell('description').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('title').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('status').font = { bold: true, color: { argb: STATUS_COLOR[r.status] ?? 'FF000000' } };
    if (r.overdue) {
      row.getCell('overdue').font = { bold: true, color: { argb: RED } };
      row.getCell('overdueDays').font = { bold: true, color: { argb: RED } };
    }
  }
  styleHeader(ws, 15);
  return ws;
}

export async function buildWorkbookBuffer(data: ExportData): Promise<Uint8Array> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KanbanFlow';
  wb.created = new Date();

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Usuario', key: 'userName', width: 30 },
    { header: 'Correo', key: 'email', width: 34 },
    { header: 'Por hacer', key: 'todo', width: 11 },
    { header: 'En curso', key: 'doing', width: 11 },
    { header: 'Hechas', key: 'done', width: 11 },
    { header: 'Canceladas', key: 'cancelled', width: 12 },
    { header: 'Total', key: 'total', width: 9 },
    { header: 'Retrasadas', key: 'overdue', width: 12 },
    { header: '% completado', key: 'rate', width: 14 },
  ];
  for (const s of data.summary) {
    const row = resumen.addRow(s);
    row.getCell('rate').numFmt = '0"%"';
    if (s.overdue > 0) row.getCell('overdue').font = { bold: true, color: { argb: RED } };
  }
  styleHeader(resumen, 9);

  addTaskSheet(wb, 'Todas', data.tasks);
  for (const u of data.byUser) addTaskSheet(wb, u.sheetName, u.rows);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function exportTasksToExcel(data: ExportData, today: string): Promise<void> {
  const bytes = await buildWorkbookBuffer(data);
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `KanbanFlow_tareas_${today}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// One call for both screens: builds the data, downloads the file and reports what happened.
export async function exportAllTasks(input: { activities: Activity[]; users: User[]; teams: Team[]; today: string }):
  Promise<{ ok: boolean; tasks: number; people: number; message: string }> {
  const data = buildExportData(input);
  if (data.tasks.length === 0) {
    return { ok: false, tasks: 0, people: 0, message: 'No hay tareas sin archivar para exportar.' };
  }
  try {
    await exportTasksToExcel(data, input.today);
    return {
      ok: true,
      tasks: data.tasks.length,
      people: data.byUser.length,
      message: `Excel exportado: ${data.tasks.length} ${data.tasks.length === 1 ? 'tarea' : 'tareas'} de ${data.byUser.length} ${data.byUser.length === 1 ? 'persona' : 'personas'}.`,
    };
  } catch (err) {
    console.error('[Export] No se pudo generar el Excel:', err);
    return { ok: false, tasks: 0, people: 0, message: 'No se pudo generar el archivo de Excel. Intenta de nuevo.' };
  }
}
