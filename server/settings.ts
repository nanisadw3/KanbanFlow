import type { Database } from 'sqlite';
import type { SmtpConfig } from './mailer.ts';

// Key/value settings table. SMTP values saved here (from the admin panel) win over the
// SMTP_* env vars, field by field. The password is stored as-is — SMTP needs the real
// value — so it must never be sent to a client (see publicSmtpSettings).
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

const SMTP_KEYS = { host: 'smtp_host', port: 'smtp_port', user: 'smtp_user', pass: 'smtp_pass', from: 'smtp_from' } as const;

export async function resolveSmtpConfig(db: Database, env: NodeJS.ProcessEnv = process.env): Promise<SmtpConfig> {
  const [host, port, user, pass, from] = await Promise.all([
    getSetting(db, SMTP_KEYS.host), getSetting(db, SMTP_KEYS.port), getSetting(db, SMTP_KEYS.user),
    getSetting(db, SMTP_KEYS.pass), getSetting(db, SMTP_KEYS.from),
  ]);
  return {
    host: host || env.SMTP_HOST || undefined,
    port: Number(port || env.SMTP_PORT) || undefined,
    user: user || env.SMTP_USER || undefined,
    pass: pass || env.SMTP_PASS || undefined,
    from: from || env.MAIL_FROM || undefined,
  };
}

// An empty/undefined field leaves the stored value alone, so the password field can be
// left blank to keep the current one.
export async function saveSmtpSettings(db: Database, patch: SmtpConfig): Promise<void> {
  for (const field of ['host', 'user', 'pass', 'from'] as const) {
    const value = patch[field];
    if (typeof value === 'string' && value.trim() !== '') await setSetting(db, SMTP_KEYS[field], value.trim());
  }
  if (typeof patch.port === 'number' && patch.port > 0) await setSetting(db, SMTP_KEYS.port, String(patch.port));
}

export async function publicSmtpSettings(db: Database, env: NodeJS.ProcessEnv = process.env) {
  const cfg = await resolveSmtpConfig(db, env);
  return { host: cfg.host ?? '', port: cfg.port ?? 587, user: cfg.user ?? '', from: cfg.from ?? '', hasPassword: !!cfg.pass };
}
