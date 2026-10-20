import { z } from 'zod';

/**
 * Configuração pública do frontend, validada na inicialização.
 *
 * Tudo que chega ao navegador é público. Aqui só podem existir a URL do
 * projeto Supabase e a chave publicável/anon (protegida por RLS). Chaves
 * privilegiadas (service_role / sb_secret_) são rejeitadas explicitamente.
 */
export const APP_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export interface AppConfig {
  environment: AppEnvironment;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; issues: ConfigIssue[] };

export interface ConfigIssue {
  variable: string;
  message: string;
}

function decodeJwtRole(key: string): string | undefined {
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload: unknown = JSON.parse(json);
    if (payload && typeof payload === 'object' && 'role' in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === 'string' ? role : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Retorna true se a chave aparenta ser privilegiada e nunca deve ir ao navegador. */
export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  return decodeJwtRole(key) === 'service_role';
}

const schema = z
  .object({
    VITE_APP_ENV: z.enum(APP_ENVIRONMENTS, {
      error: `Use um destes valores: ${APP_ENVIRONMENTS.join(', ')}`,
    }),
    VITE_SUPABASE_URL: z.url({ error: 'Informe uma URL válida (ex.: https://<projeto>.supabase.co)' }),
    VITE_SUPABASE_ANON_KEY: z
      .string({ error: 'Obrigatória' })
      .min(20, { error: 'Chave ausente ou curta demais' })
      .refine((key) => !isPrivilegedKey(key), {
        error: 'Chave privilegiada detectada. Use apenas a chave publicável (anon) no frontend.',
      }),
  })
  .superRefine((env, ctx) => {
    if (env.VITE_APP_ENV !== 'development' && !env.VITE_SUPABASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['VITE_SUPABASE_URL'],
        message: 'Homologação e produção exigem HTTPS',
      });
    }
  });

/** Valida um conjunto bruto de variáveis. Nunca inclui valores nas mensagens. */
export function parseConfig(raw: Record<string, unknown>): ConfigResult {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'desconhecida'),
        message: issue.message,
      })),
    };
  }
  return {
    ok: true,
    config: {
      environment: result.data.VITE_APP_ENV,
      supabaseUrl: result.data.VITE_SUPABASE_URL,
      supabaseAnonKey: result.data.VITE_SUPABASE_ANON_KEY,
    },
  };
}

let cached: ConfigResult | undefined;

/** Lê e valida `import.meta.env` uma única vez. */
export function loadConfig(): ConfigResult {
  cached ??= parseConfig({
    VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
  return cached;
}
