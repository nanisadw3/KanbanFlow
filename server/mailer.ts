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

// Mail goes out through the Gmail API over HTTPS (port 443) instead of SMTP: some networks
// let HTTPS through but stall SMTP/STARTTLS. Auth is OAuth2 with a long-lived refresh token.
export interface MailConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  // Optional display name/address. Gmail rewrites the address to the authorized account
  // unless it is a verified alias, so in practice this just sets the visible name.
  from?: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const REQUEST_TIMEOUT_MS = 15_000;

// Header values come from user data (assignee email), so strip line breaks to rule out
// header injection.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function buildRawMessage(m: { from?: string; to: string; subject: string; text: string }): string {
  const headers = [
    ...(m.from ? [`From: ${oneLine(m.from)}`] : []),
    `To: ${oneLine(m.to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(m.subject)).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = Buffer.from(m.text).toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return base64url(Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`));
}

async function googleError(res: Response): Promise<string> {
  const body: any = await res.json().catch(() => null);
  const detail = body?.error_description ?? body?.error?.message ?? (typeof body?.error === 'string' ? body.error : '');
  return `${detail || 'sin detalle'} (HTTP ${res.status})`;
}

export function createGmailTransport(
  cfg: Required<Pick<MailConfig, 'clientId' | 'clientSecret' | 'refreshToken'>>,
  fetchFn: typeof fetch = fetch
): Transport {
  let token: { value: string; expiresAt: number } | null = null;

  const accessToken = async (): Promise<string> => {
    if (token && Date.now() < token.expiresAt) return token.value;
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google rechazó las credenciales: ${await googleError(res)}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute early so a token never expires mid-request.
    token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return token.value;
  };

  return {
    async sendMail({ from, to, subject, text }) {
      const res = await fetchFn(SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: buildRawMessage({ from, to, subject, text }) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status === 401) token = null;
        throw new Error(`Gmail rechazó el envío: ${await googleError(res)}`);
      }
    },
  };
}

export function mailerFromConfig(cfg: MailConfig, fetchFn?: typeof fetch): Mailer {
  const { clientId, clientSecret, refreshToken } = cfg;
  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[Mailer] Gmail (Client ID, Client Secret y Refresh token) no configurado: los correos están deshabilitados.');
    return createMailer(null, '');
  }
  return createMailer(createGmailTransport({ clientId, clientSecret, refreshToken }, fetchFn), cfg.from ?? '');
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  return mailerFromConfig({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
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
