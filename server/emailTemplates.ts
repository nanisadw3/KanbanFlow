import type { MailTask } from './mailer.ts';

export interface MailMessage {
  subject: string;
  text: string;
  html: string;
}

export interface MessageOptions {
  // Recipient's full name or username; only the first word is used in the greeting.
  name?: string;
  // Local YYYY-MM-DD, used for "vence en N días" / "venció hace N días".
  today?: string;
  // Public URL of the app. Adds an "Abrir KanbanFlow" button when it is an http(s) URL.
  appUrl?: string;
}

// Every value that comes from user data goes through esc() before it reaches the HTML.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}`;
}

// Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier.
export function daysBetween(from: string, to: string): number {
  const utc = (s: string) => {
    const [y, mo, d] = s.split('-').map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const PRIORITIES = {
  alta: { emoji: '🔴', label: 'Alta', color: '#b91c1c', bg: '#fee2e2' },
  media: { emoji: '🟡', label: 'Media', color: '#a16207', bg: '#fef3c7' },
  baja: { emoji: '🟢', label: 'Baja', color: '#15803d', bg: '#dcfce7' },
} as const;

const priorityOf = (p: string) =>
  PRIORITIES[p.toLowerCase() as keyof typeof PRIORITIES] ?? { emoji: '⚪', label: p || 'Sin prioridad', color: '#475569', bg: '#e2e8f0' };

const firstName = (name?: string) => (name ?? '').trim().split(/\s+/)[0] ?? '';
const hello = (name?: string) => (firstName(name) ? `¡Hola, ${firstName(name)}! 👋` : '¡Hola! 👋');
const safeUrl = (u?: string) => (u && /^https?:\/\/\S+$/i.test(u) ? u : '');

interface Theme {
  header: string;
  headerText: string;
  soft: string;
  accent: string;
}

const BLUE: Theme = { header: '#4f46e5', headerText: '#e0e7ff', soft: '#eef2ff', accent: '#4f46e5' };
const RED: Theme = { header: '#dc2626', headerText: '#fee2e2', soft: '#fef2f2', accent: '#dc2626' };
const GREEN: Theme = { header: '#059669', headerText: '#d1fae5', soft: '#ecfdf5', accent: '#059669' };

const AMBER: Theme = { header: '#b45309', headerText: '#fef3c7', soft: '#fffbeb', accent: '#b45309' };
const PURPLE: Theme = { header: '#6d43c7', headerText: '#ede9fe', soft: '#f5f3ff', accent: '#6d43c7' };

interface Layout {
  subject: string;
  preheader: string;
  theme: Theme;
  emoji: string;
  heading: string;
  greeting: string;
  intro: string;
  task?: MailTask;
  highlight?: string; // the date/countdown line, with its own emoji
  quote?: string;     // a comment shown as a quote under the intro (user text: escaped like everything else)
  closing: string;
  footnote?: string;  // replaces the default "already did this task" footer
  appUrl?: string;
}

function renderHtml(l: Layout): string {
  const url = safeUrl(l.appUrl);
  const prio = l.task ? priorityOf(l.task.priority) : null;
  const taskCard = l.task && prio
    ? `<tr><td style="padding:8px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${l.theme.soft};border-radius:16px;border-left:6px solid ${l.theme.accent};">
          <tr><td style="padding:22px 24px;">
            <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${l.theme.accent};font-weight:700;">📝 Tarea</div>
            <div style="font-size:24px;line-height:1.3;font-weight:800;color:#0f172a;margin:6px 0 10px 0;">${esc(l.task.title)}</div>
            <div style="font-size:16px;line-height:1.6;color:#475569;margin-bottom:16px;">${l.task.description ? esc(l.task.description).replace(/\n/g, '<br>') : 'Sin descripción por ahora.'}</div>
            <span style="display:inline-block;background:${prio.bg};color:${prio.color};font-size:14px;font-weight:700;padding:6px 14px;border-radius:999px;">${prio.emoji} Prioridad ${esc(prio.label)}</span>
            ${l.task.endDate ? `<span style="display:inline-block;background:#ffffff;color:#334155;font-size:14px;font-weight:700;padding:6px 14px;border-radius:999px;margin-left:6px;">📅 ${esc(formatLongDate(l.task.endDate))}</span>` : ''}
          </td></tr>
        </table>
      </td></tr>`
    : '';
  const quoteBlock = l.quote
    ? `<tr><td style="padding:8px 32px 0 32px;"><div style="border-left:4px solid ${l.theme.accent};background:${l.theme.soft};border-radius:0 12px 12px 0;padding:14px 18px;font-size:16px;line-height:1.6;color:#334155;font-style:italic;">“${esc(l.quote).replace(/\n/g, '<br>')}”</div></td></tr>`
    : '';
  const highlight = l.highlight
    ? `<tr><td style="padding:20px 32px 0 32px;"><div style="font-size:18px;font-weight:700;color:${l.theme.accent};">${esc(l.highlight)}</div></td></tr>`
    : '';
  const button = url
    ? `<tr><td align="center" style="padding:28px 32px 0 32px;"><a href="${esc(url)}" style="display:inline-block;background:${l.theme.accent};color:#ffffff;font-size:17px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:12px;">🚀 Abrir KanbanFlow</a></td></tr>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(l.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <tr><td align="center" style="background:${l.theme.header};padding:36px 24px 30px 24px;">
    <div style="font-size:56px;line-height:1;">${l.emoji}</div>
    <div style="font-size:28px;line-height:1.25;font-weight:800;color:#ffffff;margin-top:14px;">${esc(l.heading)}</div>
    <div style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${l.theme.headerText};margin-top:10px;font-weight:700;">KanbanFlow</div>
  </td></tr>
  <tr><td style="padding:32px 32px 8px 32px;">
    <div style="font-size:22px;font-weight:800;color:#0f172a;">${esc(l.greeting)}</div>
    <div style="font-size:17px;line-height:1.65;color:#334155;margin-top:10px;">${esc(l.intro)}</div>
  </td></tr>
  ${quoteBlock}
  ${taskCard}
  ${highlight}
  <tr><td style="padding:22px 32px 0 32px;"><div style="font-size:17px;line-height:1.65;color:#334155;">${esc(l.closing)}</div></td></tr>
  ${button}
  <tr><td style="padding:32px;"><div style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">Este es un aviso automático de KanbanFlow 🤖<br>${esc(l.footnote ?? 'Si ya atendiste esta tarea, puedes ignorar este mensaje.')}</div></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function renderText(l: Layout): string {
  const prio = l.task ? priorityOf(l.task.priority) : null;
  const url = safeUrl(l.appUrl);
  return [
    `${l.emoji} ${l.heading}`,
    '',
    l.greeting,
    l.intro,
    ...(l.quote ? ['', `💬 “${l.quote}”`] : []),
    ...(l.task && prio
      ? [
          '',
          `📝 Tarea: ${l.task.title}`,
          `🗒️ Descripción: ${l.task.description || 'Sin descripción por ahora.'}`,
          `${prio.emoji} Prioridad: ${prio.label}`,
          ...(l.task.endDate ? [`📅 Fecha de fin: ${formatLongDate(l.task.endDate)}`] : []),
        ]
      : []),
    ...(l.highlight ? ['', l.highlight] : []),
    '',
    l.closing,
    ...(url ? ['', `🚀 Abrir KanbanFlow: ${url}`] : []),
    '',
    '— Aviso automático de KanbanFlow 🤖',
  ].join('\n');
}

function build(l: Layout): MailMessage {
  return { subject: l.subject, text: renderText(l), html: renderHtml(l) };
}

function countdown(endDate: string, today?: string): string | undefined {
  // A repeating task has no end date, so there is nothing to count down to.
  if (!today || !endDate) return undefined;
  const d = daysBetween(today, endDate);
  if (d < 0) return '⚠️ Ojo: la fecha de entrega ya pasó';
  if (d === 0) return '⏳ ¡Vence hoy! Todavía estás a tiempo';
  if (d === 1) return '⏳ Vence mañana, ¡a darle!';
  return `⏳ Tienes ${d} días para completarla`;
}

export function newTaskMessage(task: MailTask, assignedByName: string, o: MessageOptions = {}): MailMessage {
  return build({
    subject: `📌 Nueva tarea para ti: ${task.title}`,
    preheader: `${assignedByName} te asignó una nueva tarea. ¡Échale un vistazo!`,
    theme: BLUE,
    emoji: '📋',
    heading: '¡Tienes una nueva tarea!',
    greeting: hello(o.name),
    intro: `${assignedByName} te asignó una nueva tarea en KanbanFlow. Aquí tienes los detalles para que la tengas a la mano 👇`,
    task,
    highlight: countdown(task.endDate, o.today),
    closing: 'Entra a KanbanFlow para ver todo con calma y mantener tu avance al día. ¡Tú puedes con esto! 💪✨',
    appUrl: o.appUrl,
  });
}

// `participants` are the display names of everyone the task was shared with. `o.participant` is
// false for an administrator who only gets the notice.
export function sharedTaskMessage(
  task: MailTask,
  createdByName: string,
  participants: string[],
  o: MessageOptions & { participant?: boolean } = {}
): MailMessage {
  const who = participants.join(', ');
  const isParticipant = o.participant !== false;
  return build({
    subject: `🤝 Nueva tarea compartida: ${task.title}`,
    preheader: `${createdByName} creó una tarea compartida con ${participants.length} ${participants.length === 1 ? 'persona' : 'personas'}.`,
    theme: PURPLE,
    emoji: '🤝',
    heading: '¡Nueva tarea compartida!',
    greeting: hello(o.name),
    intro: isParticipant
      ? `${createdByName} creó una tarea compartida y tú formas parte del grupo: ${who}. Cada quien lleva su propio avance y el equipo ve el promedio 👇`
      : `${createdByName} creó una tarea compartida entre ${who}. Te avisamos porque eres administrador 👇`,
    task,
    highlight: countdown(task.endDate, o.today),
    closing: isParticipant
      ? 'Entra a KanbanFlow, actualiza tu avance y deja comentarios para que todo el grupo esté al tanto. ¡A trabajar en equipo! 💜'
      : 'Puedes seguir el avance de cada persona y los comentarios desde KanbanFlow. 💜',
    appUrl: o.appUrl,
  });
}

// A participant commented on a shared task. Only the first unread comment of each person is emailed
// (see commentRecipients), so this reads as "there is news", not as a transcript.
export function commentMessage(task: MailTask, authorName: string, text: string, o: MessageOptions = {}): MailMessage {
  const excerpt = text.length > 400 ? `${text.slice(0, 400).trimEnd()}…` : text;
  return build({
    subject: `💬 ${authorName} comentó en: ${task.title}`,
    preheader: `${authorName} dejó un comentario en una tarea compartida contigo.`,
    theme: PURPLE,
    emoji: '💬',
    heading: 'Nuevo comentario',
    greeting: hello(o.name),
    intro: `${authorName} comentó en la tarea compartida "${task.title}":`,
    quote: excerpt,
    closing: 'Entra a KanbanFlow para leer la conversación y responder. Si llegan más comentarios, los verás marcados en la tarea (no te enviaremos otro correo hasta que leas este). 💜',
    appUrl: o.appUrl,
  });
}

// Sent by the role manager to everyone with an email when a new feature is about to be released.
export function maintenanceMessage(message: string, o: MessageOptions = {}): MailMessage {
  return build({
    subject: '🛠️ KanbanFlow estará en mantenimiento',
    preheader: 'Vamos a agregar una nueva funcionalidad; la página puede no estar disponible unos minutos.',
    theme: AMBER,
    emoji: '🛠️',
    heading: 'Mantenimiento de KanbanFlow',
    greeting: hello(o.name),
    intro: 'Vamos a agregar una nueva funcionalidad y la página se encontrará en mantenimiento.',
    quote: message,
    closing: 'Si ves algo raro o no carga unos minutos, es normal. Cuando termine, todo seguirá como lo dejaste. ¡Gracias por la paciencia! 🙏',
    footnote: 'No necesitas hacer nada.',
    appUrl: o.appUrl,
  });
}

// A general announcement published by an administrator.
export function announcementMessage(message: string, authorName: string, o: MessageOptions = {}): MailMessage {
  return build({
    subject: '📢 Aviso en KanbanFlow',
    preheader: `${authorName} publicó un aviso para todos.`,
    theme: BLUE,
    emoji: '📢',
    heading: 'Aviso para todos',
    greeting: hello(o.name),
    intro: `${authorName} publicó un aviso en KanbanFlow:`,
    quote: message,
    closing: 'Lo verás también como un banner arriba al entrar a KanbanFlow. ¡Gracias! 🙌',
    footnote: 'No necesitas hacer nada.',
    appUrl: o.appUrl,
  });
}

export function overdueMessage(task: MailTask, o: MessageOptions = {}): MailMessage {
  const late = o.today ? daysBetween(task.endDate, o.today) : 0;
  const lateText = late === 1 ? 'venció ayer' : late > 1 ? `venció hace ${late} días` : 'ya venció';
  return build({
    subject: `⏰ Tarea retrasada: ${task.title}`,
    preheader: `Tu tarea ${lateText}. Un momento para ponerla al día.`,
    theme: RED,
    emoji: '⏰',
    heading: 'Una tarea se retrasó',
    greeting: hello(o.name),
    intro: `Se nos pasó la fecha de una de tus tareas y ${lateText} 😬. No pasa nada: todavía se puede poner al día.`,
    task,
    highlight: late > 0 ? `🕒 Retraso: ${late === 1 ? '1 día' : `${late} días`}` : undefined,
    closing: 'Entra a KanbanFlow, actualiza su estado o ajusta la fecha si hace falta. ¡Un pequeño empujón y queda lista! 🚀',
    appUrl: o.appUrl,
  });
}

export function testMessage(o: MessageOptions = {}): MailMessage {
  return build({
    subject: '✅ Prueba de KanbanFlow: ¡todo funciona!',
    preheader: 'Tu configuración de correo de avisos funciona correctamente.',
    theme: GREEN,
    emoji: '🎉',
    heading: '¡Tu correo de avisos funciona!',
    greeting: hello(o.name),
    intro: 'Si estás leyendo esto, KanbanFlow ya puede avisarle a tu equipo cuando tengan tareas nuevas o retrasadas. 📬',
    closing: 'A partir de ahora los avisos saldrán desde esta cuenta, con este mismo diseño. ¡Listo para trabajar! 🙌',
    appUrl: o.appUrl,
  });
}
