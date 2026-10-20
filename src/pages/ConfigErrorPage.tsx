import type { ConfigIssue } from '@/config/env';

/** Exibida quando a configuração obrigatória é inválida. Mostra nomes, nunca valores. */
export function ConfigErrorPage({ issues }: { issues: ConfigIssue[] }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div role="alert" className="rounded-xl border-l-4 border-danger bg-white p-6">
        <h1 className="text-lg font-bold text-ink">Configuração incompleta</h1>
        <p className="mt-2 text-ink/80">
          O aplicativo não pode iniciar porque variáveis de ambiente obrigatórias estão ausentes ou inválidas. Consulte
          docs/ambientes.md.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          {issues.map((issue) => (
            <li key={`${issue.variable}-${issue.message}`}>
              <code className="font-mono">{issue.variable}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
