/**
 * Roteiro executável de validação real (Testes 1, 2, 3, 4, 5 e 6 via API).
 *
 * USO SOMENTE EM PROJETO SUPABASE DE DESENVOLVIMENTO, com usuários fictícios.
 * Ver docs/roteiro-validacao.md. Exemplo:
 *
 *   E2E_SUPABASE_URL=https://<ref>.supabase.co \
 *   E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
 *   E2E_PASSWORD='<senha dos usuários de teste>' \
 *   E2E_CONFIRM_NON_PRODUCTION=sim \
 *   npm run e2e:supabase
 *
 * O script usa somente a chave publicável e recusa chaves privilegiadas.
 * Cria espaços de teste (dados fictícios) e remove o vínculo do viewer no
 * Teste 5; rode supabase/e2e/seed-familia.sql de novo para restaurá-lo.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isPrivilegedKey } from '../../src/config/env.ts';

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'stranger';

interface Check {
  test: string;
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Check[] = [];

function check(test: string, name: string, ok: boolean, detail?: string) {
  results.push({ test, name, ok, ...(detail === undefined ? {} : { detail }) });
  console.warn(`${ok ? 'PASSOU' : 'FALHOU'}  [${test}] ${name}${detail ? ` (${detail})` : ''}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} ausente`);
  return value;
}

const url = requireEnv('E2E_SUPABASE_URL');
const key = requireEnv('E2E_SUPABASE_PUBLISHABLE_KEY');
const password = requireEnv('E2E_PASSWORD');
if (process.env.E2E_CONFIRM_NON_PRODUCTION !== 'sim') {
  throw new Error('Defina E2E_CONFIRM_NON_PRODUCTION=sim para confirmar que o projeto é de desenvolvimento');
}
if (isPrivilegedKey(key)) {
  throw new Error('Chave privilegiada recusada: use somente a chave publicável');
}

const emails: Record<Role, string> = {
  owner: process.env.E2E_EMAIL_OWNER ?? 'e2e-owner@exemplo.test',
  admin: process.env.E2E_EMAIL_ADMIN ?? 'e2e-admin@exemplo.test',
  member: process.env.E2E_EMAIL_MEMBER ?? 'e2e-member@exemplo.test',
  viewer: process.env.E2E_EMAIL_VIEWER ?? 'e2e-viewer@exemplo.test',
  stranger: process.env.E2E_EMAIL_STRANGER ?? 'e2e-stranger@exemplo.test',
};

const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

function newClient(target = url): SupabaseClient {
  return createClient(target, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(role: Role): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: emails[role], password });
  if (error) throw new Error(`Login de ${role} falhou: ${error.code ?? error.message}`);
  return client;
}

async function createHousehold(client: SupabaseClient, name: string, kind: 'personal' | 'family', idem = randomUUID()) {
  return client.rpc('create_household', { p_name: name, p_kind: kind, p_idempotency_key: idem });
}

async function householdIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from('households').select('id');
  if (error) throw error;
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function teste1() {
  const t = 'T1 autenticação';
  const wrong = await newClient().auth.signInWithPassword({ email: emails.owner, password: `${password}-errada` });
  check(t, 'senha incorreta é recusada', wrong.error?.code === 'invalid_credentials', wrong.error?.code);

  const client = await signIn('owner');
  const { data: user } = await client.auth.getUser();
  check(t, 'login devolve o usuário', user.user?.email === emails.owner);

  await client.auth.signOut();
  const { data: session } = await client.auth.getSession();
  check(t, 'logout encerra a sessão', session.session === null);
  const afterLogout = await client.from('households').select('id');
  check(t, 'após logout a API recusa os dados', afterLogout.error?.code === '42501', afterLogout.error?.code);

  const forged = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjF9.invalida' } },
  });
  const expired = await forged.from('households').select('id');
  check(t, 'token inválido/expirado é recusado com 401', expired.status === 401, `${expired.status} ${expired.error?.code ?? ''}`);

  const offline = await newClient('http://127.0.0.1:9').auth.signInWithPassword({ email: emails.owner, password });
  check(t, 'falha de conexão é identificável', offline.error?.name === 'AuthRetryableFetchError', offline.error?.name);
}

async function teste2(owner: SupabaseClient) {
  const t = 'T2 persistência';
  const name = `E2E ${runId} persistência`;
  const { data, error } = await createHousehold(owner, name, 'family');
  check(t, 'criação via RPC', !error && data?.name === name, error?.code);
  const fresh = await signIn('owner');
  check(t, 'espaço continua disponível em nova sessão', (await householdIds(fresh)).includes(data?.id));
  return data?.id as string;
}

async function teste3(ownerHouseholdId: string) {
  const t = 'T3 isolamento';
  const stranger = await signIn('stranger');
  const owner = await signIn('owner');
  const { data: ownerUser } = await owner.auth.getUser();

  check(t, 'estranho não lista o espaço', !(await householdIds(stranger)).includes(ownerHouseholdId));
  const byId = await stranger.from('households').select('*').eq('id', ownerHouseholdId);
  check(t, 'consulta direta por id volta vazia', !byId.error && byId.data?.length === 0);
  const members = await stranger.from('household_members').select('*').eq('household_id', ownerHouseholdId);
  check(t, 'membros do espaço alheio não aparecem', !members.error && members.data?.length === 0);
  const profile = await stranger.from('profiles').select('*').eq('id', ownerUser.user?.id ?? '');
  check(t, 'perfil do outro usuário não aparece', !profile.error && profile.data?.length === 0);
  const upd = await stranger.from('households').update({ name: 'Invasão' }).eq('id', ownerHouseholdId).select();
  check(t, 'alteração em espaço alheio não afeta linhas', !upd.error && upd.data?.length === 0, upd.error?.code);
  const ins = await stranger.from('households').insert({ name: 'Direto', kind: 'family', created_by: ownerUser.user?.id });
  check(t, 'inserção direta na tabela é recusada', ins.error?.code === '42501', ins.error?.code);
  const del = await stranger.from('households').delete().eq('id', ownerHouseholdId);
  check(t, 'exclusão direta é recusada', del.error?.code === '42501', del.error?.code);
  const rpc = await stranger.rpc('remove_household_member', { p_household_id: ownerHouseholdId, p_user_id: ownerUser.user?.id });
  check(t, 'RPC administrativa recusada para quem não é membro', rpc.error?.code === '42501', rpc.error?.code);
  const anon = await newClient().from('households').select('id');
  check(t, 'visitante anônimo não lê tabelas', anon.error?.code === '42501', anon.error?.code);
}

async function teste4e5() {
  const t4 = 'T4 permissões';
  const t5 = 'T5 revogação';
  const c = {
    owner: await signIn('owner'),
    admin: await signIn('admin'),
    member: await signIn('member'),
    viewer: await signIn('viewer'),
  };
  const ids: Record<string, string> = {};
  for (const [role, client] of Object.entries(c)) ids[role] = (await client.auth.getUser()).data.user?.id ?? '';

  const fam = await c.owner.from('households').select('id').eq('name', 'E2E Família').eq('kind', 'family').maybeSingle();
  if (!fam.data) {
    check(t4, 'espaço "E2E Família" encontrado (rode supabase/e2e/seed-familia.sql)', false);
    return;
  }
  const familyId = fam.data.id as string;
  const roster = await c.viewer.from('household_members').select('user_id, role').eq('household_id', familyId);
  if ((roster.data ?? []).length !== 4) {
    check(t4, 'família com owner, admin, member e viewer (rode supabase/e2e/seed-familia.sql)', false, `${roster.data?.length ?? 0} membros visíveis`);
    return;
  }

  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    const visible = (await householdIds(c[role])).includes(familyId);
    check(t4, `${role} vê o espaço familiar`, visible);
    const upd = await c[role].from('households').update({ name: 'E2E Família' }).eq('id', familyId).select('id');
    const allowed = role === 'owner' || role === 'admin';
    check(t4, `${role} ${allowed ? 'pode' : 'não pode'} alterar o espaço`, !upd.error && (upd.data?.length ?? 0) === (allowed ? 1 : 0), upd.error?.code);
  }

  const personal = await createHousehold(c.viewer, `E2E ${runId} pessoal do viewer`, 'personal');
  for (const role of ['owner', 'admin', 'member'] as const) {
    check(t4, `${role} não vê o espaço pessoal do viewer`, !(await householdIds(c[role])).includes(personal.data?.id));
  }
  const ownerOnPersonal = await c.owner.rpc('remove_household_member', { p_household_id: personal.data?.id, p_user_id: ids.viewer });
  check(t4, 'owner da família não administra o espaço pessoal do viewer', ownerOnPersonal.error?.code === '42501', ownerOnPersonal.error?.code);
  const adminRemovesOwner = await c.admin.rpc('remove_household_member', { p_household_id: familyId, p_user_id: ids.owner });
  check(t4, 'admin não remove o owner', adminRemovesOwner.error?.code === '42501', adminRemovesOwner.error?.code);
  const memberRemovesViewer = await c.member.rpc('remove_household_member', { p_household_id: familyId, p_user_id: ids.viewer });
  check(t4, 'member não remove outros membros', memberRemovesViewer.error?.code === '42501', memberRemovesViewer.error?.code);

  // Teste 5: admin revoga o viewer; a sessão já aberta do viewer perde o acesso.
  const revoke = await c.admin.rpc('remove_household_member', { p_household_id: familyId, p_user_id: ids.viewer });
  check(t5, 'admin revoga o vínculo do viewer', !revoke.error, revoke.error?.code);
  check(t5, 'viewer deixa de ver o espaço na mesma sessão', !(await householdIds(c.viewer)).includes(familyId));
  const members = await c.viewer.from('household_members').select('*').eq('household_id', familyId);
  check(t5, 'viewer deixa de ver os membros', !members.error && members.data?.length === 0);
  const again = await c.viewer.rpc('remove_household_member', { p_household_id: familyId, p_user_id: ids.member });
  check(t5, 'viewer revogado não executa ações no espaço', again.error?.code === '42501', again.error?.code);
  check(t5, 'viewer mantém o próprio espaço pessoal', (await householdIds(c.viewer)).includes(personal.data?.id));
}

async function teste6(owner: SupabaseClient) {
  const t = 'T6 idempotência';
  const key1 = randomUUID();
  const name = `E2E ${runId} idempotência`;
  const a = await createHousehold(owner, name, 'family', key1);
  const b = await createHousehold(owner, name, 'family', key1);
  check(t, 'repetição devolve o mesmo espaço', !a.error && a.data?.id === b.data?.id);
  const conflict = await createHousehold(owner, `${name} outro`, 'family', key1);
  check(t, 'mesma chave com outros dados é recusada', conflict.error?.code === '23505', conflict.error?.code);

  const key2 = randomUUID();
  const concName = `E2E ${runId} concorrente`;
  const parallel = await Promise.all(Array.from({ length: 5 }, () => createHousehold(owner, concName, 'family', key2)));
  const distinct = new Set(parallel.map((r) => r.data?.id));
  check(t, '5 requisições concorrentes geram um único espaço', distinct.size === 1 && parallel.every((r) => !r.error));
  const { data } = await owner.from('households').select('id').in('name', [name, concName]);
  check(t, 'sem duplicação no banco', data?.length === 2, `${data?.length ?? 0} registros`);
}

async function main() {
  console.warn(`Validação E2E ${runId} em ${new URL(url).host}`);
  await teste1();
  const owner = await signIn('owner');
  const householdId = await teste2(owner);
  await teste3(householdId);
  await teste4e5();
  await teste6(owner);

  const failed = results.filter((r) => !r.ok);
  console.warn(`\n${results.length - failed.length}/${results.length} verificações aprovadas`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error('Execução interrompida:', err instanceof Error ? err.message : 'erro desconhecido');
  process.exitCode = 2;
});
