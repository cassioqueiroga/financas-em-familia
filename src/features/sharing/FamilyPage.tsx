import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useServices } from '@/app/services';
import { Field, Select, TextInput } from '@/components/form/Field';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { ErrorState, SuccessState, WarningNotice } from '@/components/ui/StatusViews';
import { useAuth } from '@/features/auth/auth-context';
import { useFinance } from '@/features/finance/FinanceContext';
import { PageHeader } from '@/features/finance/shared';
import { formatBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { ROLE_LABEL, type CreatedInvitation, type Invitation } from './types';

export function FamilyPage() {
  const { sharing } = useServices();
  const { state } = useAuth();
  const { active, data, reload, reloadHouseholds, setActiveId } = useFinance();
  const me = state.status === 'authenticated' ? state.user.id : null;
  const myRole = data.members.find((m) => m.user_id === me)?.role;
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const householdId = active?.kind === 'family' && isAdmin ? active.id : null;
  const myName = data.members.find((m) => m.user_id === me)?.display_name ?? '';

  const loadInvitations = useCallback(
    () => (householdId ? sharing.listInvitations(householdId) : Promise.resolve([])),
    [sharing, householdId],
  );
  useEffect(() => {
    let alive = true;
    loadInvitations().then(
      (list) => alive && setInvitations(list),
      () => alive && setInvitations([]),
    );
    return () => {
      alive = false;
    };
  }, [loadInvitations]);

  const fail = (err: unknown, ctx: string) => {
    setNotice(null);
    setError(toUserMessage(err, ctx));
  };

  async function handleName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('display_name') ?? '').trim();
    if (name.length > 80) return setError('Use no máximo 80 caracteres.');
    try {
      await sharing.updateMyProfile(name);
      setError(null);
      setNotice('Nome atualizado.');
      await reload();
    } catch (err) {
      fail(err, 'atualizar nome');
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId) return;
    const role = new FormData(event.currentTarget).get('role') as 'admin' | 'member' | 'viewer';
    setBusy(true);
    try {
      setCreated(await sharing.createInvitation(householdId, role));
      setError(null);
      setInvitations(await loadInvitations());
    } catch (err) {
      fail(err, 'criar convite');
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const code = String(new FormData(formEl).get('code') ?? '').trim();
    if (!code) return setError('Cole o código recebido.');
    setBusy(true);
    try {
      const household = await sharing.acceptInvitation(code);
      formEl.reset();
      setError(null);
      setNotice(`Você entrou em “${household.name}”.`);
      await reloadHouseholds();
      setActiveId(household.id);
    } catch (err) {
      fail(err, 'aceitar convite');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="titulo-familia" className="space-y-6">
      <PageHeader id="titulo-familia" title="Família e acesso" description="Quem participa do espaço e como entrar no espaço da família." />
      {notice && <SuccessState message={notice} />}
      {error && <ErrorState message={error} />}

      <form onSubmit={handleName} noValidate className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-6 shadow-sm" aria-label="Meu nome">
        <Field id="meu-nome" label="Como você aparece para a família">
          <TextInput id="meu-nome" name="display_name" defaultValue={myName} key={myName} maxLength={80} />
        </Field>
        <Button type="submit" variant="secondary">
          Salvar nome
        </Button>
      </form>

      {active && (
        <section aria-labelledby="titulo-membros" className="rounded-xl bg-white p-6 shadow-sm">
          <h2 id="titulo-membros" className="mb-3 text-lg font-semibold">
            Membros de “{active.name}”
          </h2>
          <ul className="divide-y divide-ink/10">
            {data.members.map((m) => {
              const removable = m.user_id !== me && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && (m.role === 'member' || m.role === 'viewer')));
              const canLeave = m.user_id === me && m.role !== 'owner';
              return (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {m.display_name ?? 'Sem nome'}
                    {m.user_id === me && ' (você)'} · {ROLE_LABEL[m.role]}
                  </span>
                  {(removable || canLeave) && (
                    <ConfirmButton
                      label={canLeave ? 'Sair do espaço' : 'Remover'}
                      question={canLeave ? 'Sair? Você perde o acesso às contas compartilhadas.' : 'Remover? O acesso às contas compartilhadas acaba na hora.'}
                      confirmLabel="Sim"
                      onConfirm={async () => {
                        try {
                          await sharing.removeMember(active.id, m.user_id);
                          setError(null);
                          setNotice(canLeave ? 'Você saiu do espaço.' : 'Membro removido.');
                          if (canLeave) await reloadHouseholds();
                          else await reload();
                        } catch (err) {
                          fail(err, 'remover membro');
                        }
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {householdId && (
        <section aria-labelledby="titulo-convite" className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <h2 id="titulo-convite" className="text-lg font-semibold">
            Convidar para “{active?.name}”
          </h2>
          <p className="text-sm text-ink/70">
            Gere um código e envie para a pessoa por um canal privado. Ela entra com a própria conta e cola o código abaixo. Entrar no espaço não dá acesso
            às suas contas: cada conta é compartilhada separadamente.
          </p>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
            <Field id="convite-papel" label="Papel">
              <Select id="convite-papel" name="role" defaultValue="member">
                {myRole === 'owner' && <option value="admin">{ROLE_LABEL.admin}</option>}
                <option value="member">{ROLE_LABEL.member}</option>
                <option value="viewer">{ROLE_LABEL.viewer}</option>
              </Select>
            </Field>
            <Button type="submit" loading={busy}>
              Gerar código
            </Button>
          </form>
          {created && (
            <WarningNotice>
              <p className="font-semibold">Código de convite (aparece só agora):</p>
              <p className="mt-1 select-all break-all font-mono text-lg" aria-label="Código de convite">
                {created.code.replace(/(.{4})(?=.)/g, '$1-')}
              </p>
              <p className="mt-1 text-sm">Válido até {formatBusinessDate(created.expires_at)}. Uso único.</p>
            </WarningNotice>
          )}
          {invitations.length > 0 && (
            <ul className="divide-y divide-ink/10 text-sm">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {ROLE_LABEL[i.role]} · criado {formatBusinessDate(i.created_at)} ·{' '}
                    {i.accepted_at ? 'aceito' : i.revoked_at ? 'revogado' : new Date(i.expires_at) < new Date() ? 'expirado' : 'pendente'}
                  </span>
                  {!i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date() && (
                    <ConfirmButton
                      label="Revogar"
                      question="Revogar o convite?"
                      onConfirm={async () => {
                        try {
                          await sharing.revokeInvitation(i.id);
                          setInvitations(await loadInvitations());
                        } catch (err) {
                          fail(err, 'revogar convite');
                        }
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <form onSubmit={handleAccept} noValidate className="space-y-3 rounded-xl bg-white p-6 shadow-sm" aria-labelledby="titulo-aceitar">
        <h2 id="titulo-aceitar" className="text-lg font-semibold">
          Recebi um código de convite
        </h2>
        <Field id="convite-codigo" label="Código">
          <TextInput id="convite-codigo" name="code" autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="submit" loading={busy}>
          Entrar no espaço
        </Button>
      </form>
    </section>
  );
}
