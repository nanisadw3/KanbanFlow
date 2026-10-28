import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
// Same convention as dates.test.ts: src/ has no Node types, so the test lives here.
import { buildExportData, safeSheetName } from '../src/export.ts';
import { buildWorkbookBuffer } from '../src/exportExcel.ts';

const today = '2026-10-16';
const users: any[] = [
  { username: 'Ana', fullName: 'Ana Pérez', role: 'user', email: 'ana@x.com', lastLogin: 'x' },
  { username: 'Beto', fullName: 'Beto Ruiz', role: 'user', email: null, lastLogin: 'x' },
  { username: 'Cris', fullName: 'Cris: "Dir/Ops" [norte]?*', role: 'user', email: 'c@x.com', lastLogin: 'x' },
];
const teams: any[] = [{ id: 't1', name: 'SEOSG', memberUsernames: ['Ana'], createdAt: 'x' }];
let n = 0;
const task = (o: Record<string, unknown>): any => ({
  id: `a${++n}`, title: 'T', description: '', startDate: '2026-10-01', endDate: '2026-10-30', status: 'todo',
  username: 'Ana', createdAt: '2026-10-01T10:00:00.000Z', priority: 'media', archived: false, ...o,
});

test('exporta las tareas NO archivadas (de cualquier estado) y omite las archivadas', () => {
  const acts = [
    task({ title: 'Abierta', status: 'todo' }),
    task({ title: 'Hecha', status: 'done', completedAt: '2026-10-05T10:00:00.000Z' }),
    task({ title: 'Cancelada', status: 'cancelled' }),
    task({ title: 'Archivada abierta', status: 'doing', archived: true }),
    task({ title: 'Archivada hecha', status: 'done', archived: true }),
  ];
  const d = buildExportData({ activities: acts, users, teams, today });
  assert.deepEqual(d.tasks.map(r => r.title).sort(), ['Abierta', 'Cancelada', 'Hecha']);
});

test('agrupa por usuario, ordena por estado y luego por fecha de fin, y rotula en español', () => {
  const acts = [
    task({ title: 'Hecha', status: 'done', endDate: '2026-10-01', completedAt: '2026-10-02T10:00:00.000Z' }),
    task({ title: 'En curso', status: 'doing', endDate: '2026-11-01', progress: 40 }),
    task({ title: 'Por hacer B', status: 'todo', endDate: '2026-12-01' }),
    task({ title: 'Por hacer A', status: 'todo', endDate: '2026-11-15', priority: 'alta' }),
    task({ title: 'De Beto', username: 'Beto' }),
  ];
  const d = buildExportData({ activities: acts, users, teams, today });
  const ana = d.byUser.find(u => u.username === 'Ana')!;
  assert.deepEqual(ana.rows.map(r => r.title), ['Por hacer A', 'Por hacer B', 'En curso', 'Hecha']);
  assert.deepEqual(ana.rows.map(r => r.status), ['Por hacer', 'Por hacer', 'En curso', 'Hecha']);
  assert.equal(ana.rows[0].priority, 'Alta');
  assert.equal(ana.rows[2].progress, 40);
  assert.equal(d.byUser.find(u => u.username === 'Beto')!.rows.length, 1);
  assert.equal(d.byUser.find(u => u.username === 'Cris'), undefined); // sin tareas: sin hoja propia
});

test('marca retrasadas con sus días y rotula equipo o personal', () => {
  const acts = [
    task({ title: 'Vencida', status: 'doing', endDate: '2026-10-10', teamId: 't1' }),
    task({ title: 'A tiempo', status: 'todo', endDate: '2026-10-20' }),
    task({ title: 'Hecha vencida', status: 'done', endDate: '2026-10-01', completedAt: '2026-10-05T10:00:00.000Z' }),
  ];
  const rows = buildExportData({ activities: acts, users, teams, today }).tasks;
  const v = rows.find(r => r.title === 'Vencida')!;
  assert.deepEqual([v.overdue, v.overdueDays, v.scope], [true, 6, 'SEOSG']);
  const ok = rows.find(r => r.title === 'A tiempo')!;
  assert.deepEqual([ok.overdue, ok.overdueDays, ok.scope], [false, 0, 'Personal']);
  assert.equal(rows.find(r => r.title === 'Hecha vencida')!.overdue, false);
});

test('el resumen incluye a todos los usuarios, también sin tareas, con totales y % completado', () => {
  const acts = [
    task({ status: 'done', completedAt: '2026-10-05T10:00:00.000Z' }),
    task({ status: 'done', completedAt: '2026-10-05T10:00:00.000Z' }),
    task({ status: 'doing', endDate: '2026-10-01' }),
    task({ status: 'todo' }),
  ];
  const s = buildExportData({ activities: acts, users, teams, today }).summary;
  assert.deepEqual(s.map(r => r.username), ['Ana', 'Beto', 'Cris']);
  assert.deepEqual(
    [s[0].todo, s[0].doing, s[0].done, s[0].cancelled, s[0].total, s[0].overdue, s[0].rate],
    [1, 1, 2, 0, 4, 1, 50]
  );
  assert.deepEqual([s[1].total, s[1].rate, s[1].email], [0, 0, '']);
});

test('safeSheetName quita caracteres prohibidos, recorta a 31 y evita repetidos', () => {
  const used = new Set<string>();
  assert.equal(safeSheetName('Cris: "Dir/Ops" [norte]?*', used), 'Cris "DirOps" norte');
  assert.equal(safeSheetName('A'.repeat(40), used), 'A'.repeat(31));
  assert.equal(safeSheetName('A'.repeat(40), used), 'A'.repeat(27) + ' (2)');
  assert.equal(safeSheetName('   ', used), 'Hoja');
  assert.equal(safeSheetName('Resumen', used, ['Resumen']), 'Resumen (2)'); // no choca con hojas reservadas
});

test('el .xlsx tiene hojas Resumen, Todas y una por usuario, fechas reales y encabezado fijo', async () => {
  const acts = [
    task({ title: 'Uno', status: 'doing', endDate: '2026-10-10', progress: 50, description: 'detalle', assignedBy: 'Roberto', teamId: 't1' }),
    task({ title: 'Dos', status: 'done', completedAt: '2026-10-05T10:00:00.000Z' }),
    task({ title: 'De Beto', username: 'Beto' }),
  ];
  const buf = await buildWorkbookBuffer(buildExportData({ activities: acts, users, teams, today }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumen', 'Todas', 'Ana Pérez', 'Beto Ruiz']);
  const todas = wb.getWorksheet('Todas')!;
  assert.equal(todas.rowCount, 4); // encabezado + 3 tareas
  const headers = (todas.getRow(1).values as unknown[]).slice(1);
  assert.ok(headers.includes('Tarea') && headers.includes('Fin') && headers.includes('Retrasada'));
  assert.equal(todas.views[0].state, 'frozen');
  const endCol = (headers as string[]).indexOf('Fin') + 1;
  assert.ok(todas.getRow(2).getCell(endCol).value instanceof Date);
  assert.equal(wb.getWorksheet('Ana Pérez')!.rowCount, 3);
  const resumen = wb.getWorksheet('Resumen')!;
  assert.equal(resumen.rowCount, 4); // encabezado + 3 usuarios
});

test('por defecto no exporta archivadas y no trae la columna "Archivada"', async () => {
  const acts = [task({ title: 'Actual' }), task({ title: 'Archivada', archived: true })];
  const d = buildExportData({ activities: acts, users, teams, today });
  assert.equal(d.includesArchived, false);
  assert.deepEqual(d.tasks.map(r => r.title), ['Actual']);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildWorkbookBuffer(d));
  const headers = (wb.getWorksheet('Todas')!.getRow(1).values as unknown[]).slice(1);
  assert.ok(!headers.includes('Archivada'));
  assert.ok(!((wb.getWorksheet('Resumen')!.getRow(1).values as unknown[]).includes('Archivadas')));
});

test('con includeArchived exporta también las archivadas, al final de cada persona, y las marca', () => {
  const acts = [
    task({ title: 'Archivada abierta', status: 'doing', archived: true, endDate: '2026-10-01' }),
    task({ title: 'Actual hecha', status: 'done', completedAt: '2026-10-05T10:00:00.000Z' }),
    task({ title: 'Actual abierta', status: 'todo' }),
    task({ title: 'Archivada hecha', status: 'done', archived: true, completedAt: '2026-09-01T10:00:00.000Z' }),
  ];
  const d = buildExportData({ activities: acts, users, teams, today, includeArchived: true });
  assert.equal(d.includesArchived, true);
  const ana = d.byUser.find(u => u.username === 'Ana')!;
  assert.deepEqual(ana.rows.map(r => r.title), ['Actual abierta', 'Actual hecha', 'Archivada abierta', 'Archivada hecha']);
  assert.deepEqual(ana.rows.map(r => r.archived), [false, false, true, true]);
  const s = d.summary.find(r => r.username === 'Ana')!;
  assert.deepEqual([s.total, s.archived], [4, 2]);
});

test('una archivada abierta no cuenta como retrasada aunque su fecha ya pasó', () => {
  const acts = [task({ title: 'Vieja', status: 'doing', archived: true, endDate: '2026-09-01' })];
  const row = buildExportData({ activities: acts, users, teams, today, includeArchived: true }).tasks[0];
  assert.deepEqual([row.overdue, row.overdueDays], [false, 0]);
});

test('el .xlsx con archivadas trae la columna "Archivada" (Sí/No) y "Archivadas" en el resumen', async () => {
  const acts = [task({ title: 'Actual' }), task({ title: 'Archivada', archived: true })];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildWorkbookBuffer(buildExportData({ activities: acts, users, teams, today, includeArchived: true })));
  const todas = wb.getWorksheet('Todas')!;
  const headers = (todas.getRow(1).values as unknown[]).slice(1) as string[];
  const col = headers.indexOf('Archivada') + 1;
  assert.ok(col > 0);
  assert.deepEqual([todas.getRow(2).getCell(col).value, todas.getRow(3).getCell(col).value], ['No', 'Sí']);
  const resumen = wb.getWorksheet('Resumen')!;
  const rh = (resumen.getRow(1).values as unknown[]).slice(1) as string[];
  assert.equal(resumen.getRow(2).getCell(rh.indexOf('Archivadas') + 1).value, 1);
});
