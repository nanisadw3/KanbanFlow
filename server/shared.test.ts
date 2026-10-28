import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import {
  validateShared, createSharedTask, syncSharedFields, ensureCommentsTable, ensureCommentReadsTable, addComment, pruneComments, sharedRecipients,
  markCommentsRead, countUnread, commentRecipients, setParticipants,
} from './shared.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, email TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT, description TEXT, startDate TEXT, endDate TEXT,
      status TEXT, username TEXT, createdAt TEXT, assignedBy TEXT, priority TEXT, progress INTEGER,
      teamId TEXT, completedAt TEXT, archived INTEGER DEFAULT 0, overdueNotifiedAt TEXT,
      kind TEXT NOT NULL DEFAULT 'single', sharedId TEXT, seriesId TEXT);
    INSERT INTO users VALUES ('Ana','Ana P','user','x','ana@x.com'), ('Beto','Beto R','user','x','beto@x.com'),
      ('Luis','Luis A','admin','x','luis@x.com'), ('Eva','Eva Z','user','x','eva@x.com');
  `);
  await db.exec('CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, memberUsernames TEXT, createdAt TEXT);');
  await ensureCommentsTable(db);
  await ensureCommentReadsTable(db);
  return db;
}
const input = { title: ' Informe ', description: 'x', startDate: '2026-10-05', endDate: '2026-10-09', priority: 'alta', usernames: ['ana', 'BETO', 'ana', 'nadie'], assignedBy: 'Luis' };

test('validateShared limpia título, deduplica y reconoce usuarios sin importar mayúsculas', () => {
  const r = validateShared(input, ['Ana', 'Beto', 'Luis']);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.task.title, 'Informe');
    assert.deepEqual(r.task.usernames, ['Ana', 'Beto']);
    assert.equal(r.task.teamId, null);
  }
});

test('validateShared rechaza título vacío, fechas malas y sin participantes', () => {
  assert.deepEqual(validateShared({ ...input, title: '  ' }, ['Ana']), { ok: false, error: 'invalid_title' });
  assert.deepEqual(validateShared({ ...input, endDate: 'mañana' }, ['Ana']), { ok: false, error: 'invalid_dates' });
  assert.deepEqual(validateShared({ ...input, usernames: ['nadie'] }, ['Ana']), { ok: false, error: 'no_participants' });
  assert.deepEqual(validateShared({ ...input, usernames: 'Ana' }, ['Ana']), { ok: false, error: 'no_participants' });
});

test('createSharedTask crea una copia por persona con el mismo sharedId', async () => {
  const db = await makeDb();
  const r = validateShared({ ...input, usernames: ['Ana', 'Luis'] }, ['Ana', 'Beto', 'Luis']);
  assert.ok(r.ok);
  if (!r.ok) return;
  const { sharedId, ids } = await createSharedTask(db, r.task);
  assert.equal(ids.length, 2);
  const rows = await db.all('SELECT * FROM activities ORDER BY username');
  assert.deepEqual(rows.map(x => x.username), ['Ana', 'Luis']);
  assert.ok(rows.every(x => x.kind === 'shared' && x.sharedId === sharedId && x.status === 'todo' && x.progress === 0));
  assert.equal(rows[0].assignedBy, 'Luis');
  assert.equal(rows[1].assignedBy, null); // la copia del creador no se "asigna" a sí mismo
});

test('syncSharedFields cambia la tarea en todas las copias pero no el avance de cada quien', async () => {
  const db = await makeDb();
  const r = validateShared({ ...input, usernames: ['Ana', 'Beto'] }, ['Ana', 'Beto']);
  if (!r.ok) throw new Error('invalid');
  const { sharedId } = await createSharedTask(db, r.task);
  await db.run("UPDATE activities SET progress = 40, status = 'doing' WHERE username = 'Ana'");
  await syncSharedFields(db, sharedId, { title: 'Nuevo', description: 'y', startDate: '2026-10-06', endDate: '2026-10-20', priority: 'baja' });
  const rows = await db.all('SELECT * FROM activities ORDER BY username');
  assert.ok(rows.every(x => x.title === 'Nuevo' && x.endDate === '2026-10-20' && x.priority === 'baja'));
  assert.equal(rows[0].progress, 40);
  assert.equal(rows[1].progress, 0);
});

test('syncSharedFields reactiva el aviso de retraso solo si cambió la fecha de fin', async () => {
  const db = await makeDb();
  const r = validateShared({ ...input, usernames: ['Ana'] }, ['Ana']);
  if (!r.ok) throw new Error('invalid');
  const { sharedId } = await createSharedTask(db, r.task);
  await db.run("UPDATE activities SET overdueNotifiedAt = 'x'");
  await syncSharedFields(db, sharedId, { title: 'T', description: '', startDate: '2026-10-05', endDate: '2026-10-09', priority: 'alta' });
  assert.equal((await db.get('SELECT overdueNotifiedAt v FROM activities')).v, 'x');
  await syncSharedFields(db, sharedId, { title: 'T', description: '', startDate: '2026-10-05', endDate: '2026-10-30', priority: 'alta' });
  assert.equal((await db.get('SELECT overdueNotifiedAt v FROM activities')).v, null);
});

test('comentarios: participantes y admins pueden, otros no; el texto se recorta', async () => {
  const db = await makeDb();
  const r = validateShared({ ...input, usernames: ['Ana', 'Beto'] }, ['Ana', 'Beto']);
  if (!r.ok) throw new Error('invalid');
  const { sharedId } = await createSharedTask(db, r.task);
  assert.deepEqual(await addComment(db, { sharedId, username: 'ana', text: '  hola  ' }), { ok: true });
  assert.deepEqual(await addComment(db, { sharedId, username: 'Luis', text: 'visto' }), { ok: true });
  assert.deepEqual(await addComment(db, { sharedId, username: 'Eva', text: 'yo no' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await addComment(db, { sharedId, username: 'Ana', text: '   ' }), { ok: false, error: 'invalid_comment' });
  assert.deepEqual(await addComment(db, { sharedId: 'nope', username: 'Ana', text: 'x' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await addComment(db, { sharedId, username: 'Fantasma', text: 'x' }), { ok: false, error: 'not_found' });
  const rows = await db.all('SELECT * FROM comments ORDER BY createdAt');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'hola');
  assert.equal(rows[0].username, 'Ana');
  await addComment(db, { sharedId, username: 'Ana', text: 'x'.repeat(5000) });
  assert.equal((await db.get('SELECT MAX(LENGTH(text)) n FROM comments')).n, 1000);
});

test('pruneComments borra los comentarios de tareas compartidas que ya no existen', async () => {
  const db = await makeDb();
  const r = validateShared({ ...input, usernames: ['Ana'] }, ['Ana']);
  if (!r.ok) throw new Error('invalid');
  const { sharedId } = await createSharedTask(db, r.task);
  await addComment(db, { sharedId, username: 'Ana', text: 'hola' });
  await pruneComments(db);
  assert.equal((await db.get('SELECT COUNT(*) n FROM comments')).n, 1);
  await db.run('DELETE FROM activities');
  await pruneComments(db);
  assert.equal((await db.get('SELECT COUNT(*) n FROM comments')).n, 0);
});

test('sharedRecipients: participantes + administradores, sin repetir, sin creador ni sin correo', async () => {
  const people = [
    { username: 'Ana', fullName: 'Ana P', email: 'ana@x.com', role: 'user' },
    { username: 'Beto', fullName: 'Beto R', email: null, role: 'user' },
    { username: 'Luis', fullName: 'Luis A', email: 'luis@x.com', role: 'admin' },
    { username: 'Roberto', fullName: 'Roberto', email: 'ANA@x.com', role: 'admin' },
    { username: 'Eva', fullName: 'Eva Z', email: 'eva@x.com', role: 'user' },
    { username: 'Maria', fullName: 'Maria', email: 'maria@x.com', role: 'admin' },
  ];
  const r = sharedRecipients(people, ['Ana', 'Beto'], 'Maria');
  assert.deepEqual(r.map(x => x.username), ['Ana', 'Luis']); // Beto sin correo, Roberto repite el de Ana, Eva no participa, Maria creó
  assert.deepEqual(r.map(x => x.participant), [true, false]);
});

// ── comentarios sin leer ──
const at = (m: number) => new Date(Date.UTC(2026, 9, 28, 10, m));
async function sharedWith(db: Database, who: string[], created = at(0)) {
  const r = validateShared({ ...input, usernames: who }, ['Ana', 'Beto', 'Luis', 'Eva']);
  if (!r.ok) throw new Error('invalid');
  return (await createSharedTask(db, r.task, created)).sharedId;
}

test('countUnread: cuenta lo de otros posterior a tu última lectura, no lo tuyo ni lo anterior a tu copia', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana', 'Beto']);
  await addComment(db, { sharedId: id, username: 'Beto', text: 'uno' }, at(5));
  await addComment(db, { sharedId: id, username: 'Ana', text: 'mío' }, at(6));
  await addComment(db, { sharedId: id, username: 'Beto', text: 'dos' }, at(7));
  assert.equal(await countUnread(db, 'Ana', id), 2);   // sin lectura: desde que existe su copia
  assert.equal(await countUnread(db, 'ana', id), 2);   // sin importar mayúsculas
  assert.equal(await countUnread(db, 'Beto', id), 1);  // solo el de Ana
  await markCommentsRead(db, { username: 'Ana', sharedId: id }, at(8));
  assert.equal(await countUnread(db, 'Ana', id), 0);
  await addComment(db, { sharedId: id, username: 'Beto', text: 'tres' }, at(9));
  assert.equal(await countUnread(db, 'Ana', id), 1);
});

test('un comentario anterior a que te agregaran no cuenta como nuevo', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana']);
  await addComment(db, { sharedId: id, username: 'Ana', text: 'viejo' }, at(1));
  await db.run("INSERT INTO activities (id, username, kind, sharedId, createdAt, status, title, description, startDate, endDate, priority) VALUES ('late','Beto','shared',?,?, 'todo','t','','2026-10-05','2026-10-09','media')", [id, at(30).toISOString()]);
  assert.equal(await countUnread(db, 'Beto', id), 0);
});

test('markCommentsRead valida usuario y tarea', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana']);
  assert.deepEqual(await markCommentsRead(db, { username: 'Fantasma', sharedId: id }), { ok: false, error: 'not_found' });
  assert.deepEqual(await markCommentsRead(db, { username: 'Ana', sharedId: 'nope' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await markCommentsRead(db, { username: 'ana', sharedId: id }), { ok: true });
  assert.deepEqual(await markCommentsRead(db, { username: 'Ana', sharedId: id }), { ok: true }); // repetir no duplica
  assert.equal((await db.get('SELECT COUNT(*) n FROM comment_reads')).n, 1);
});

test('commentRecipients: solo avisa del primer comentario sin leer, a otros participantes con correo', async () => {
  const db = await makeDb();
  await db.run("UPDATE users SET email = NULL WHERE username = 'Eva'");
  const id = await sharedWith(db, ['Ana', 'Beto', 'Eva']);
  await addComment(db, { sharedId: id, username: 'Ana', text: 'hola' }, at(5));
  assert.deepEqual((await commentRecipients(db, id, 'Ana')).map(r => r.username).sort(), ['Beto']); // Eva sin correo, Ana es la autora
  await addComment(db, { sharedId: id, username: 'Ana', text: 'otro' }, at(6));
  assert.deepEqual(await commentRecipients(db, id, 'Ana'), []);                                      // ya tenían uno sin leer
  await markCommentsRead(db, { username: 'Beto', sharedId: id }, at(7));
  await addComment(db, { sharedId: id, username: 'Ana', text: 'de nuevo' }, at(8));
  assert.deepEqual((await commentRecipients(db, id, 'Ana')).map(r => r.username), ['Beto']);         // leyó, así que otra vez toca avisar
});

test('pruneComments también borra las marcas de lectura de tareas que ya no existen', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana']);
  await markCommentsRead(db, { username: 'Ana', sharedId: id });
  await db.run('DELETE FROM activities');
  await pruneComments(db);
  assert.equal((await db.get('SELECT COUNT(*) n FROM comment_reads')).n, 0);
});

// ── cambiar participantes ──
test('setParticipants agrega copias nuevas (por hacer, 0%) y quita las de quien sale', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana', 'Beto']);
  await db.run("UPDATE activities SET status = 'doing', progress = 60 WHERE username = 'Ana'");
  await markCommentsRead(db, { username: 'Beto', sharedId: id });
  const r = await setParticipants(db, { sharedId: id, usernames: ['ana', 'Eva'], by: 'Ana' }, at(20));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual([r.added, r.removed], [['Eva'], ['Beto']]);
  assert.deepEqual(r.all, ['Ana', 'Eva']);
  const rows = await db.all("SELECT username, status, progress, assignedBy, title, endDate, kind FROM activities WHERE sharedId = ? ORDER BY username", [id]);
  assert.deepEqual(rows.map(x => x.username), ['Ana', 'Eva']);
  assert.deepEqual([rows[0].status, rows[0].progress], ['doing', 60]);               // Ana conserva su avance
  assert.deepEqual([rows[1].status, rows[1].progress, rows[1].assignedBy], ['todo', 0, 'Ana']);
  assert.deepEqual([rows[1].title, rows[1].endDate, rows[1].kind], ['Informe', '2026-10-09', 'shared']); // misma tarea
  assert.equal((await db.get("SELECT COUNT(*) n FROM comment_reads WHERE username = 'Beto'")).n, 0);
});

test('setParticipants: quien se agrega a sí mismo no queda como "asignado por"', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana']);
  await setParticipants(db, { sharedId: id, usernames: ['Ana', 'Luis'], by: 'Luis' }); // Luis es admin
  assert.equal((await db.get("SELECT assignedBy a FROM activities WHERE username = 'Luis'")).a, null);
});

test('setParticipants rechaza: nadie, tarea inexistente, y quien no participa ni es admin', async () => {
  const db = await makeDb();
  const id = await sharedWith(db, ['Ana', 'Beto']);
  assert.deepEqual(await setParticipants(db, { sharedId: id, usernames: [], by: 'Ana' }), { ok: false, error: 'no_participants' });
  assert.deepEqual(await setParticipants(db, { sharedId: id, usernames: ['nadie'], by: 'Ana' }), { ok: false, error: 'no_participants' });
  assert.deepEqual(await setParticipants(db, { sharedId: 'nope', usernames: ['Ana'], by: 'Ana' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await setParticipants(db, { sharedId: id, usernames: ['Ana'], by: 'Eva' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await setParticipants(db, { sharedId: id, usernames: ['Ana'], by: 'Fantasma' }), { ok: false, error: 'forbidden' });
  assert.equal((await db.get('SELECT COUNT(*) n FROM activities')).n, 2); // nada cambió
  assert.ok((await setParticipants(db, { sharedId: id, usernames: ['Ana'], by: 'Luis' })).ok);           // un admin sí puede
});

test('setParticipants en una tarea de equipo solo admite miembros del equipo', async () => {
  const db = await makeDb();
  await db.run("INSERT INTO teams VALUES ('t1','Eq','[\"Ana\",\"Beto\"]','x')");
  const r = validateShared({ ...input, usernames: ['Ana'], teamId: 't1' }, ['Ana']);
  if (!r.ok) throw new Error('invalid');
  const { sharedId } = await createSharedTask(db, r.task);
  const res = await setParticipants(db, { sharedId, usernames: ['Ana', 'Beto', 'Eva'], by: 'Ana' });
  assert.ok(res.ok);
  if (res.ok) assert.deepEqual(res.added, ['Beto']); // Eva no es del equipo
});
