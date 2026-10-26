import { describe, expect, it } from 'vitest';
import {
  ImportFormatError,
  csvToLines,
  decodeStatement,
  fillExternalIds,
  guessCsvMapping,
  parseAmountToCents,
  parseCsvTable,
  parseDate,
  parseOfx,
  parseOfxAmount,
} from './parsers';

describe('parseAmountToCents', () => {
  it.each([
    ['1.234,56', 123456],
    ['-1.234,56', -123456],
    ['1234.56', 123456],
    ['1,234.56', 123456],
    ['R$ 10', 1000],
    ['0,5', 50],
    ['(12,00)', -1200],
    ['12,30-', -1230],
    ['12,30 D', -1230],
    ['12,30 C', 1230],
    ['-12.340', -1234000],
    ['1.000', 100000],
    ['+7,01', 701],
  ])('%s → %i centavos', (raw, expected) => {
    expect(parseAmountToCents(raw)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '12.345,6.7', '1.23.4', '12,345'])('rejeita "%s"', (raw) => {
    // "12,345" tem 3 casas decimais significativas: ambíguo, recusado.
    expect(parseAmountToCents(raw)).toBeNull();
  });

  it('não perde precisão onde o ponto flutuante perderia', () => {
    expect(parseAmountToCents('0,29')).toBe(29);
    expect(parseAmountToCents('1.005,07')).toBe(100507);
  });
});

describe('parseOfxAmount', () => {
  it('usa ponto ou vírgula como decimal, sem milhar', () => {
    expect(parseOfxAmount('-12.340')).toBe(-1234);
    expect(parseOfxAmount('5000,00')).toBe(500000);
    expect(parseOfxAmount('10')).toBe(1000);
    expect(parseOfxAmount('1.234,56')).toBeNull();
    expect(parseOfxAmount('-12.345')).toBeNull();
  });
});

describe('parseDate', () => {
  it('aceita formatos brasileiros e ISO', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('5/3/26')).toBe('2026-03-05');
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('05-03-2026')).toBe('2026-03-05');
  });

  it('rejeita datas inexistentes ou em outro formato', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('03/2026')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260302120000[-3:BRT]<TRNAMT>-123.45<FITID>A1<MEMO>MERCADO &amp; CIA
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260305<TRNAMT>5000,00<FITID>A2<NAME>EMPRESA<MEMO>SALARIO MARCO
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260231<TRNAMT>-1.00<FITID>A3<MEMO>DATA RUIM
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260306<TRNAMT>abc<FITID>A4<MEMO>VALOR RUIM
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
  it('lê OFX SGML com valores em ponto e vírgula, entidades e identificadores', () => {
    const lines = parseOfx(OFX_SGML);
    expect(lines[0]!.row).toEqual({ occurred_on: '2026-03-02', amount_cents: -12345, description: 'MERCADO & CIA', external_id: 'ofx:A1' });
    expect(lines[1]!.row).toEqual({ occurred_on: '2026-03-05', amount_cents: 500000, description: 'EMPRESA — SALARIO MARCO', external_id: 'ofx:A2' });
    expect(lines[2]!.error).toBe('Data inválida');
    expect(lines[3]!.error).toBe('Valor inválido');
  });

  it('lê OFX 2 (XML) com tags de fechamento', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><OFX><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260310</DTPOSTED><TRNAMT>-9.90</TRNAMT><FITID>X9</FITID><MEMO>Café</MEMO></STMTTRN>
    </BANKTRANLIST></OFX>`;
    expect(parseOfx(xml)[0]!.row).toEqual({ occurred_on: '2026-03-10', amount_cents: -990, description: 'Café', external_id: 'ofx:X9' });
  });

  it('recusa arquivo que não é OFX ou sem transações', () => {
    expect(() => parseOfx('data;valor\n01/01/2026;10')).toThrow(ImportFormatError);
    expect(() => parseOfx('<OFX></OFX>')).toThrow('Nenhuma transação');
  });

  it('decodifica Windows-1252 quando o arquivo não é UTF-8', () => {
    const bytes = new Uint8Array([0x3c, 0x4f, 0x46, 0x58, 0x3e, 0x43, 0x61, 0x66, 0xe9]); // "<OFX>Café" em 1252
    expect(decodeStatement(bytes.buffer)).toBe('<OFX>Café');
  });
});

describe('CSV', () => {
  const csv = '\uFEFFData;Descrição;Valor\n01/03/2026;"Padaria; centro";-12,50\n02/03/2026;Salário;3.000,00\n\n31/02/2026;Erro;1,00\n';

  it('detecta separador, respeita aspas e ignora linhas vazias', () => {
    const table = parseCsvTable(csv);
    expect(table).toHaveLength(4);
    expect(table[1]).toEqual(['01/03/2026', 'Padaria; centro', '-12,50']);
  });

  it('sugere o mapeamento pelo cabeçalho e converte as linhas', () => {
    const table = parseCsvTable(csv);
    const mapping = guessCsvMapping(table[0]!);
    expect(mapping).toEqual({ date: 0, description: 1, amount: 2, invertSign: false });
    const lines = csvToLines(table, mapping);
    expect(lines[0]!.row).toMatchObject({ occurred_on: '2026-03-01', amount_cents: -1250, description: 'Padaria; centro' });
    expect(lines[1]!.row?.amount_cents).toBe(300000);
    expect(lines[2]).toEqual({ source: 4, error: 'Data inválida' });
    expect(csvToLines(table, { ...mapping, invertSign: true })[0]!.row?.amount_cents).toBe(1250);
  });

  it('recusa CSV malformado ou sem dados', () => {
    expect(() => parseCsvTable('Data;Valor\n"01/03/2026;10')).toThrow('aspas');
    expect(() => parseCsvTable('Data;Valor\n')).toThrow('cabeçalho');
    expect(() => parseCsvTable('apenas texto')).toThrow(ImportFormatError);
  });

  it('gera identificadores estáveis e distingue lançamentos idênticos no mesmo arquivo', async () => {
    const table = parseCsvTable('Data;Descrição;Valor\n01/03/2026;Café;-5,00\n01/03/2026;Café;-5,00\n');
    const lines = csvToLines(table, guessCsvMapping(table[0]!));
    const a = await fillExternalIds(lines, 'csv');
    const b = await fillExternalIds(lines, 'csv');
    expect(a[0]!.row!.external_id).toMatch(/^csv:[0-9a-f]{40}$/);
    expect(a[0]!.row!.external_id).not.toBe(a[1]!.row!.external_id);
    expect(a.map((l) => l.row!.external_id)).toEqual(b.map((l) => l.row!.external_id));
  });
});
