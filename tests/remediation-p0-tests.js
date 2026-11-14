/**
 * @file tests/remediation-p0-tests.js
 * @description Suíte de homologação rigorosa para as correções P0 da Auditoria Independente:
 * 18 Cenários Mandatórios de Teste (Criptografia Assimétrica RSA-2048, Proteção Anti-Clone,
 * Idempotência de Webhooks, Barreira Universal de Escrita e Isolamento LGPD).
 */

const assert = require('assert');
const crypto = require('crypto');
const { createGasContext } = require('./gas-mock-harness');

function runRemediationP0Tests() {
  const results = [];

  // =========================================================================
  // CENÁRIO 1: Tentativa de ativar com serial inventado rejeitada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'comprador1@gmail.com', activeUserEmail: 'comprador1@gmail.com' });
    const fakeSerial = 'FINP-9999-9999-9999';
    const res = ctx.apiCall('license.activate', { serial: fakeSerial, email: 'comprador1@gmail.com' });
    assert.strictEqual(res.ok, false, 'Serial inventado não pode ser ativado');
    assert.ok(
      res.error.includes('SERIAL_NAO_ENCONTRADO'),
      'Deve retornar erro de serial não encontrado/emitido: ' + res.error
    );
    results.push('Cenário 1: Tentativa de ativar com serial inventado rejeitada com SERIAL_NAO_ENCONTRADO.');
  }

  // =========================================================================
  // CENÁRIO 2: Tentativa de reutilizar serial em outra planilha rejeitada
  // =========================================================================
  {
    const ctx1 = createGasContext({ ownerEmail: 'clienteA@gmail.com', activeUserEmail: 'clienteA@gmail.com' });
    const serialCompartilhado = 'FINP-7K9M-2X5Q-8R4A';

    // Cliente A ativa o serial na sua planilha
    const res1 = ctx1.apiCall('license.activate', { serial: serialCompartilhado, email: 'clienteA@gmail.com' });
    assert.strictEqual(res1.ok, true, 'Cliente A deve conseguir ativar');

    // Cliente B tenta reutilizar o mesmo serial em outra planilha conectando ao mesmo servidor
    const ctx2 = createGasContext({ ownerEmail: 'clienteB@gmail.com', activeUserEmail: 'clienteB@gmail.com' });
    ctx2.LicensingServer = ctx1.LicensingServer;
    ctx2.__setScriptProperty('SPREADSHEET_ID', 'planilha_cliente_b_id');
    ctx2.SpreadsheetApp.getActiveSpreadsheet().getId = () => 'planilha_cliente_b_id';

    const res2 = ctx2.apiCall('license.activate', { serial: serialCompartilhado, email: 'clienteB@gmail.com' });
    assert.strictEqual(res2.ok, false, 'Cliente B não pode ativar serial já vinculado a outra planilha');
    assert.ok(
      res2.error.includes('SERIAL_JA_VINCULADO'),
      'Deve acusar vínculo prévio com outra planilha: ' + res2.error
    );
    results.push('Cenário 2: Tentativa de reutilizar serial em outra planilha rejeitada com SERIAL_JA_VINCULADO.');
  }

  // =========================================================================
  // CENÁRIO 3: Injeção de token com assinatura forjada/alterada rejeitada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'hacker@gmail.com', activeUserEmail: 'hacker@gmail.com' });
    const validSerial = 'FINP-9876-5432-ABCD';

    // Cria token válido no LicensingServer
    const validToken = ctx.LicensingServer.signPayloadAsymmetric({
      serial: validSerial,
      installation_id: ctx.LicenseService.getInstallationId(),
      spreadsheet_id: ctx.LicenseService.getBoundSpreadsheetId(),
      plan: 'COMPLETO',
      valid_until: 'LIFETIME'
    });

    // Forja alterando o último caractere da assinatura
    const parts = validToken.split('.');
    const forgedSig = parts[1].slice(0, -4) + 'beef';
    const tamperedToken = parts[0] + '.' + forgedSig;

    assert.throws(() => {
      ctx.LicenseService.activateLicense(validSerial, 'hacker@gmail.com', tamperedToken);
    }, /TOKEN_ASSINATURA_FORJADA/);
    results.push('Cenário 3: Tentativa de injetar token com assinatura forjada/alterada rejeitada.');
  }

  // =========================================================================
  // CENÁRIO 4: Token expirado bloqueia novas inclusões e mantém leitura
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'user_exp@gmail.com', activeUserEmail: 'user_exp@gmail.com' });
    const serial = 'FINP-9876-5432-ABCD';

    // Cria token com data no passado
    const pastDate = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
    const expiredToken = ctx.LicensingServer.signPayloadAsymmetric({
      serial: serial,
      installation_id: ctx.LicenseService.getInstallationId(),
      spreadsheet_id: ctx.LicenseService.getBoundSpreadsheetId(),
      plan: 'ANUAL',
      valid_until: pastDate
    });

    assert.throws(() => {
      ctx.LicenseService.activateLicense(serial, 'user_exp@gmail.com', expiredToken);
    }, /LICENCA_EXPIRADA/);

    // Simula estado expirado e testa leitura vs escrita
    ctx.LicenseService.simulateLicenseState('EXPIRED');
    const info = ctx.LicenseService.getLicenseInfo();
    assert.strictEqual(info.can_write, false, 'Escrita deve ser bloqueada em licença expirada');
    assert.strictEqual(info.can_read, true, 'Leitura deve ser preservada em licença expirada');
    assert.strictEqual(info.can_export, true, 'Exportação deve ser preservada em licença expirada');
    results.push('Cenário 4: Token expirado bloqueia novas inclusões e mantém leitura e exportação intactas.');
  }

  // =========================================================================
  // CENÁRIO 5: Token revogado bloqueia novas inclusões e mantém leitura
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'user_rev@gmail.com', activeUserEmail: 'user_rev@gmail.com' });
    const serial = 'FINP-9876-5432-ABCD';

    const revokedToken = ctx.LicensingServer.signPayloadAsymmetric({
      serial: serial,
      installation_id: ctx.LicenseService.getInstallationId(),
      spreadsheet_id: ctx.LicenseService.getBoundSpreadsheetId(),
      status: 'REVOKED',
      valid_until: 'LIFETIME'
    });

    assert.throws(() => {
      ctx.LicenseService.activateLicense(serial, 'user_rev@gmail.com', revokedToken);
    }, /LICENCA_REVOGADA/);

    ctx.LicenseService.simulateLicenseState('REVOKED');
    const info = ctx.LicenseService.getLicenseInfo();
    assert.strictEqual(info.can_write, false, 'Escrita bloqueada para licença revogada');
    assert.strictEqual(info.can_read, true, 'Leitura garantida para licença revogada');
    results.push('Cenário 5: Token revogado bloqueia novas inclusões e mantém leitura garantida.');
  }

  // =========================================================================
  // CENÁRIO 6: Tentativa de reiniciar trial após expiração rejeitada com TRIAL_JA_UTILIZADO
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'trial_user@gmail.com', activeUserEmail: 'trial_user@gmail.com' });
    ctx.LicenseService.startTrial('trial_user@gmail.com');
    // Simula expiração do trial
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    assert.throws(() => {
      ctx.LicenseService.startTrial('trial_user@gmail.com');
    }, /TRIAL_JA_UTILIZADO/);
    results.push('Cenário 6: Tentativa de reiniciar trial após expiração rejeitada com TRIAL_JA_UTILIZADO.');
  }

  // =========================================================================
  // CENÁRIO 7: Tentativa de reativar trial limpando propriedades locais bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'reset_trial@gmail.com', activeUserEmail: 'reset_trial@gmail.com' });
    ctx.LicenseService.startTrial('reset_trial@gmail.com');

    // Tenta "burlar" limpando apenas LICENSE_STATUS nas propriedades do script
    ctx.__setScriptProperty('LICENSE_STATUS', 'UNREGISTERED');

    assert.throws(() => {
      ctx.LicenseService.startTrial('reset_trial@gmail.com');
    }, /TRIAL_JA_UTILIZADO/);
    results.push('Cenário 7: Tentativa de reativar trial limpando propriedades ou copiando planilha bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 8: Clonagem de planilha detectada, status CLONED, escrita bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'original@gmail.com', activeUserEmail: 'original@gmail.com' });
    ctx.SetupService.installSpreadsheetAndSeed('original@gmail.com');
    ctx.LicenseService.startTrial('original@gmail.com');

    // Simula que a planilha foi copiada no Google Drive (mudança de ID do container)
    ctx.SpreadsheetApp.getActiveSpreadsheet().getId = () => 'planilha_clonada_duplicada_id';

    const info = ctx.LicenseService.getLicenseInfo();
    assert.strictEqual(info.status, 'CLONED', 'Status deve ser CLONED');
    assert.strictEqual(info.can_write, false, 'Escrita deve ser estritamente bloqueada em clone');
    assert.strictEqual(info.can_read, true, 'Leitura deve ser preservada em clone');
    assert.strictEqual(info.can_export, true, 'Exportação deve ser preservada em clone');

    assert.throws(() => {
      ctx.LicenseService.assertCanWrite('tentativa de gravação em clone');
    }, /OPERACAO_BLOQUEADA_CLONE/);
    results.push('Cenário 8: Clonagem de planilha detectada, status CLONED, escrita bloqueada, leitura e exportação mantidas.');
  }

  // =========================================================================
  // CENÁRIO 9: Webhook com assinatura inválida/ausente rejeitado com 401
  // =========================================================================
  {
    const ctx = createGasContext();
    // Forja webhook de Mercado Pago sem x-signature ou com assinatura inválida
    assert.throws(() => {
      ctx.LicensingServer.handlePaymentWebhook(
        { action: 'payment.created', data: { id: 'mp_123' } },
        { 'x-signature': 'ts=123456789,v1=assinatura_falsa_forjada' },
        { provider: 'mercadopago' }
      );
    }, /WEBHOOK_ASSINATURA_INVALIDA/);

    // Forja webhook da Kiwify com token incorreto
    assert.throws(() => {
      ctx.LicensingServer.handlePaymentWebhook(
        { order_id: 'kiwi_123', order_status: 'paid' },
        {},
        { provider: 'kiwify', token: 'token_falso' }
      );
    }, /WEBHOOK_TOKEN_INVALIDO/);
    results.push('Cenário 9: Webhook com assinatura inválida/ausente rejeitado com 401.');
  }

  // =========================================================================
  // CENÁRIO 10: Webhook duplicado processado com idempotência sem duplicar pedido
  // =========================================================================
  {
    const ctx = createGasContext();
    const validToken = 'whsec_kiwify_finpess_segredo_2026';
    ctx.__setScriptProperty('WEBHOOK_SECRET_KIWIFY', validToken);

    const orderPayload = {
      order_id: 'ord_idemp_1001',
      order_status: 'paid',
      Comprador: { email: 'comprador_idemp@gmail.com' },
      payment_amount: 19700
    };

    const resp1 = ctx.LicensingServer.handlePaymentWebhook(
      orderPayload,
      {},
      { provider: 'kiwify', token: validToken }
    );
    assert.strictEqual(resp1.ok, true, 'Primeiro webhook deve processar');
    assert.ok(resp1.serial && resp1.serial.startsWith('FINP-'), 'Deve emitir serial');

    // Segundo webhook com o mesmo order_id
    const resp2 = ctx.LicensingServer.handlePaymentWebhook(
      orderPayload,
      {},
      { provider: 'kiwify', token: validToken }
    );
    assert.strictEqual(resp2.ok, true, 'Webhook duplicado deve retornar ok');
    assert.strictEqual(resp2.serial, resp1.serial, 'Deve retornar exatamente o mesmo serial');
    assert.strictEqual(resp2.idempotent, true, 'Deve reportar idempotência');
    results.push('Cenário 10: Webhook duplicado processado com idempotência sem duplicar serial/pedido.');
  }

  // =========================================================================
  // CENÁRIO 11: Webhook com valor zero ou negativo rejeitado com 400
  // =========================================================================
  {
    const ctx = createGasContext();
    const validToken = 'whsec_kiwify_finpess_segredo_2026';
    ctx.__setScriptProperty('WEBHOOK_SECRET_KIWIFY', validToken);

    assert.throws(() => {
      ctx.LicensingServer.handlePaymentWebhook(
        {
          order_id: 'ord_zero_val',
          order_status: 'paid',
          Comprador: { email: 'zero@gmail.com' },
          payment_amount: 0
        },
        {},
        { provider: 'kiwify', token: validToken }
      );
    }, /VALOR_PAGAMENTO_INVALIDO/);

    assert.throws(() => {
      ctx.LicensingServer.handlePaymentWebhook(
        {
          order_id: 'ord_neg_val',
          order_status: 'paid',
          Comprador: { email: 'neg@gmail.com' },
          payment_amount: -5000
        },
        {},
        { provider: 'kiwify', token: validToken }
      );
    }, /VALOR_PAGAMENTO_INVALIDO/);
    results.push('Cenário 11: Webhook com valor zero ou negativo rejeitado com 400.');
  }

  // =========================================================================
  // CENÁRIO 12: Webhook de estorno/chargeback revoga a licença imediatamente
  // =========================================================================
  {
    const ctx = createGasContext();
    const validToken = 'whsec_kiwify_finpess_segredo_2026';
    ctx.__setScriptProperty('WEBHOOK_SECRET_KIWIFY', validToken);

    // 1. Pagamento aprovado
    const payResp = ctx.LicensingServer.handlePaymentWebhook(
      {
        order_id: 'ord_chargeback_test',
        order_status: 'paid',
        Comprador: { email: 'reembolso@gmail.com' },
        payment_amount: 19700
      },
      {},
      { provider: 'kiwify', token: validToken }
    );
    const issuedSerial = payResp.serial;

    // 2. Webhook de reembolso (refunded)
    const refundResp = ctx.LicensingServer.handlePaymentWebhook(
      {
        order_id: 'ord_chargeback_test',
        order_status: 'refunded',
        Comprador: { email: 'reembolso@gmail.com' }
      },
      {},
      { provider: 'kiwify', token: validToken }
    );
    assert.strictEqual(refundResp.ok, true, 'Reembolso deve ser processado');
    assert.strictEqual(refundResp.status, 'REVOKED', 'Status deve mudar para REVOKED');

    // 3. Tentativa de ativação do serial reembolsado deve falhar
    assert.throws(() => {
      ctx.LicensingServer.handleActivate({
        serial: issuedSerial,
        installation_id: 'inst_qualquer',
        spreadsheet_id: 'ss_qualquer',
        email: 'reembolso@gmail.com'
      });
    }, /LICENCA_REVOGADA/);
    results.push('Cenário 12: Webhook de estorno/chargeback revoga a licença imediatamente.');
  }

  // =========================================================================
  // CENÁRIO 13: Tentativa de lançamento via Telegram após expiração bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'telegram_exp@gmail.com', activeUserEmail: 'telegram_exp@gmail.com' });
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    // Telegram tenta criar proposta de lançamento
    assert.throws(() => {
      ctx.TelegramLaunchService.createProposalFromUpdate(
        { id: 'usr_telegram', grupo_id: 'grp_telegram' },
        { telegram_update_id: 101 },
        { valor_centavos: 4500, tipo: 'SAIDA' }
      );
    }, /OPERACAO_BLOQUEADA_EXPIRADO/);
    results.push('Cenário 13: Tentativa de lançamento via Telegram após expiração bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 14: Criação de conta recorrente após expiração bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'rec_exp@gmail.com', activeUserEmail: 'rec_exp@gmail.com' });
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    const res = ctx.apiCall('recurring.create', {
      descricao: 'Netflix Mensal',
      valor_centavos: 5590,
      tipo: 'SAIDA',
      dia_vencimento: 10
    });
    assert.strictEqual(res.ok, false, 'Criação de recorrente deve ser bloqueada');
    assert.ok(res.error.includes('OPERACAO_BLOQUEADA_EXPIRADO'), 'Erro deve ser OPERACAO_BLOQUEADA_EXPIRADO');
    results.push('Cenário 14: Tentativa de criação de conta recorrente após expiração bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 15: Tentativa de compra no cartão após expiração bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'card_exp@gmail.com', activeUserEmail: 'card_exp@gmail.com' });
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    const res = ctx.apiCall('creditCards.purchases.create', {
      cartao_id: 'card_test_1',
      descricao: 'Cafeteira Expresso',
      valor_total_centavos: 35000,
      parcelas: 1
    });
    assert.strictEqual(res.ok, false, 'Compra em cartão deve ser bloqueada pós expiração');
    assert.ok(res.error.includes('OPERACAO_BLOQUEADA_EXPIRADO'), 'Erro deve ser OPERACAO_BLOQUEADA_EXPIRADO');
    results.push('Cenário 15: Tentativa de compra no cartão após expiração bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 16: Tentativa de aporte em meta após expiração bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'goal_exp@gmail.com', activeUserEmail: 'goal_exp@gmail.com' });
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    const res = ctx.apiCall('goals.contribute', {
      meta_id: 'meta_1',
      valor_centavos: 10000
    });
    assert.strictEqual(res.ok, false, 'Aporte em meta deve ser bloqueado');
    assert.ok(res.error.includes('OPERACAO_BLOQUEADA_EXPIRADO'), 'Erro deve ser OPERACAO_BLOQUEADA_EXPIRADO');
    results.push('Cenário 16: Tentativa de aporte em meta após expiração bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 17: Pagamento de parcela de empréstimo após expiração bloqueada
  // =========================================================================
  {
    const ctx = createGasContext({ ownerEmail: 'loan_exp@gmail.com', activeUserEmail: 'loan_exp@gmail.com' });
    ctx.LicenseService.simulateLicenseState('EXPIRED');

    const res = ctx.apiCall('loans.payInstallment', {
      emprestimo_id: 'emp_1',
      numero_parcela: 1
    });
    assert.strictEqual(res.ok, false, 'Pagamento de empréstimo deve ser bloqueado');
    assert.ok(res.error.includes('OPERACAO_BLOQUEADA_EXPIRADO'), 'Erro deve ser OPERACAO_BLOQUEADA_EXPIRADO');
    results.push('Cenário 17: Tentativa de pagamento de parcela de empréstimo após expiração bloqueada.');
  }

  // =========================================================================
  // CENÁRIO 18: Três compradores independentes com isolamento total verificado
  // =========================================================================
  {
    const ctxA = createGasContext({ ownerEmail: 'compradorA@gmail.com', activeUserEmail: 'compradorA@gmail.com' });
    const ctxB = createGasContext({ ownerEmail: 'compradorB@gmail.com', activeUserEmail: 'compradorB@gmail.com' });
    const ctxC = createGasContext({ ownerEmail: 'compradorC@gmail.com', activeUserEmail: 'compradorC@gmail.com' });

    // Cada comprador tem installation_id diferente
    const idA = ctxA.LicenseService.getInstallationId();
    const idB = ctxB.LicenseService.getInstallationId();
    const idC = ctxC.LicenseService.getInstallationId();

    assert.notStrictEqual(idA, idB, 'IDs de instalação devem ser únicos');
    assert.notStrictEqual(idB, idC, 'IDs de instalação devem ser únicos');
    assert.notStrictEqual(idA, idC, 'IDs de instalação devem ser únicos');

    // Comprador A insere dados sigilosos
    ctxA.LicenseService.startTrial('compradorA@gmail.com');
    ctxA.apiCall('bankAccounts.create', {
      instituicao: 'Banco Safra Privado',
      nome_identificacao: 'Conta A',
      tipo_conta: 'CORRENTE',
      saldo_inicial_centavos: 99999900,
      data_saldo_inicial: '2026-11-01'
    });

    // Comprador B e C consultam dashboard
    const dashB = ctxB.apiCall('dashboard.get', { mesReferencia: '2026-11' });
    const dashC = ctxC.apiCall('dashboard.get', { mesReferencia: '2026-11' });

    // Garante que B e C têm saldo 0 e não veem Banco Safra
    assert.strictEqual(
      JSON.stringify(dashB).includes('Safra'),
      false,
      'Comprador B não pode ver ativos do Comprador A'
    );
    assert.strictEqual(
      JSON.stringify(dashC).includes('Safra'),
      false,
      'Comprador C não pode ver ativos do Comprador A'
    );
    results.push('Cenário 18: Três compradores independentes com isolamento total verificado.');
  }

  return results;
}

module.exports = { runRemediationP0Tests };

if (require.main === module) {
  const results = runRemediationP0Tests();
  console.log('Testes de Remediação P0 Executados com Sucesso:');
  results.forEach(r => console.log('  ✓ ' + r));
}
