import nodemailer from 'nodemailer';

export interface MailTask {
  title: string;
  description: string;
  endDate: string;
  priority: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface Mailer {
  enabled: boolean;
  send(to: string, subject: string, text: string): Promise<boolean>;
  trySend(to: string, subject: string, text: string): Promise<SendResult>;
}

type Transport = { sendMail(opts: any): Promise<unknown> };

export function createMailer(transport: Transport | null, from: string): Mailer {
  const trySend = async (to: string, subject: string, text: string): Promise<SendResult> => {
    if (!transport) return { ok: false, error: 'Correo no configurado' };
    try {
      await transport.sendMail({ from, to, subject, text });
      return { ok: true };
    } catch (err) {
      console.error('[Mailer] No se pudo enviar el correo a', to, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    enabled: transport !== null,
    trySend,
    send: async (to, subject, text) => (await trySend(to, subject, text)).ok,
  };
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
}

export function mailerFromConfig(cfg: SmtpConfig): Mailer {
  const { host, user, pass } = cfg;
  if (!host || !user || !pass) {
    console.warn('[Mailer] SMTP (servidor, usuario y contraseña) no configurado: los correos están deshabilitados.');
    return createMailer(null, '');
  }
  const port = cfg.port || 587;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return createMailer(transport, cfg.from || `KanbanFlow <${user}>`);
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  return mailerFromConfig({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || undefined,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  });
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
