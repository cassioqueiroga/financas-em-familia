import { describe, expect, it } from 'vitest';
import { isPrivilegedKey, parseConfig } from './env';

function fakeJwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.assinatura-de-teste`;
}

const valid = {
  VITE_APP_ENV: 'development',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }),
};

describe('parseConfig', () => {
  it('aceita configuração de desenvolvimento válida', () => {
    const result = parseConfig(valid);
    expect(result).toEqual({
      ok: true,
      config: {
        environment: 'development',
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseAnonKey: valid.VITE_SUPABASE_ANON_KEY,
      },
    });
  });

  it('aponta todas as variáveis obrigatórias ausentes', () => {
    const result = parseConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.variable).sort()).toEqual([
      'VITE_APP_ENV',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_URL',
    ]);
  });

  it('rejeita ambiente desconhecido', () => {
    const result = parseConfig({ ...valid, VITE_APP_ENV: 'local' });
    expect(result.ok).toBe(false);
  });

  it('rejeita chave service_role (JWT) no frontend', () => {
    const result = parseConfig({ ...valid, VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role' }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.variable).toBe('VITE_SUPABASE_ANON_KEY');
  });

  it('rejeita chave secreta no novo formato sb_secret_', () => {
    const result = parseConfig({ ...valid, VITE_SUPABASE_ANON_KEY: 'sb_secret_000000000000000000000000' });
    expect(result.ok).toBe(false);
  });

  it('aceita chave publicável no novo formato sb_publishable_', () => {
    const result = parseConfig({ ...valid, VITE_SUPABASE_ANON_KEY: 'sb_publishable_000000000000000000000' });
    expect(result.ok).toBe(true);
  });

  it('exige HTTPS fora de desenvolvimento', () => {
    expect(parseConfig({ ...valid, VITE_APP_ENV: 'production' }).ok).toBe(false);
    expect(
      parseConfig({ ...valid, VITE_APP_ENV: 'production', VITE_SUPABASE_URL: 'https://exemplo.supabase.co' }).ok,
    ).toBe(true);
  });

  it('não inclui o valor das variáveis nas mensagens de erro', () => {
    const secret = fakeJwt({ role: 'service_role', marcador: 'NAO-VAZAR' });
    const result = parseConfig({ ...valid, VITE_SUPABASE_ANON_KEY: secret });
    expect(JSON.stringify(result)).not.toContain('NAO-VAZAR');
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('isPrivilegedKey', () => {
  it('não marca chave anon nem textos inválidos', () => {
    expect(isPrivilegedKey(fakeJwt({ role: 'anon' }))).toBe(false);
    expect(isPrivilegedKey('nao-e-jwt')).toBe(false);
    expect(isPrivilegedKey('a.%%%.c')).toBe(false);
  });
});
