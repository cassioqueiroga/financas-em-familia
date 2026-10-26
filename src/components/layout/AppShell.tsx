import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/auth-context';
import type { AppEnvironment } from '@/config/env';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:text-white'}`;

const NAV = [
  ['/', 'Início'],
  ['/lancamentos', 'Lançamentos'],
  ['/contas', 'Contas'],
  ['/cartoes', 'Cartões'],
  ['/importar', 'Importar'],
  ['/categorias', 'Categorias'],
  ['/familia', 'Família'],
  ['/espacos', 'Espaços'],
] as const;

export function AppShell({ environment, children }: { environment: AppEnvironment; children: ReactNode }) {
  const { state, signOut } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:p-2">
        Pular para o conteúdo
      </a>
      {environment !== 'production' && (
        <div className="bg-warning px-4 py-1 text-center text-xs font-semibold text-ink">
          Ambiente de {environment === 'development' ? 'desenvolvimento' : 'homologação'}: não use dados financeiros reais.
        </div>
      )}
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-bold tracking-tight">
            Finanças <span className="text-brand-500">em Família</span>
          </Link>
          {state.status === 'authenticated' && (
            <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'} className={navClass}>
                  {label}
                </NavLink>
              ))}
              <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => void signOut()}>
                Sair
              </Button>
            </nav>
          )}
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
