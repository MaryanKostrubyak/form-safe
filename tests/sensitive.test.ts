import { describe, expect, it } from 'vitest';
import { isSensitiveDescriptor, isSensitiveForm } from '../src/lib/v2/sensitive';

describe('sensitive field detection', () => {
  it.each(['password', 'one-time-code', 'cc-number', 'social security number', 'IBAN', 'recovery phrase', 'api key'])(
    'blocks %s',
    (label) => expect(isSensitiveDescriptor({ label })).toBe(true),
  );

  it('does not reject safe words that merely contain a short sensitive fragment', () => {
    expect(isSensitiveDescriptor({ label: 'Compass direction' })).toBe(false);
  });

  it('blocks the entire form when it includes an always-sensitive field', () => {
    expect(isSensitiveForm([
      { type: 'text', label: 'Username' },
      { type: 'password', label: 'Password' },
    ])).toBe(true);
  });

  it('ignores hidden and file controls without blocking safe visible fields', () => {
    expect(isSensitiveForm([
      { type: 'text', label: 'Message' },
      { type: 'hidden', name: 'csrf_token' },
      { type: 'file', name: 'attachment' },
    ])).toBe(false);
  });

  it('still blocks visible token fields', () => {
    expect(isSensitiveForm([
      { type: 'text', label: 'Message' },
      { type: 'text', label: 'API token' },
    ])).toBe(true);
  });
});
