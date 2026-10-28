import { randomBytes } from 'crypto';

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
  send(to: string, subject: string, text: string, html?: string): Promise<boolean>;
  trySend(to: string, subject: string, text: string, html?: string): Promise<SendResult>;
}

type Transport = { sendMail(opts: any): Promise<unknown> };

export function createMailer(transport: Transport | null, from: string): Mailer {
  const trySend = async (to: string, subject: string, text: string, html?: string): Promise<SendResult> => {
    if (!transport) return { ok: false, error: 'Correo no configurado' };
    try {
      await transport.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
      return { ok: true };
    } catch (err) {
      console.error('[Mailer] No se pudo enviar el correo a', to, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    enabled: transport !== null,
    trySend,
    send: async (to, subject, text, html) => (await trySend(to, subject, text, html)).ok,
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

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');
const b64Body = (s: string) => wrap76(Buffer.from(s).toString('base64'));

// Plain text when there is no html; otherwise multipart/alternative with both, so clients
// that can't (or won't) render HTML still show the text version.
export function buildRawMessage(m: { from?: string; to: string; subject: string; text: string; html?: string }): string {
  const boundary = `kf_${randomBytes(12).toString('hex')}`;
  const headers = [
    ...(m.from ? [`From: ${oneLine(m.from)}`] : []),
    `To: ${oneLine(m.to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(m.subject)).toString('base64')}?=`,
    'MIME-Version: 1.0',
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Body(body)}`;
  const mime = m.html
    ? [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`].join('\r\n') +
      `\r\n\r\n${part('text/plain', m.text)}${part('text/html', m.html)}--${boundary}--\r\n`
    : [...headers, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'].join('\r\n') +
      `\r\n\r\n${b64Body(m.text)}`;
  return base64url(Buffer.from(mime));
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
    async sendMail({ from, to, subject, text, html }) {
      const res = await fetchFn(SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: buildRawMessage({ from, to, subject, text, html }) }),
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

export { newTaskMessage, sharedTaskMessage, commentMessage, overdueMessage, testMessage } from './emailTemplates.ts';
