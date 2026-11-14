/**
 * @file tests/licensing-commercial-tests.js
 * @description Bateria de testes de homologação do sistema de licenciamento comercial,
 * período de avaliação de 14 dias, bloqueio estrito de escrita pós-expiração, preservação
 * de leitura/exportação, ativação por serial e proteção anti-clonagem de planilha.
 */

const assert = require('assert');
const { createGasContext } = require('./gas-mock-harness');

function runLicensingTests() {
  const ctx = createGasContext({ ownerEmail: 'comprador@gmail.com', activeUserEmail: 'comprador@gmail.com' });
  const results = [];

  // 1. Instalação nova gera Installation ID único e inicia em modo TRIAL/UNREGISTERED
  const initialInfo = ctx.LicenseService.getLicenseInfo();
  assert.strictEqual(initialInfo.ok, true, 'LicenseInfo deve retornar ok');
  assert.ok(initialInfo.installation_id && initialInfo.installation_id.startsWith('inst_'), 'Deve possuir installation_id no padrão inst_xxx');
  assert.strictEqual(initialInfo.can_write, true, 'Instalação nova deve permitir uso inicial');
  assert.strictEqual(initialInfo.can_read, true, 'Leitura deve estar sempre liberada');
  assert.strictEqual(initialInfo.can_export, true, 'Exportação deve estar sempre liberada');
  results.push('Identificador imutável de instalação (Installation ID) gerado com sucesso.');

  // 2. Início do Trial de 14 Dias
  const trialRes = ctx.LicenseService.startTrial('comprador@gmail.com');
  assert.strictEqual(trialRes.ok, true, 'startTrial deve retornar ok');
  assert.strictEqual(trialRes.license.status, 'TRIAL', 'Status deve ser TRIAL');
  assert.strictEqual(trialRes.license.trial_days_remaining, 14, 'Deve conter 14 dias restantes');
  results.push('Período de teste gratuito de 14 dias ativado com sucesso.');

  // 3. Durante o Trial: Operações de Escrita Financeira são permitidas
  const accRes = ctx.apiCall('bankAccounts.create', {
    instituicao: 'Nubank',
    nome_identificacao: 'Conta Digital',
    tipo_conta: 'CORRENTE',
    saldo_inicial_centavos: 50000,
    data_saldo_inicial: '2026-11-01'
  });
  assert.strictEqual(accRes.ok, true, 'Deve permitir criar conta durante o trial');

  const catRes = ctx.apiCall('categories.create', {
    nome: 'Receitas Gerais',
    tipo: 'ENTRADA'
  });
  assert.strictEqual(catRes.ok, true, 'Deve permitir criar categoria durante o trial');

  const lanRes = ctx.apiCall('launches.create', {
    tipo: 'ENTRADA',
    descricao: 'Salário de Teste',
    valor_centavos: 350000,
    data_lancamento: '2026-11-05',
    data_competencia: '2026-11-05',
    data_pagamento: '2026-11-05',
    categoria_id: catRes.data.id,
    conta_bancaria_id: accRes.data.id,
    situacao: 'CONFIRMADO',
    natureza_operacao: 'PADRAO'
  });
  assert.strictEqual(lanRes.ok, true, 'Deve permitir registrar lançamento financeiro durante o trial');
  results.push('Escrita de lançamentos e contas durante o período de teste validada.');

  // 4. Simulação de Expiração do Período de Teste (Dia 15)
  ctx.LicenseService.simulateLicenseState('EXPIRED');
  const expInfo = ctx.LicenseService.getLicenseInfo();
  assert.strictEqual(expInfo.status, 'EXPIRED', 'Status deve ser EXPIRED');
  assert.strictEqual(expInfo.can_write, false, 'Escrita deve ser bloqueada após expiração');
  assert.strictEqual(expInfo.can_read, true, 'Leitura DEVE continuar permitida');
  assert.strictEqual(expInfo.can_export, true, 'Exportação DEVE continuar permitida');

  // 5. Teste de Bloqueio de Escrita: Inclusão de novo gasto deve falhar com erro amigável
  const blockedLan = ctx.apiCall('launches.create', {
    tipo: 'SAIDA',
    descricao: 'Tentativa Pós-Expiração',
    valor_centavos: 5000,
    conta_bancaria_id: accRes.data.id
  });
  assert.strictEqual(blockedLan.ok, false, 'Inclusão deve falhar quando a licença estiver expirada');
  assert.ok(blockedLan.error.includes('OPERACAO_BLOQUEADA_EXPIRADO'), 'Erro deve ser do tipo OPERACAO_BLOQUEADA_EXPIRADO');
  results.push('Bloqueio estrito de novas inclusões após término do período de teste comprovado.');

  // 6. Teste de Preservação: Dashboard e Exportação CSV continuam funcionando perfeitamente!
  const dashAfterExp = ctx.apiCall('dashboard.get', { mesReferencia: '2026-11' });
  assert.strictEqual(dashAfterExp.ok, true, 'Dashboard DEVE continuar acessível após expiração');
  assert.ok(dashAfterExp.data && dashAfterExp.data.confirmados && dashAfterExp.data.confirmados.saldo_bancario_consolidado_centavos >= 50000, 'Saldo deve permanecer preservado e legível');

  const exportCsvAfterExp = ctx.apiCall('launches.exportCsv', {});
  assert.strictEqual(exportCsvAfterExp.ok, true, 'Exportação de dados DEVE continuar liberada');
  assert.ok(exportCsvAfterExp.data && exportCsvAfterExp.data.csvContent, 'CSV exportado deve conter os dados do cliente');
  results.push('Preservação integral dos dados, consulta e exportação garantidas pós-expiração.');

  // 7. Ativação Comercial com Serial Exclusivo (FINP-XXXX-XXXX-XXXX)
  // 7.1 Serial inválido é rejeitado
  assert.throws(() => {
    ctx.LicenseService.activateLicense('SERIAL_INVALIDO', 'comprador@gmail.com');
  }, /SERIAL_INVALIDO/);

  // 7.2 Serial válido ativa o sistema
  const actRes = ctx.apiCall('license.activate', {
    serial: 'FINP-7K9M-2X5Q-8R4A',
    email: 'comprador@gmail.com'
  });
  assert.strictEqual(actRes.ok, true, 'Ativação deve ser bem-sucedida');
  assert.strictEqual(actRes.data.license.status, 'ACTIVE', 'Status deve mudar para ACTIVE');
  assert.strictEqual(actRes.data.license.can_write, true, 'Escrita deve ser reativada imediatamente');

  // 7.3 Nova escrita agora é permitida com a licença ativa
  const unblockedLan = ctx.apiCall('launches.create', {
    tipo: 'SAIDA',
    descricao: 'Compra de Supermercado Pós-Ativação',
    valor_centavos: 12000,
    data_lancamento: '2026-11-10',
    data_competencia: '2026-11-10',
    data_pagamento: '2026-11-10',
    categoria_id: catRes.data.id,
    conta_bancaria_id: accRes.data.id,
    situacao: 'CONFIRMADO',
    natureza_operacao: 'PADRAO'
  });
  assert.strictEqual(unblockedLan.ok, true, 'Escrita deve ser autorizada com licença ativa');
  results.push('Ativação comercial por serial exclusivo (FINP-XXXX-XXXX-XXXX) validada com sucesso.');

  // 8. Proteção Anti-Clonagem (Detecção de Cópia da Planilha)
  ctx.LicenseService.simulateLicenseState('CLONED');
  const cloneInfo = ctx.LicenseService.getLicenseInfo();
  assert.strictEqual(cloneInfo.status, 'CLONED', 'Status deve ser CLONED');
  assert.strictEqual(cloneInfo.can_write, false, 'Cópia não autorizada não pode gravar');

  const cloneAttempt = ctx.apiCall('launches.create', {
    tipo: 'SAIDA',
    descricao: 'Tentativa em Planilha Clonada',
    valor_centavos: 1000,
    conta_bancaria_id: accRes.data.id
  });
  assert.strictEqual(cloneAttempt.ok, false, 'Cópia clonada deve ter gravação rejeitada');
  assert.ok(cloneAttempt.error.includes('OPERACAO_BLOQUEADA_CLONE'), 'Erro deve informar cópia não autorizada');
  results.push('Proteção anti-clonagem com bloqueio de cópia não autorizada comprovada.');

  // 9. Isolamento Absoluto de Dados Financeiros (LGPD)
  const licDump = JSON.stringify(ctx.LicenseService.getLicenseInfo());
  assert.strictEqual(licDump.includes('350000'), false, 'Metadados de licença não podem conter valores financeiros');
  assert.strictEqual(licDump.includes('Salário'), false, 'Metadados de licença não podem conter descrições de despesas');
  assert.strictEqual(licDump.includes('Nubank'), false, 'Metadados de licença não podem conter nomes de bancos');
  results.push('Conformidade LGPD: Isolamento estrito comprovado (zero dados financeiros em metadados de licença).');

  return results;
}

module.exports = { runLicensingTests };

if (require.main === module) {
  const results = runLicensingTests();
  console.log('Testes de Licenciamento Executados com Sucesso:');
  results.forEach(r => console.log('  ✓ ' + r));
}
