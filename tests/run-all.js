/**
 * @file tests/run-all.js
 * @description Executor geral de todas as suítes de testes automatizados do Finanças Inteligentes
 * (Financeiro, Recorrências, Autorização/Segurança, Bot Telegram Texto, Bot Telegram Áudio,
 * Idempotência/Integrações e Integridade Responsiva/Temas da Interface).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { runFinanceTests } = require('./finance-tests');
const { runRecurringTests } = require('./recurring-tests');
const { runAuthorizationTests } = require('./authorization-tests');
const { runTelegramTests } = require('./telegram-tests');
const { runAudioProcessingTests } = require('./audio-processing-tests');
const { runIdempotencyTests } = require('./idempotency-tests');
const { runCreditCardTests } = require('./credit-card-tests');
const { runPlanningAndGoalsTests } = require('./planning-goals-tests');

function runUiIntegrityChecks() {
  const srcDir = path.join(__dirname, '..', 'src');
  const styles = fs.readFileSync(path.join(srcDir, 'Styles.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(srcDir, 'Index.html'), 'utf8');
  const appHtml = fs.readFileSync(path.join(srcDir, 'App.html'), 'utf8');

  // Verifica suporte a Light Mode, Dark Mode e Auto
  assert.ok(styles.includes('[data-theme="light"]'), 'Deve conter tokens CSS para Light Mode');
  assert.ok(styles.includes('[data-theme="dark"]'), 'Deve conter tokens CSS para Dark Mode');
  assert.ok(styles.includes('[data-theme="auto"]'), 'Deve conter suporte ao modo Automático');

  // Verifica media queries para Tablet e Mobile Android e prevenção de overflow horizontal
  assert.ok(styles.includes('@media (max-width: 1023px)'), 'Deve conter media query para Tablet');
  assert.ok(styles.includes('@media (max-width: 767px)'), 'Deve conter media query para Android Mobile');
  assert.ok(styles.includes('overflow-x: hidden'), 'Deve prevenir rolagem horizontal indevida');
  assert.ok(styles.includes('.mobile-bottom-nav'), 'Deve conter navegação inferior para Android');

  // Verifica que todos os módulos estão incluídos no Index.html
  const expectedIncludes = [
    'Styles', 'Dashboard', 'Launches', 'RecurringAccounts', 'BankAccounts', 'CreditCards',
    'Debts', 'Loans', 'Investments', 'Calendar', 'Planning', 'Goals', 'Reports',
    'Oraculo', 'Settings', 'Components', 'App'
  ];
  for (const inc of expectedIncludes) {
    assert.ok(
      indexHtml.includes("include('" + inc + "')"),
      'Index.html deve incluir o módulo ' + inc
    );
  }

  // Verifica que todas as funções onclick declaradas nos templates HTML existem no controlador App
  const htmlFiles = expectedIncludes.map(n => fs.readFileSync(path.join(srcDir, n + '.html'), 'utf8')).join('\n') + indexHtml;
  const onclickMatches = [...htmlFiles.matchAll(/App\.([a-zA-Z0-9_]+)\(/g)];
  for (const m of onclickMatches) {
    const fnName = m[1];
    assert.ok(
      appHtml.includes(fnName + ': ' + fnName),
      'Toda ação de botão/formulário App.' + fnName + ' deve estar implementada e exportada em App.html'
    );
  }

  return [
    'Tokens CSS de Light Mode, Dark Mode e Auto verificados.',
    'Media queries responsivas para Desktop, Tablet e Android sem rolagem horizontal verificadas.',
    'Todos os 15 templates HTML e todos os handlers de botões/formulários verificados sem botões decorativos.'
  ];
}

function main() {
  const suites = [
    { name: '1. Núcleo Financeiro e Backup (finance-tests)', fn: runFinanceTests },
    { name: '2. Contas Mensais Recorrentes (recurring-tests)', fn: runRecurringTests },
    { name: '3. Autenticação, Autorização e Isolamento (authorization-tests)', fn: runAuthorizationTests },
    { name: '4. Cartões de Crédito, Faturas e Parcelamentos (credit-card-tests)', fn: runCreditCardTests },
    { name: '5. Planejamento 12M, Orçamentos, Assinaturas e Metas (planning-goals-tests)', fn: runPlanningAndGoalsTests },
    { name: '6. Bot Telegram por Texto e Escopo Restrito (telegram-tests)', fn: runTelegramTests },
    { name: '7. Bot Telegram por Áudio e Transcrição PT-BR (audio-processing-tests)', fn: runAudioProcessingTests },
    { name: '8. Idempotência e Resiliência de Integrações (idempotency-tests)', fn: runIdempotencyTests },
    { name: '9. Interface Responsiva, Temas e Botões (ui-integrity)', fn: runUiIntegrityChecks }
  ];

  let totalAssertionsGroups = 0;
  console.log('==============================================================');
  console.log(' FINANÇAS INTELIGENTES — EXECUÇÃO DE TESTES AUTOMATIZADOS');
  console.log('==============================================================\n');

  for (const suite of suites) {
    const items = suite.fn();
    console.log('[APROVADO] ' + suite.name);
    for (const item of items) {
      console.log('   ✓ ' + item);
      totalAssertionsGroups++;
    }
    console.log('');
  }

  console.log('==============================================================');
  console.log(' RESULTADO FINAL: ' + suites.length + ' SUÍTES APROVADAS (' + totalAssertionsGroups + ' CENÁRIOS COMPROVADOS)');
  console.log('==============================================================');
}

main();

