import type { Database } from 'sqlite';
import type { MailConfig } from './mailer.ts';

// Key/value settings table. Gmail API values saved here (from the admin panel) win over the
// GMAIL_* env vars, field by field. The client secret and refresh token are stored as-is —
// they are the credentials — so they must never be sent to a client (see publicMailSettings).
export async function ensureSettingsTable(db: Database): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

export async function getSetting(db: Database, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

const MAIL_KEYS = {
  clientId: 'gmail_client_id',
  clientSecret: 'gmail_client_secret',
  refreshToken: 'gmail_refresh_token',
  from: 'mail_from',
} as const;

const FIELDS = ['clientId', 'clientSecret', 'refreshToken', 'from'] as const;

export async function resolveMailConfig(db: Database, env: NodeJS.ProcessEnv = process.env): Promise<MailConfig> {
  const [clientId, clientSecret, refreshToken, from] = await Promise.all(FIELDS.map(f => getSetting(db, MAIL_KEYS[f])));
  return {
    clientId: clientId || env.GMAIL_CLIENT_ID || undefined,
    clientSecret: clientSecret || env.GMAIL_CLIENT_SECRET || undefined,
    refreshToken: refreshToken || env.GMAIL_REFRESH_TOKEN || undefined,
    from: from || env.MAIL_FROM || undefined,
  };
}

// An empty/undefined field leaves the stored value alone, so the secret fields can be
// left blank to keep the current ones.
export async function saveMailConfig(db: Database, patch: MailConfig): Promise<void> {
  for (const field of FIELDS) {
    const value = patch[field];
    if (typeof value === 'string' && value.trim() !== '') await setSetting(db, MAIL_KEYS[field], value.trim());
  }
}

export async function publicMailSettings(db: Database, env: NodeJS.ProcessEnv = process.env) {
  const cfg = await resolveMailConfig(db, env);
  return {
    clientId: cfg.clientId ?? '',
    from: cfg.from ?? '',
    hasClientSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
  };
}
