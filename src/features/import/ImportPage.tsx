import { useState, type ChangeEvent } from 'react';
import { useServices } from '@/app/services';
import { Field, Select } from '@/components/form/Field';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState, SuccessState, WarningNotice } from '@/components/ui/StatusViews';
import { AccountOptions, PageHeader, SpaceGate, useIdempotencyKey, useWritableAccounts } from '@/features/finance/shared';
import { useFinance } from '@/features/finance/FinanceContext';
import type { ImportPreviewItem, ImportResult, ImportRow } from '@/features/finance/types';
import { formatBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import {
  ImportFormatError,
  MAX_FILE_BYTES,
  csvToLines,
  decodeStatement,
  fillExternalIds,
  guessCsvMapping,
  parseCsvTable,
  parseOfx,
  type CsvMapping,
  type ParsedLine,
} from './parsers';

const STATUS_LABEL: Record<ImportPreviewItem['status'], string> = {
  new: 'Novo',
  duplicate: 'Já importado',
  possible_duplicate: 'Possível duplicado',
  invalid: 'Inválido',
};

interface Prepared {
  source: 'ofx' | 'csv';
  lines: ParsedLine[];
  rows: ImportRow[];
  preview: ImportPreviewItem[];
  selected: Set<number>;
}

export function ImportPage() {
  return (
    <section aria-labelledby="titulo-importar" className="space-y-6">
      <PageHeader
        id="titulo-importar"
        title="Importar extrato"
        description="Arquivos OFX ou CSV baixados do banco. O arquivo é lido no seu navegador e nada é gravado antes da sua confirmação."
      />
      <SpaceGate>
        <Importer />
      </SpaceGate>
    </section>
  );
}

function Importer() {
  const { finance } = useServices();
  const { reload } = useFinance();
  const { accounts } = useWritableAccounts();
  const bankAccounts = accounts.filter((a) => a.kind !== 'credit_card');
  const [accountId, setAccountId] = useState('');
  const [csv, setCsv] = useState<{ table: string[][]; mapping: CsvMapping } | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const key = useIdempotencyKey();

  const reset = () => {
    setPrepared(null);
    setResult(null);
    setError(null);
  };

  async function prepare(source: 'ofx' | 'csv', lines: ParsedLine[]) {
    if (!accountId) return setError('Escolha primeiro a conta de destino.');
    setBusy(true);
    try {
      const filled = await fillExternalIds(lines, source);
      const valid = filled.filter((l) => l.row);
      const rows = valid.map((l) => l.row!);
      const preview = rows.length ? await finance.previewImport(accountId, rows) : [];
      setPrepared({ source, lines: filled, rows, preview, selected: new Set(preview.filter((p) => p.status === 'new').map((p) => p.index)) });
      key.renew();
    } catch (err) {
      setError(toUserMessage(err, 'pré-visualizar importação'));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    reset();
    setCsv(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError('Arquivo maior que 2 MB. Exporte um período menor.');
    try {
      const text = decodeStatement(await file.arrayBuffer());
      const isOfx = /\.(ofx|qfx)$/i.test(file.name) || /<OFX>/i.test(text.slice(0, 4096));
      if (isOfx) {
        await prepare('ofx', parseOfx(text));
      } else {
        const table = parseCsvTable(text);
        setCsv({ table, mapping: guessCsvMapping(table[0]!) });
      }
    } catch (err) {
      setError(err instanceof ImportFormatError ? err.message : 'Não foi possível ler o arquivo.');
    } finally {
      event.target.value = '';
    }
  }

  async function confirmImport() {
    if (!prepared) return;
    const rows = prepared.rows.filter((_, i) => prepared.selected.has(i));
    if (rows.length === 0) return setError('Selecione ao menos um lançamento.');
    setBusy(true);
    try {
      const r = await finance.importEntries(accountId, rows, prepared.source, key.current);
      key.renew();
      setResult(r);
      setPrepared(null);
      setCsv(null);
      await reload();
    } catch (err) {
      setError(toUserMessage(err, 'importar'));
    } finally {
      setBusy(false);
    }
  }

  if (bankAccounts.length === 0) {
    return <EmptyState title="Nenhuma conta disponível" description="Cadastre uma conta corrente, poupança ou carteira para importar extratos." />;
  }

  const localErrors = prepared?.lines.filter((l) => l.error) ?? [];
  return (
    <div className="space-y-6">
      <WarningNotice>
        Importe apenas extratos seus, baixados diretamente do banco. Compatibilidade testada com arquivos OFX 1.x/2.x e CSV com cabeçalho; cada banco pode
        ter variações, por isso confira a pré-visualização antes de confirmar.
      </WarningNotice>
      <div className="grid gap-4 rounded-xl bg-white p-6 shadow-sm sm:grid-cols-2">
        <Field id="import-conta" label="Conta de destino">
          <Select
            id="import-conta"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              reset();
            }}
          >
            <AccountOptions accounts={bankAccounts} />
          </Select>
        </Field>
        <Field id="import-arquivo" label="Arquivo (.ofx ou .csv, até 2 MB)">
          <input id="import-arquivo" type="file" accept=".ofx,.qfx,.csv,.txt,text/csv" onChange={(e) => void handleFile(e)} disabled={!accountId || busy} className="block min-h-11 w-full text-sm" />
        </Field>
      </div>
      {error && <ErrorState message={error} />}
      {busy && <LoadingState label="Processando…" />}
      {result && (
        <SuccessState
          message={`Importação concluída: ${result.imported} lançamento(s) importado(s), ${result.duplicates} já existiam e ${result.rejected} recusado(s).${result.replayed ? ' (Esta importação já tinha sido feita.)' : ''}`}
        />
      )}

      {csv && !prepared && (
        <section aria-labelledby="titulo-mapeamento" className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <h2 id="titulo-mapeamento" className="font-semibold">
            Colunas do CSV
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['date', 'Data'],
                ['description', 'Descrição'],
                ['amount', 'Valor'],
              ] as const
            ).map(([field, label]) => (
              <Field key={field} id={`map-${field}`} label={label}>
                <Select id={`map-${field}`} value={csv.mapping[field]} onChange={(e) => setCsv({ ...csv, mapping: { ...csv.mapping, [field]: Number(e.target.value) } })}>
                  {csv.table[0]!.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Coluna ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={csv.mapping.invertSign} onChange={(e) => setCsv({ ...csv, mapping: { ...csv.mapping, invertSign: e.target.checked } })} />
            O extrato mostra saídas como valores positivos (inverter sinal)
          </label>
          <Button onClick={() => void prepare('csv', csvToLines(csv.table, csv.mapping))} loading={busy}>
            Pré-visualizar
          </Button>
        </section>
      )}

      {prepared && (
        <section aria-labelledby="titulo-previa" className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <h2 id="titulo-previa" className="font-semibold">
            Pré-visualização
          </h2>
          <p className="text-sm text-ink/70">
            {prepared.rows.length} lançamento(s) lidos{localErrors.length ? `, ${localErrors.length} linha(s) ilegível(is) ignorada(s)` : ''}. Itens “Possível
            duplicado” parecem já ter sido lançados à mão: ficam desmarcados.
          </p>
          {localErrors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ink/70">
              {localErrors.slice(0, 10).map((l) => (
                <li key={l.source}>
                  Linha/transação {l.source}: {l.error}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Lançamentos a importar</caption>
              <thead>
                <tr className="border-b border-ink/15">
                  <th scope="col" className="p-2">
                    Importar
                  </th>
                  <th scope="col" className="p-2">
                    Data
                  </th>
                  <th scope="col" className="p-2">
                    Descrição
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Valor
                  </th>
                  <th scope="col" className="p-2">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody>
                {prepared.rows.map((row, i) => {
                  const p = prepared.preview[i];
                  const selectable = p && (p.status === 'new' || p.status === 'possible_duplicate');
                  return (
                    <tr key={row.external_id} className="border-b border-ink/5">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Importar ${row.description}`}
                          disabled={!selectable}
                          checked={prepared.selected.has(i)}
                          onChange={(e) => {
                            const selected = new Set(prepared.selected);
                            if (e.target.checked) selected.add(i);
                            else selected.delete(i);
                            setPrepared({ ...prepared, selected });
                          }}
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">{formatBusinessDate(row.occurred_on)}</td>
                      <td className="p-2">{row.description}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <Amount value={row.amount_cents} tone="signed" />
                      </td>
                      <td className="p-2">
                        {p ? STATUS_LABEL[p.status] : '—'}
                        {p?.reason ? ` (${p.reason})` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void confirmImport()} loading={busy}>
              Importar {prepared.selected.size} lançamento(s)
            </Button>
            <Button variant="secondary" onClick={reset}>
              Descartar
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
