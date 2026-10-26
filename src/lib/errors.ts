/**
 * Tradução segura de erros para o usuário. Mensagens técnicas (SQL, stack,
 * detalhes do PostgREST) nunca são exibidas; ficam apenas no logger, redigidas.
 */
import { logger } from './logger';

export interface ErrorLike {
  name?: string;
  code?: string;
  message?: string;
  status?: number;
}

const BY_CODE: Record<string, string> = {
  // PostgreSQL
  '42501': 'Você não tem permissão para esta ação.',
  '23514': 'Os dados informados não são válidos.',
  '23505': 'Este registro já existe ou a operação já foi realizada com outros dados.',
  '22023': 'Algum dado informado é inválido.',
  '40001': 'Este registro foi alterado por outra pessoa. Recarregue a página e tente de novo.',
  P0002: 'Convite inválido ou expirado.',
  // PostgREST
  PGRST301: 'Sua sessão expirou. Entre novamente.',
  PGRST303: 'Sua sessão expirou. Entre novamente.',
  // Supabase Auth
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
};

/**
 * As RPCs do banco levantam mensagens de regra de negócio em português, já
 * escritas para o usuário (ex.: "Data anterior à data do saldo inicial da
 * conta"). Elas são exibidas somente se tiverem o formato dessas mensagens;
 * mensagens técnicas do PostgreSQL/PostgREST (com aspas, nomes de objetos ou
 * termos em inglês) continuam substituídas pelo texto genérico do código.
 */
const SERVER_MESSAGE_CODES = new Set(['23514', '22023', '42501', '23505', 'P0002', '40001']);
const TECHNICAL = /violat|constraint|relation|column|null value|duplicate key|syntax|permission denied|function|operator|schema|table|row|jwt|token|["'`{}<>_=\\]/i;

export function isSafeServerMessage(message: string | undefined): boolean {
  if (!message || message.length > 140) return false;
  if (!/^[A-ZÀ-Ú][A-Za-zÀ-ÿ0-9 .,;:()/–—-]*$/.test(message)) return false;
  return !TECHNICAL.test(message);
}

export const GENERIC_ERROR = 'Não foi possível concluir a operação. Tente novamente.';
export const NETWORK_ERROR = 'Sem conexão com o servidor. Verifique sua internet.';

export function toUserMessage(error: unknown, context = 'operação'): string {
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  logger.error(`Falha em ${context}`, { code: e.code, status: e.status, message: e.message });
  if (e.code && SERVER_MESSAGE_CODES.has(e.code) && isSafeServerMessage(e.message)) return e.message!;
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]!;
  if (isNetworkError(e)) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

/**
 * Falhas de rede chegam de formas diferentes: TypeError do fetch, erro
 * `AuthRetryableFetchError` (status 0) do Supabase Auth, ou erro do PostgREST
 * cuja mensagem embute o TypeError.
 */
function isNetworkError(e: ErrorLike): boolean {
  if (e.name === 'AuthRetryableFetchError') return true;
  return /failed to fetch|networkerror|fetch failed|load failed/i.test(e.message ?? '');
}
