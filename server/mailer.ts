import nodemailer from 'nodemailer';

export interface MailTask {
  title: string;
  description: string;
  endDate: string;
  priority: string;
}

export interface Mailer {
  enabled: boolean;
  send(to: string, subject: string, text: string): Promise<boolean>;
}

type Transport = { sendMail(opts: any): Promise<unknown> };

export function createMailer(transport: Transport | null, from: string): Mailer {
  return {
    enabled: transport !== null,
    async send(to, subject, text) {
      if (!transport) return false;
      try {
        await transport.sendMail({ from, to, subject, text });
        return true;
      } catch (err) {
        console.error('[Mailer] No se pudo enviar el correo a', to, err);
        return false;
      }
    },
  };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[Mailer] SMTP_HOST/SMTP_USER/SMTP_PASS no configurados: los correos están deshabilitados.');
    return createMailer(null, '');
  }
  const port = Number(SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return createMailer(transport, MAIL_FROM || `KanbanFlow <${SMTP_USER}>`);
}

export function newTaskMessage(task: MailTask, assignedByName: string) {
  return {
    subject: `Nueva tarea asignada: ${task.title}`,
    text:
      `${assignedByName} te asignó una nueva tarea en KanbanFlow.\n\n` +
      `Tarea: ${task.title}\n` +
      `Descripción: ${task.description || 'Sin descripción.'}\n` +
      `Prioridad: ${task.priority}\n` +
      `Fecha de fin: ${task.endDate}\n`,
  };
}

export function overdueMessage(task: MailTask) {
  return {
    subject: `Tarea retrasada: ${task.title}`,
    text:
      `Tu tarea "${task.title}" está retrasada.\n\n` +
      `Descripción: ${task.description || 'Sin descripción.'}\n` +
      `Prioridad: ${task.priority}\n` +
      `Debía terminar el: ${task.endDate}\n\n` +
      `Entra a KanbanFlow para actualizarla.\n`,
  };
}
