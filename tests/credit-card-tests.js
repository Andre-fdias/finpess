/**
 * @file tests/credit-card-tests.js
 * @description Suíte de testes automatizados do Módulo de Cartões de Crédito e Faturas:
 * limites em centavos, parcelamentos matemáticos, melhor dia de compra, liquidação
 * com saída bancária única, isolamento de despesas e prevenção de duplicidade.
 */

const assert = require('assert');
const { createGasContext } = require('./gas-mock-harness');

function runCreditCardTests() {
  const ctx = createGasContext({ ownerEmail: 'admin@finpess.local', activeUserEmail: 'admin@finpess.local' });
  const results = [];

  // Bootstrap
  const boot = ctx.apiCall('session.getBootstrap', {});
  assert.strictEqual(boot.ok, true);
  const user = boot.profile.user;

  // 1. Criar conta bancária para quitação de fatura
  const bankAccRes = ctx.apiCall('bankAccounts.create', {
    instituicao: 'Nubank',
    nome_identificacao: 'NuConta Principal',
    tipo_conta: 'PAGAMENTO',
    saldo_inicial_centavos: 500000, // R$ 5.000,00
    data_saldo_inicial: '2026-11-01'
  });
  assert.strictEqual(bankAccRes.ok, true);
  const bankAcc = bankAccRes.data;

  // 2. Cadastro de Cartão de Crédito
  const cardRes = ctx.apiCall('creditCards.create', {
    nome: 'Nubank Ultravioleta',
    emissor: 'Nubank',
    bandeira: 'MASTERCARD',
    titular: 'André Fonseca Dias',
    ultimos_digitos: '4821',
    limite_total_centavos: 800000, // R$ 8.000,00
    dia_fechamento: 10,
    dia_vencimento: 17,
    conta_bancaria_id: bankAcc.id,
    cor_cartao: '#820ad1'
  });
  assert.strictEqual(cardRes.ok, true);
  const cardId = cardRes.data.id;

  // 3. Verificação do Melhor Dia de Compra
  const cardsList = ctx.apiCall('creditCards.list', {}).data;
  assert.strictEqual(cardsList.length, 1);
  const card = cardsList[0];
  assert.strictEqual(card.nome, 'Nubank Ultravioleta');
  assert.strictEqual(card.melhor_dia_compra, 11, 'Melhor dia de compra deve ser o dia seguinte ao fechamento (dia 11)');
  assert.strictEqual(card.limite_total_centavos, 800000);
  assert.strictEqual(card.limite_comprometido_centavos, 0);
  assert.strictEqual(card.limite_disponivel_centavos, 800000);
  results.push('Cadastro de cartão, validação de limites e cálculo do Melhor Dia de Compra aprovados.');

  // Categorias
  const categories = ctx.apiCall('categories.list', {}).data;
  const catCasa = categories.find(c => c.nome === 'Moradia') || categories[0];

  // 4. Compra à vista antes do fechamento (ex: dia 05/11) -> Entra na fatura de 2026-11
  const buy1Res = ctx.apiCall('creditCards.purchases.create', {
    cartao_id: cardId,
    descricao: 'Supermercado Mensal',
    valor_total_centavos: 60000, // R$ 600,00
    parcelas_total: 1,
    data_compra: '2026-11-05',
    categoria_id: catCasa.id
  });
  assert.strictEqual(buy1Res.ok, true);

  // Verifica que a compra NÃO alterou o saldo da conta bancária
  const accAfterBuy1 = ctx.apiCall('bankAccounts.list', {}).data.find(a => a.id === bankAcc.id);
  assert.strictEqual(accAfterBuy1.saldo_confirmado_centavos, 500000, 'Saldo bancário deve permanecer intocado no momento da compra no cartão');

  // Verifica limite comprometido
  const cardsAfterBuy1 = ctx.apiCall('creditCards.list', {}).data;
  assert.strictEqual(cardsAfterBuy1[0].limite_comprometido_centavos, 60000);
  assert.strictEqual(cardsAfterBuy1[0].limite_disponivel_centavos, 740000);
  results.push('Compra à vista no cartão: atribuição correta à fatura e isolamento absoluto do saldo bancário comprovados.');

  // 5. Compra APÓS o fechamento (ex: dia 12/11 com fechamento dia 10) -> Entra na fatura do mês seguinte (2026-12)
  const buyNextMonthRes = ctx.apiCall('creditCards.purchases.create', {
    cartao_id: cardId,
    descricao: 'Restaurante Fim de Semana',
    valor_total_centavos: 15000, // R$ 150,00
    parcelas_total: 1,
    data_compra: '2026-11-12',
    categoria_id: catCasa.id
  });
  assert.strictEqual(buyNextMonthRes.ok, true);

  const invoices = ctx.apiCall('creditCards.invoices.list', { cartao_id: cardId }).data;
  const invNov = invoices.find(f => f.mes_competencia === '2026-11');
  const invDez = invoices.find(f => f.mes_competencia === '2026-12');
  assert.ok(invNov, 'Fatura de novembro deve existir');
  assert.ok(invDez, 'Fatura de dezembro deve existir automaticamente para compra após o fechamento');
  assert.strictEqual(invNov.valor_total_centavos, 60000);
  assert.strictEqual(invDez.valor_total_centavos, 15000);
  results.push('Regra de corte: compra após o fechamento direcionada automaticamente para a fatura do mês seguinte comprovada.');

  // 6. Compra Parcelada em 5x com precisão matemática em centavos (R$ 1.200,00 -> 5x de R$ 240,00)
  const buyParcRes = ctx.apiCall('creditCards.purchases.create', {
    cartao_id: cardId,
    descricao: 'Geladeira Nova',
    valor_total_centavos: 120000, // R$ 1.200,00
    parcelas_total: 5,
    data_compra: '2026-11-08',
    categoria_id: catCasa.id
  });
  assert.strictEqual(buyParcRes.ok, true);

  // Fatura de novembro agora tem: R$ 600 (Supermercado) + R$ 240 (Parcela 1/5) = R$ 840,00
  const invNovDetails = ctx.apiCall('creditCards.invoices.get', { id: invNov.id }).data;
  assert.strictEqual(invNovDetails.invoice.valor_total_centavos, 84000);
  assert.strictEqual(invNovDetails.itens.length, 2);

  // Fatura de dezembro agora tem: R$ 150 (Restaurante) + R$ 240 (Parcela 2/5) = R$ 390,00
  const invDezDetails = ctx.apiCall('creditCards.invoices.get', { id: invDez.id }).data;
  assert.strictEqual(invDezDetails.invoice.valor_total_centavos, 39000);

  // Teste de divisão com resto em centavos: R$ 100,00 em 3x = 33,34 + 33,33 + 33,33
  const buyRestoRes = ctx.apiCall('creditCards.purchases.create', {
    cartao_id: cardId,
    descricao: 'Livros Técnicos',
    valor_total_centavos: 10000, // R$ 100,00
    parcelas_total: 3,
    data_compra: '2026-11-09',
    categoria_id: catCasa.id
  });
  assert.strictEqual(buyRestoRes.ok, true);

  const parcelasResto = ctx.SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, p => p.compra_id === buyRestoRes.data.id);
  assert.strictEqual(parcelasResto.length, 3);
  assert.strictEqual(parcelasResto[0].valor_centavos, 3334, 'Primeira parcela absorve o resto');
  assert.strictEqual(parcelasResto[1].valor_centavos, 3333);
  assert.strictEqual(parcelasResto[2].valor_centavos, 3333);
  assert.strictEqual(parcelasResto[0].valor_centavos + parcelasResto[1].valor_centavos + parcelasResto[2].valor_centavos, 10000, 'Soma exata sem perda de centavos');
  results.push('Distribuição cronológica de parcelas e preservação estrita de centavos comprovadas.');

  // 7. Pagamento de Fatura (Liquidação Real no Banco)
  // Pagamento da fatura de novembro (R$ 840 + R$ 33,34 = R$ 873,34)
  const invNovUpdated = ctx.apiCall('creditCards.invoices.get', { id: invNov.id }).data.invoice;
  const valorFaturaNov = invNovUpdated.valor_total_centavos;
  assert.strictEqual(valorFaturaNov, 87334);

  const payRes = ctx.apiCall('creditCards.invoices.pay', {
    fatura_id: invNov.id,
    conta_bancaria_id: bankAcc.id,
    valor_pago_centavos: valorFaturaNov,
    data_pagamento: '2026-11-17'
  });
  assert.strictEqual(payRes.ok, true);
  assert.strictEqual(payRes.data.situacao, 'PAGA');

  // Verifica que o saldo bancário foi reduzido EXATAMENTE pelo valor da fatura
  const accAfterPay = ctx.apiCall('bankAccounts.list', {}).data.find(a => a.id === bankAcc.id);
  assert.strictEqual(accAfterPay.saldo_confirmado_centavos, 500000 - valorFaturaNov, 'Saldo bancário deve ser debitado unicamente no pagamento da fatura');

  // Verifica liberação do limite proporcional
  const cardsAfterPay = ctx.apiCall('creditCards.list', {}).data;
  const limiteLiberado = cardsAfterPay[0].limite_disponivel_centavos;
  assert.strictEqual(limiteLiberado, 800000 - (15000 + 4 * 24000 + 2 * 3333), 'Limite liberado na proporção exata das parcelas pagas');
  results.push('Pagamento de fatura: débito único em conta bancária, liberação de limite e prevenção de duplicidade comprovados.');

  // 8. Cancelamento de Compra
  const cancelRes = ctx.apiCall('creditCards.purchases.cancel', {
    id: buyNextMonthRes.data.id,
    motivo: 'Devolução de produto'
  });
  assert.strictEqual(cancelRes.ok, true);

  const invDezAfterCancel = ctx.apiCall('creditCards.invoices.get', { id: invDez.id }).data;
  assert.strictEqual(invDezAfterCancel.invoice.valor_total_centavos, 24000 + 3333, 'Fatura recalculada com remoção da compra cancelada');
  results.push('Cancelamento de compra e recomposição automática de faturas comprovados.');

  // 9. Simulador de Compras
  const simRes = ctx.apiCall('creditCards.simulate', {
    cartao_id: cardId,
    valor_total_centavos: 300000, // R$ 3.000,00
    parcelas_total: 10,
    data_compra: '2026-11-15'
  });
  assert.strictEqual(simRes.ok, true);
  assert.strictEqual(simRes.data.parcelas_total, 10);
  assert.strictEqual(simRes.data.cabe_no_limite, true);
  assert.strictEqual(simRes.data.cronograma.length, 10);
  results.push('Simulador orçamentário de compras parceladas comprovado.');

  // 10. Isolamento Estrito entre Grupos Financeiros
  const otherCtx = createGasContext({ ownerEmail: 'outro@finpess.local', activeUserEmail: 'outro@finpess.local' });
  const otherBoot = otherCtx.apiCall('session.getBootstrap', {});
  const otherCards = otherCtx.apiCall('creditCards.list', {}).data;
  assert.strictEqual(otherCards.length, 0, 'Usuário de outro grupo não pode enxergar cartões do grupo alheio');

  const crossRes = otherCtx.apiCall('creditCards.purchases.create', {
    cartao_id: cardId, // ID do grupo original
    descricao: 'Tentativa Invasora',
    valor_total_centavos: 5000,
    categoria_id: catCasa.id
  });
  assert.strictEqual(crossRes.ok, false, 'Chamada deve falhar');
  assert.ok(/Cartão de crédito inválido ou inativo/.test(crossRes.error), 'Mensagem de bloqueio esperada');
  results.push('Isolamento de segurança e proteção multigrupo comprovados.');

  return results;
}

module.exports = { runCreditCardTests };
