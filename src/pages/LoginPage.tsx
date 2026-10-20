import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/StatusViews';
import { useAuth } from '@/features/auth/auth-context';
import { toUserMessage } from '@/lib/errors';

export function LoginPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    } catch (err) {
      setError(toUserMessage(err, 'login'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="titulo-entrar" className="mx-auto max-w-sm space-y-4">
      <h1 id="titulo-entrar" className="text-2xl font-bold text-brand-900">
        Entrar
      </h1>
      {error && <ErrorState message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm" noValidate>
        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            E-mail
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="w-full rounded-lg border border-ink/30 px-3 py-2" />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-ink/30 px-3 py-2"
          />
        </div>
        <Button type="submit" loading={submitting} className="w-full">
          Entrar
        </Button>
      </form>
    </section>
  );
}
