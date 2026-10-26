/**
 * Leitura de extratos OFX e CSV no navegador. O arquivo nunca é enviado ao
 * servidor: só as linhas normalizadas (data, valor em centavos com sinal,
 * descrição e identificador para deduplicação).
 *
 * Nada aqui usa ponto flutuante para dinheiro: os valores são convertidos de
 * texto decimal para centavos inteiros.
 */
import { isBusinessDate } from '@/lib/dates';
import type { ImportRow } from '@/features/finance/types';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5000;

export class ImportFormatError extends Error {
  override name = 'ImportFormatError';
}

export interface ParsedLine {
  /** Linha válida ou motivo da recusa local. */
  row?: ImportRow;
  error?: string;
  /** Número da linha/transação no arquivo, para o usuário localizar. */
  source: number;
}

/**
 * Converte valor monetário em texto para centavos inteiros. Aceita formatos
 * brasileiros e internacionais: "1.234,56", "-12,30", "1234.56", "R$ 10",
 * "(12,00)" (negativo), "12,30-" e "12,30 D" (débito).
 */
export function parseAmountToCents(raw: string): number | null {
  let text = raw.trim().replace(/R\$|\s/g, '');
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/[Dd]$/.test(text)) {
    negative = true;
    text = text.slice(0, -1);
  } else if (/[Cc]$/.test(text)) {
    text = text.slice(0, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let intPart: string;
  let frac = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const decimalChar = text[decimalAt]!;
    const rawInt = text.slice(0, decimalAt);
    if (rawInt.includes(decimalChar)) return null;
    intPart = rawInt.replace(/[.,]/g, '');
    frac = text.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    const pieces = text.split(',');
    if (pieces.length > 2) return null;
    intPart = pieces[0]!;
    frac = pieces[1] ?? '';
  } else if (lastDot >= 0) {
    const pieces = text.split('.');
    if (pieces.length === 2 && pieces[1]!.length !== 3) {
      intPart = pieces[0]!;
      frac = pieces[1]!;
    } else if (pieces.slice(1).every((p) => p.length === 3)) {
      intPart = pieces.join('');
    } else {
      return null;
    }
  } else {
    intPart = text;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  // Casas além da segunda só são aceitas se forem zeros (ex.: "12.340" de alguns OFX).
  if (frac.length > 2) {
    if (!/^0+$/.test(frac.slice(2))) return null;
    frac = frac.slice(0, 2);
  }
  const digits = `${intPart || '0'}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** No OFX o separador decimal é único (ponto ou vírgula) e não há milhar. */
export function parseOfxAmount(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  let frac = match[3] ?? '';
  if (frac.length > 2) {
    if (!/^0+$/.test(frac.slice(2))) return null;
    frac = frac.slice(0, 2);
  }
  const value = Number(`${match[2]}${frac.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(value)) return null;
  return match[1] === '-' ? -value : value;
}

/** Converte datas "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa" ou "aaaa-mm-dd" para AAAA-MM-DD. */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    return isBusinessDate(iso) ? iso : null;
  }
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
    const iso = `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
    return isBusinessDate(iso) ? iso : null;
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');
}

const normalizeSpaces = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Decodifica o arquivo respeitando o cabeçalho de charset do OFX (muitos bancos usam Windows-1252). */
export function decodeStatement(bytes: ArrayBuffer): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  if (/CHARSET:\s*(1252|ISO-?8859-?1)/i.test(head)) return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Lê transações (<STMTTRN>) de OFX 1.x (SGML) ou 2.x (XML). */
export function parseOfx(text: string): ParsedLine[] {
  if (!/<OFX>/i.test(text)) throw new ImportFormatError('O arquivo não parece ser um OFX válido (falta a marca <OFX>).');
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (blocks.length === 0) throw new ImportFormatError('Nenhuma transação encontrada no OFX.');
  if (blocks.length > MAX_ROWS) throw new ImportFormatError(`O arquivo tem mais de ${MAX_ROWS} transações.`);

  return blocks.map((block, i): ParsedLine => {
    const body = block.split(/<\/STMTTRN>/i)[0] ?? '';
    const field = (tag: string) => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(body);
      return m ? decodeEntities(m[1]!).trim() : '';
    };
    const source = i + 1;
    const date = /^(\d{4})(\d{2})(\d{2})/.exec(field('DTPOSTED'));
    const occurredOn = date ? `${date[1]}-${date[2]}-${date[3]}` : '';
    if (!isBusinessDate(occurredOn)) return { source, error: 'Data inválida' };
    const amount = parseOfxAmount(field('TRNAMT'));
    if (amount === null || amount === 0) return { source, error: 'Valor inválido' };
    const memo = normalizeSpaces(field('MEMO'));
    const name = normalizeSpaces(field('NAME'));
    const description = (memo && name && !memo.includes(name) ? `${name} — ${memo}` : memo || name || 'Sem descrição').slice(0, 120);
    const fitid = field('FITID');
    return {
      source,
      row: { occurred_on: occurredOn, amount_cents: amount, description, external_id: fitid ? `ofx:${fitid}`.slice(0, 200) : '' },
    };
  });
}

/** Divide CSV respeitando aspas. Detecta separador ; , ou tabulação. */
export function parseCsvTable(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((sep) => [sep, firstLine.split(sep).length - 1] as const);
  const separator = counts.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  if (counts.every(([, n]) => n === 0)) throw new ImportFormatError('Não foi possível identificar as colunas do CSV.');

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS + 1) throw new ImportFormatError(`O arquivo tem mais de ${MAX_ROWS} linhas.`);
    } else {
      field += ch;
    }
  }
  if (quoted) throw new ImportFormatError('CSV malformado: aspas sem fechamento.');
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new ImportFormatError('O CSV precisa de uma linha de cabeçalho e ao menos uma linha de dados.');
  return rows;
}

export interface CsvMapping {
  date: number;
  description: number;
  amount: number;
  /** Para extratos que mostram saídas como valores positivos. */
  invertSign: boolean;
}

/** Sugere o mapeamento pelos nomes do cabeçalho. */
export function guessCsvMapping(header: string[]): CsvMapping {
  const norm = header.map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
  const find = (re: RegExp, fallback: number) => {
    const idx = norm.findIndex((h) => re.test(h));
    return idx >= 0 ? idx : fallback;
  };
  return {
    date: find(/^data|date|dt/, 0),
    description: find(/descri|historico|lancamento|memo|estabelecimento|title|titulo/, 1),
    amount: find(/valor|amount|quantia|montante/, Math.min(2, header.length - 1)),
    invertSign: false,
  };
}

export function csvToLines(table: string[][], mapping: CsvMapping): ParsedLine[] {
  return table.slice(1).map((cells, i): ParsedLine => {
    const source = i + 2;
    const occurredOn = parseDate(cells[mapping.date] ?? '');
    if (!occurredOn) return { source, error: 'Data inválida' };
    const amount = parseAmountToCents(cells[mapping.amount] ?? '');
    if (amount === null || amount === 0) return { source, error: 'Valor inválido' };
    const description = normalizeSpaces(cells[mapping.description] ?? '').slice(0, 120) || 'Sem descrição';
    return { source, row: { occurred_on: occurredOn, amount_cents: mapping.invertSign ? -amount : amount, description, external_id: '' } };
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Preenche identificadores ausentes com um hash estável de data, valor,
 * descrição e ordem de ocorrência no arquivo. Assim duas compras iguais no
 * mesmo dia continuam distintas, e reimportar o mesmo arquivo não duplica.
 */
export async function fillExternalIds(lines: ParsedLine[], prefix: 'csv' | 'ofx'): Promise<ParsedLine[]> {
  const seen = new Map<string, number>();
  const out: ParsedLine[] = [];
  for (const line of lines) {
    if (!line.row || line.row.external_id) {
      out.push(line);
      continue;
    }
    const base = `${line.row.occurred_on}|${line.row.amount_cents}|${line.row.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ ...line, row: { ...line.row, external_id: `${prefix}:${(await sha256Hex(`${base}|${n}`)).slice(0, 40)}` } });
  }
  return out;
}
