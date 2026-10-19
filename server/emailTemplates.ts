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
  closing: string;
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
            <span style="display:inline-block;background:#ffffff;color:#334155;font-size:14px;font-weight:700;padding:6px 14px;border-radius:999px;margin-left:6px;">📅 ${esc(formatLongDate(l.task.endDate))}</span>
          </td></tr>
        </table>
      </td></tr>`
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
  ${taskCard}
  ${highlight}
  <tr><td style="padding:22px 32px 0 32px;"><div style="font-size:17px;line-height:1.65;color:#334155;">${esc(l.closing)}</div></td></tr>
  ${button}
  <tr><td style="padding:32px;"><div style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">Este es un aviso automático de KanbanFlow 🤖<br>Si ya atendiste esta tarea, puedes ignorar este mensaje.</div></td></tr>
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
    ...(l.task && prio
      ? [
          '',
          `📝 Tarea: ${l.task.title}`,
          `🗒️ Descripción: ${l.task.description || 'Sin descripción por ahora.'}`,
          `${prio.emoji} Prioridad: ${prio.label}`,
          `📅 Fecha de fin: ${formatLongDate(l.task.endDate)}`,
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
  if (!today) return undefined;
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
