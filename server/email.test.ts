import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from './email.ts';

test('normalizeEmail recorta espacios y acepta correos válidos', () => {
  assert.equal(normalizeEmail('  Ana@Mail.com '), 'Ana@Mail.com');
  assert.equal(normalizeEmail('a.b+c@sub.dominio.mx'), 'a.b+c@sub.dominio.mx');
});

test('normalizeEmail rechaza valores inválidos', () => {
  for (const bad of ['', '   ', 'sinarroba', 'a@b', '@x.com', 'a@ x.com', 'a b@x.com', null, undefined, 42]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});
