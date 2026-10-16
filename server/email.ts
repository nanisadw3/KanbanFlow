const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim();
  return EMAIL_RE.test(email) ? email : null;
}

export const isValidEmail = (raw: unknown): boolean => normalizeEmail(raw) !== null;
