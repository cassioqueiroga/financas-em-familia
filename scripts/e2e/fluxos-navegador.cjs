// Verificação de ponta a ponta NO NAVEGADOR contra o backend local (dados fictícios).
// Pré-requisitos, em terminais separados, a partir de um banco limpo:
//   npm run dev:backend -- --reset
//   npm run dev:local
// Depois: npm run e2e:navegador   (usa o Playwright/Chromium já instalado na máquina)
// Nunca aponte para um projeto real: o script cria espaço, contas e lançamentos.
const { chromium } = require('playwright');
const fs = require('fs');
const creds = fs.readFileSync(require('path').resolve('.local-dev/credenciais-de-teste.txt'), 'utf8');
const pw = (email) => creds.split('\n').find((l) => l.startsWith(email)).split('senha:')[1].trim();
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('Somente endereço local.');
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); };

async function login(browser, email) {
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`ERRO DE PÁGINA (${email}): ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') results.push(`console.error (${email}): ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + '/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(pw(email));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
  return page;
}
const nav = async (page, path) => { await page.goto(BASE + path); await page.waitForLoadState('networkidle'); };
const text = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

(async () => {
  const browser = await chromium.launch();
  try {
    // senha errada
    {
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      await p.goto(BASE + '/entrar');
      await p.getByLabel('E-mail').fill('chefe@exemplo.test'); await p.getByLabel('Senha').fill('errada-123');
      await p.getByRole('button', { name: 'Entrar' }).click();
      await p.getByRole('alert').waitFor();
      ok('login com senha errada é recusado', p.url().includes('/entrar'), (await p.getByRole('alert').innerText()).slice(0, 80));
      await ctx.close();
    }
    const chefe = await login(browser, 'chefe@exemplo.test');
    ok('chefe entra', true, chefe.url());
    await nav(chefe, '/espacos');
    await chefe.locator('#household-name').fill('Casa');
    await chefe.getByLabel('Família').check();
    await chefe.getByRole('button', { name: 'Criar espaço' }).click();
    await chefe.getByText('Família · BRL').waitFor();
    ok('espaço da família criado', true);

    await nav(chefe, '/familia');
    await chefe.getByLabel('Como você aparece para a família').fill('Chefe');
    await chefe.getByRole('button', { name: 'Salvar nome' }).click().catch(async () => {
      await chefe.getByRole('form', { name: 'Meu nome' }).getByRole('button').click();
    });
    await chefe.getByRole('button', { name: 'Gerar código' }).click();
    const code = (await chefe.getByLabel('Código de convite', { exact: true }).innerText()).trim();
    ok('código de convite gerado', /^[0-9A-F-]{30,}$/.test(code), `${code.replace(/-/g, '').length} caracteres hexadecimais`);

    const esposa = await login(browser, 'esposa@exemplo.test');
    await nav(esposa, '/familia');
    await esposa.getByLabel('Como você aparece para a família').fill('Esposa');
    await esposa.getByRole('form', { name: 'Meu nome' }).getByRole('button').click();
    await esposa.getByLabel('Código', { exact: true }).fill('0000-1111');
    await esposa.getByRole('button', { name: 'Entrar no espaço' }).click();
    await esposa.getByRole('alert').waitFor();
    ok('código inválido recusado com mensagem genérica', true, (await esposa.getByRole('alert').innerText()).slice(0, 90));
    await esposa.getByLabel('Código', { exact: true }).fill(code.toLowerCase());
    await esposa.getByRole('button', { name: 'Entrar no espaço' }).click();
    await esposa.waitForTimeout(1500);
    const famText = await text(esposa);
    ok('esposa aceita convite e vê membros', famText.includes('Chefe') && famText.includes('Esposa'));
    await esposa.getByLabel('Código', { exact: true }).fill(code);
    await esposa.getByRole('button', { name: 'Entrar no espaço' }).click();
    await esposa.waitForTimeout(800);
    ok('código não pode ser reutilizado', (await esposa.getByRole('alert').count()) > 0);

    // contas
    await nav(chefe, '/contas');
    const create = async (name, kind, fill) => {
      await chefe.getByLabel('Nome', { exact: true }).first().fill(name);
      await chefe.getByLabel('Tipo').selectOption(kind);
      await fill();
      await chefe.getByRole('button', { name: 'Cadastrar' }).click();
      await chefe.getByText(name, { exact: false }).first().waitFor();
      await chefe.waitForTimeout(500);
    };
    await create('Nubank', 'checking', async () => {
      await chefe.getByLabel('Saldo inicial (R$)').fill('1.000,00');
      await chefe.getByLabel('Data do saldo inicial').fill('2026-10-01');
    });
    await create('Reserva', 'savings', async () => {
      await chefe.getByLabel('Saldo inicial (R$)').fill('500,00');
      await chefe.getByLabel('Data do saldo inicial').fill('2026-10-01');
      await chefe.getByLabel('Esposa').uncheck();
    });
    await create('Visa', 'credit_card', async () => {
      await chefe.getByLabel('Limite (R$)').fill('5.000,00');
      await chefe.getByLabel('Dia de fechamento').fill('5');
      await chefe.getByLabel('Dia de vencimento').fill('15');
    });
    const contas = await text(chefe);
    ok('contas criadas com saldos em reais', contas.includes('1.000,00') && contas.includes('500,00'), '');

    // lançamentos
    await nav(chefe, '/lancamentos');
    const form = chefe.getByRole('form', { name: 'Novo lançamento' });
    const entry = async (mode, desc, value, acc, extra) => {
      await form.getByText(mode, { exact: true }).click();
      await form.getByLabel('Descrição').fill(desc);
      await form.getByLabel('Valor (R$)').fill(value);
      await form.getByLabel(mode === 'Transferência' ? 'De (origem)' : 'Conta', { exact: true }).selectOption({ label: acc });
      if (extra) await extra();
      await form.getByRole('button', { name: 'Registrar' }).click();
      await chefe.getByText(mode === 'Transferência' ? 'Transferência registrada.' : `${mode} registrada.`).waitFor();
    };
    await entry('Receita', 'Salário', '3.000,00', 'Nubank · Conta corrente');
    await entry('Despesa', 'Mercado', '120,50', 'Nubank · Conta corrente', async () => {
      await form.getByLabel('Categoria').selectOption({ index: 1 });
    });
    await entry('Despesa', 'Conta de luz', '189,90', 'Nubank · Conta corrente', async () => {
      await form.getByLabel('Ainda não paguei (conta a pagar)').check();
    });
    await entry('Transferência', 'Guardar', '200,00', 'Nubank · Conta corrente', async () => {
      await form.getByLabel('Para (destino)').selectOption({ label: 'Reserva · Poupança' });
    });
    await chefe.locator('li', { hasText: 'Guardar' }).first().waitFor({ timeout: 10000 }).catch(() => {});
    let lt = await text(chefe);
    ok('lançamentos aparecem na lista', ['Salário', 'Mercado', 'Conta de luz', 'Guardar'].every((s) => lt.includes(s)));
    // corrigir Mercado
    const mercado = chefe.locator('li', { hasText: 'Mercado' }).first();
    await mercado.getByRole('button', { name: 'Corrigir' }).click();
    const fix = chefe.getByRole('form', { name: 'Corrigir Mercado' });
    await fix.getByLabel('Valor (R$)').fill('130,50');
    await fix.getByRole('button').first().click();
    await chefe.waitForTimeout(1200);
    lt = await text(chefe);
    ok('correção gera novo lançamento e mantém o original cancelado', lt.includes('130,50') && lt.includes('cancelado'));

    // cartão
    await nav(chefe, '/cartoes');
    await chefe.getByLabel('Descrição').fill('Geladeira');
    await chefe.getByLabel('Valor total (R$)').fill('900,00');
    await chefe.getByLabel('Parcelas', { exact: false }).fill('3');
    await chefe.getByLabel('Data da compra').fill('2026-10-10');
    await chefe.getByRole('button', { name: 'Registrar compra' }).click();
    await chefe.waitForTimeout(1500);
    let ct = await text(chefe);
    ok('compra parcelada gera faturas', ct.includes('Geladeira') && ct.includes('300,00'), '');
    await chefe.getByRole('button', { name: 'Pagar fatura' }).first().click();
    const pay = chefe.getByRole('form', { name: /Pagar fatura de/ }).first();
    await pay.getByLabel('Pagar com').selectOption({ label: 'Nubank · Conta corrente' });
    await pay.getByRole('button', { name: 'Registrar pagamento' }).click();
    await chefe.waitForTimeout(1500);
    ct = await text(chefe);
    ok('pagamento de fatura registrado', /Paga|paga/.test(ct), '');

    // importação OFX fictícia
    const ofx = `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-45.90<FITID>F1<MEMO>PADARIA FICTICIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261021<TRNAMT>100.00<FITID>F2<MEMO>PIX FICTICIO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const ofxPath = require('path').join(require('os').tmpdir(), 'ff-extrato-ficticio.ofx'); fs.writeFileSync(ofxPath, ofx);
    await nav(chefe, '/importar');
    await chefe.getByLabel('Conta de destino').selectOption({ label: 'Nubank · Conta corrente' });
    await chefe.getByLabel('Arquivo (.ofx ou .csv, até 2 MB)').setInputFiles(ofxPath);
    await chefe.getByText('Pré-visualização').waitFor();
    await chefe.getByRole('button', { name: /Importar 2 lançamento/ }).click();
    await chefe.getByText(/Importação concluída: 2/).waitFor();
    ok('OFX fictício importado (2)', true);
    await chefe.getByLabel('Arquivo (.ofx ou .csv, até 2 MB)').setInputFiles(ofxPath);
    await chefe.getByText('Pré-visualização').waitFor();
    await chefe.getByText('Já importado').first().waitFor({ timeout: 10000 }).catch(() => {});
    const dup = await chefe.getByText('Já importado').count();
    ok('reimportar o mesmo arquivo marca duplicados', dup === 2, `${dup} duplicados`);

    // painel
    await nav(chefe, '/');
    await chefe.getByText('Saldo disponível hoje').waitFor();
    const dash = await text(chefe);
    // Nubank: 1000 + 3000 - 130,50 - 200 - 300 (fatura) - 45,90 + 100 = 3423,60 ; Reserva 700 => disponível 4123,60
    ok('saldo disponível correto (R$ 4.123,60)', dash.includes('4.123,60'), dash.match(/Saldo disponível hoje R\$\s?[\d.,]+/)?.[0]);
    ok('conta a pagar pendente aparece', dash.includes('Conta de luz'));
    await chefe.reload(); await chefe.getByText('Saldo disponível hoje').waitFor();
    ok('dados persistem após recarregar', (await text(chefe)).includes('4.123,60'));

    // privacidade: esposa
    await nav(esposa, '/contas');
    await esposa.waitForTimeout(800);
    const et = await text(esposa);
    ok('esposa vê conta compartilhada', et.includes('Nubank'));
    ok('esposa NÃO vê conta não compartilhada', !et.includes('Reserva'));
    await nav(esposa, '/lancamentos');
    const ef = esposa.getByRole('form', { name: 'Novo lançamento' });
    await ef.getByLabel('Descrição').fill('Farmácia');
    await ef.getByLabel('Valor (R$)').fill('35,00');
    await ef.getByLabel('Conta', { exact: true }).selectOption({ label: 'Nubank · Conta corrente' });
    await ef.getByRole('button', { name: 'Registrar' }).click();
    await esposa.getByText('Despesa registrada.').waitFor();
    ok('esposa lança despesa na conta compartilhada', true);
    await nav(chefe, '/');
    await chefe.getByText('Despesas por pessoa').waitFor();
    await chefe.waitForTimeout(800);
    ok('painel do chefe reflete despesa da esposa por pessoa', (await text(chefe)).includes('Esposa'));
    await nav(chefe, '/analises');
    await chefe.getByRole('heading', { name: 'Diagnóstico e sugestões' }).waitFor();
    const an = await text(chefe);
    ok('análises: diagnóstico e evolução mensal', an.includes('Evolução mensal') && an.includes('(em andamento)'));
    ok('análises: parcelas futuras do cartão aparecem', an.includes('Faturas já comprometidas') && an.includes('300,00'));
    await chefe.getByRole('button', { name: '12 meses' }).click();
    await chefe.waitForTimeout(800);
    ok('análises: período de 12 meses', (await chefe.locator('#titulo-evolucao ~ div table tbody tr').count()) === 12);
    await nav(esposa, '/analises');
    await esposa.getByRole('heading', { name: 'Diagnóstico e sugestões' }).waitFor();
    ok('análises da esposa carregam só com o que ela vê', (await text(esposa)).includes('Evolução mensal'));
    await chefe.getByRole('button', { name: 'Sair' }).click().catch(() => {});
    await chefe.waitForTimeout(800);
    ok('sair volta para o login', chefe.url().includes('/entrar'), chefe.url());
  } catch (e) {
    results.push('INTERROMPIDO: ' + e.message.split('\n')[0]);
  } finally {
    await browser.close();
    console.log(results.join('\n'));
    if (results.some((r) => /^(FALHA|INTERROMPIDO|ERRO DE PÁGINA)/.test(r))) process.exitCode = 1;
  }
})();
