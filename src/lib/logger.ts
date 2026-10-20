/**
 * Logger com redação de campos sensíveis. Use-o no lugar de console.*.
 * Nunca registre valores financeiros, documentos, tokens ou e-mails.
 */
const SENSITIVE_KEY = /pass(word)?|senha|token|secret|key|authorization|cookie|email|cpf|cnpj|amount|valor|balance|saldo/i;
const JWT_LIKE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[profundidade]';
  if (typeof value === 'string') return value.replace(JWT_LIKE, '[redigido]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redigido]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (level === 'debug' && import.meta.env.PROD) return;
  const payload = context ? redact(context) : undefined;
  const fn = level === 'error' ? console.error : console.warn;
  fn(`[${level}] ${message}`, ...(payload ? [payload] : []));
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
