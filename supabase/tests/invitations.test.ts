import { afterAll, describe, expect, it } from 'vitest';
import { asAnon, createHousehold, createUser, pool, sqlState } from './helpers';
import { one, q } from './finance-helpers';

afterAll(async () => {
  await pool.end();
});

const invite = (user: string, householdId: string, role = 'member', days = 7) =>
  one<{ invitation_id: string; code: string; expires_at: string }>(
    user,
    'select * from public.create_household_invitation($1, $2, $3)',
    [householdId, role, days],
  );
const accept = (user: string, code: string) => q(user, 'select * from public.accept_household_invitation($1)', [code]);
const roleOf = async (householdId: string, userId: string) =>
  (await pool.query('select role from public.household_members where household_id = $1 and user_id = $2', [householdId, userId]))
    .rows[0]?.role as string | undefined;

describe('Convites para o espaço familiar', () => {
  it('owner convida; a esposa entra com a própria conta e passa a ver o espaço', async () => {
    const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    const inv = await invite(chefe, fam.id);
    expect(inv.code).toMatch(/^[0-9A-F]{32}$/);
    const [joined] = await accept(esposa, inv.code);
    expect((joined as { id: string }).id).toBe(fam.id);
    expect(await roleOf(fam.id, esposa)).toBe('member');
    const visible = await q<{ id: string }>(esposa, 'select id from public.households');
    expect(visible.map((r) => r.id)).toContain(fam.id);
  });

  it('o código aceita minúsculas e hífens, é de uso único e só o hash é guardado', async () => {
    const [chefe, a, b] = await Promise.all([createUser(), createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    const inv = await invite(chefe, fam.id);
    const typed = inv.code.toLowerCase().replace(/(.{4})/g, '$1-');
    await accept(a, typed);
    expect(await sqlState(accept(b, inv.code))).toBe('P0002');
    const stored = await pool.query('select token_hash from public.household_invitations where id = $1', [inv.invitation_id]);
    expect(stored.rows[0].token_hash).not.toContain(inv.code);
  });

  it('código inválido, expirado ou revogado recebe a mesma recusa', async () => {
    const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    expect(await sqlState(accept(esposa, 'CODIGOINEXISTENTE'))).toBe('P0002');

    const expired = await invite(chefe, fam.id);
    await pool.query("update public.household_invitations set created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = $1", [
      expired.invitation_id,
    ]);
    expect(await sqlState(accept(esposa, expired.code))).toBe('P0002');

    const revoked = await invite(chefe, fam.id);
    await q(chefe, 'select public.revoke_household_invitation($1)', [revoked.invitation_id]);
    expect(await sqlState(accept(esposa, revoked.code))).toBe('P0002');
    expect(await roleOf(fam.id, esposa)).toBeUndefined();
  });

  it('member e viewer não convidam; admin não convida admin; ninguém convida owner', async () => {
    const [chefe, member, admin] = await Promise.all([createUser(), createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    await accept(member, (await invite(chefe, fam.id, 'member')).code);
    await accept(admin, (await invite(chefe, fam.id, 'admin')).code);
    expect(await sqlState(invite(member, fam.id, 'viewer'))).toBe('42501');
    expect(await sqlState(invite(admin, fam.id, 'admin'))).toBe('42501');
    expect(await sqlState(invite(chefe, fam.id, 'owner'))).toBe('42501');
    expect((await invite(admin, fam.id, 'viewer')).code).toBeTruthy();
  });

  it('espaço pessoal não admite convite e estranho não convida', async () => {
    const [chefe, stranger] = await Promise.all([createUser(), createUser()]);
    const personal = await createHousehold(chefe, 'Pessoal', 'personal');
    const fam = await createHousehold(chefe, 'Família', 'family');
    expect(await sqlState(invite(chefe, personal.id))).toBe('23514');
    expect(await sqlState(invite(stranger, fam.id))).toBe('42501');
  });

  it('quem já é membro não aceita de novo; validade fora de 1–30 dias é recusada', async () => {
    const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    await accept(esposa, (await invite(chefe, fam.id)).code);
    expect(await sqlState(accept(esposa, (await invite(chefe, fam.id)).code))).toBe('23505');
    expect(await sqlState(invite(chefe, fam.id, 'member', 0))).toBe('22023');
    expect(await sqlState(invite(chefe, fam.id, 'member', 31))).toBe('22023');
  });

  it('só owner/admin listam convites e ninguém lê o hash', async () => {
    const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    await accept(esposa, (await invite(chefe, fam.id)).code);
    await invite(chefe, fam.id);
    expect((await q(chefe, 'select id from public.household_invitations where household_id = $1', [fam.id])).length).toBe(2);
    expect(await q(esposa, 'select id from public.household_invitations where household_id = $1', [fam.id])).toEqual([]);
    expect(await sqlState(q(chefe, 'select token_hash from public.household_invitations'))).toBe('42501');
  });

  it('anon não aceita convites; auditoria registra criação e aceite', async () => {
    const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    const inv = await invite(chefe, fam.id);
    expect(await sqlState(asAnon((db) => db.query('select public.accept_household_invitation($1)', [inv.code])))).toBe('42501');
    await accept(esposa, inv.code);
    const actions = (
      await pool.query('select action from app_private.audit_events where household_id = $1 order by id', [fam.id])
    ).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['household_invitation.created', 'household_invitation.accepted']));
  });

  it('lista membros com nome de exibição e o perfil é atualizado pelo próprio usuário', async () => {
    const [chefe, esposa, stranger] = await Promise.all([createUser(), createUser(), createUser()]);
    const fam = await createHousehold(chefe, 'Família', 'family');
    await accept(esposa, (await invite(chefe, fam.id)).code);
    await q(esposa, 'select public.update_my_profile($1)', ['Esposa']);
    const members = await q<{ user_id: string; role: string; display_name: string | null }>(
      chefe,
      'select * from public.list_household_members($1)',
      [fam.id],
    );
    expect(members.map((m) => m.role)).toEqual(['owner', 'member']);
    expect(members.find((m) => m.user_id === esposa)?.display_name).toBe('Esposa');
    expect(await q(stranger, 'select * from public.list_household_members($1)', [fam.id])).toEqual([]);
    expect(await sqlState(q(esposa, 'select public.update_my_profile($1)', ['x'.repeat(81)]))).toBe('23514');
  });
});
