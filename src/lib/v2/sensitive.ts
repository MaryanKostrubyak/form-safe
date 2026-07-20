export interface SensitiveDescriptor {
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  autocomplete?: string;
  testId?: string;
}

const ALWAYS_SENSITIVE_TYPES = new Set(['password', 'file', 'hidden']);
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
]);
const SENSITIVE_TOKENS = new Set([
  'password', 'passwd', 'pwd', 'pin', 'otp', 'cvv', 'cvc', 'iban', 'swift', 'bic',
  'ssn', 'passport', 'secret', 'token', 'mnemonic', 'seed', 'recovery', 'credential',
]);
const SENSITIVE_PHRASES = [
  'api key',
  'access key',
  'private key',
  'social security',
  'credit card',
  'debit card',
  'card number',
  'cc number',
  'one time code',
  'recovery phrase',
  'seed phrase',
  'bank account',
];

export function isSensitiveDescriptor(descriptor: SensitiveDescriptor): boolean {
  const type = descriptor.type?.trim().toLowerCase() ?? '';
  if (ALWAYS_SENSITIVE_TYPES.has(type)) return true;
  const autocomplete = descriptor.autocomplete?.trim().toLowerCase() ?? '';
  if (SENSITIVE_AUTOCOMPLETE.has(autocomplete) || autocomplete.startsWith('cc-')) return true;

  const text = normalize([
    descriptor.name,
    descriptor.id,
    descriptor.label,
    descriptor.placeholder,
    descriptor.autocomplete,
    descriptor.testId,
  ].filter(Boolean).join(' '));
  if (SENSITIVE_PHRASES.some((phrase) => text.includes(phrase))) return true;
  return tokenize(text).some((token) => SENSITIVE_TOKENS.has(token));
}

export function isSensitiveForm(fields: SensitiveDescriptor[]): boolean {
  return fields.some((field) => {
    const type = field.type?.trim().toLowerCase() ?? '';
    // Hidden and file controls are never captured, but their mere presence is
    // normal on safe forms and must not veto the visible fields around them.
    if (type === 'hidden' || type === 'file') return false;
    return isSensitiveDescriptor(field);
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return value.split(' ').filter(Boolean);
}
