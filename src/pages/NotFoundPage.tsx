import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/StatusViews';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço acessado não existe."
      action={
        <Link to="/" className="font-semibold text-brand-900 underline">
          Voltar ao início
        </Link>
      }
    />
  );
}
