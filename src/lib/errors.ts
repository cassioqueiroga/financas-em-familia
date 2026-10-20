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
  // PostgREST
  PGRST301: 'Sua sessão expirou. Entre novamente.',
  PGRST303: 'Sua sessão expirou. Entre novamente.',
  // Supabase Auth
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
};

export const GENERIC_ERROR = 'Não foi possível concluir a operação. Tente novamente.';
export const NETWORK_ERROR = 'Sem conexão com o servidor. Verifique sua internet.';

export function toUserMessage(error: unknown, context = 'operação'): string {
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  logger.error(`Falha em ${context}`, { code: e.code, status: e.status, message: e.message });
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
