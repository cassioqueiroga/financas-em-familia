import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/StatusViews';

export function HomePage() {
  return (
    <section aria-labelledby="titulo-inicio" className="space-y-4">
      <h1 id="titulo-inicio" className="text-2xl font-bold text-brand-900">
        Início
      </h1>
      <EmptyState
        title="Nenhum dado financeiro ainda"
        description="Contas, lançamentos e relatórios serão disponibilizados nas próximas fases. Comece organizando seus espaços."
        action={
          <Link to="/espacos" className="rounded-lg bg-brand-900 px-4 py-2 text-sm font-semibold text-white">
            Ver espaços
          </Link>
        }
      />
    </section>
  );
}
