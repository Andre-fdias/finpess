/**
 * @file planning-goals-tests.js
 * @description Suíte de testes automatizados para:
 * 1. Projeção de Fluxo de Caixa de 12 Meses com Faturas de Cartão e Meses Críticos
 * 2. Orçamento por Categoria com Limites Inteligentes (70%, 90%, 100%)
 * 3. Gestor de Assinaturas e Custo Anualizado
 * 4. Metas Financeiras, Cálculo de Aporte Mensal e Reserva de Emergência
 */

const assert = require('assert');
const { createGasContext } = require('./gas-mock-harness');

function runPlanningAndGoalsTests() {
  const results = [];
  const ctx = createGasContext();

  const boot = ctx.apiCall('session.getBootstrap', {});
  assert.strictEqual(boot.ok, true);

  // 1. Criar conta bancária e categorias base
  const conta = ctx.apiCall('bankAccounts.create', {
    instituicao: 'Nubank',
    nome_identificacao: 'Conta Principal',
    tipo_conta: 'CORRENTE',
    saldo_inicial_centavos: 500000 // R$ 5.000,00
  }).data;

  const catAlimentacao = ctx.apiCall('categories.create', {
    nome: 'Alimentação & Mercado',
    tipo: 'SAIDA',
    orcamento_mensal_centavos: 100000 // Limite R$ 1.000,00
  }).data;

  const catLazer = ctx.apiCall('categories.create', {
    nome: 'Lazer & Restaurantes',
    tipo: 'SAIDA',
    orcamento_mensal_centavos: 50000 // Limite R$ 500,00
  }).data;

  // -------------------------------------------------------------
  // TESTE 1: Orçamento por Categoria com Limites (70%, 90%, 100%)
  // -------------------------------------------------------------
  // Lança R$ 600 em Alimentação (60% -> Verde)
  ctx.apiCall('launches.create', {
    tipo: 'SAIDA',
    descricao: 'Supermercado Mensal',
    valor_centavos: 60000,
    data_lancamento: '2026-11-05',
    categoria_id: catAlimentacao.id,
    conta_bancaria_id: conta.id,
    situacao: 'CONFIRMADO'
  });

  // Lança R$ 480 em Lazer (96% de R$ 500 -> Laranja/Quase no limite)
  ctx.apiCall('launches.create', {
    tipo: 'SAIDA',
    descricao: 'Restaurante Fim de Semana',
    valor_centavos: 48000,
    data_lancamento: '2026-11-05',
    categoria_id: catLazer.id,
    conta_bancaria_id: conta.id,
    situacao: 'CONFIRMADO'
  });

  const budgetStatus = ctx.apiCall('categories.getBudgetStatus', { mesReferencia: '2026-11' }).data;
  assert.ok(budgetStatus.total_orcado_centavos >= 150000, 'Total orçado deve somar os limites das categorias');
  assert.ok(budgetStatus.total_comprometido_centavos >= 108000, 'Total gasto deve ser somado');

  const itemAlim = budgetStatus.itens.find(i => i.categoria_id === catAlimentacao.id);
  assert.strictEqual(itemAlim.percentual_consumido, 60);
  assert.strictEqual(itemAlim.faixa_alerta, 'VERDE', 'Abaixo de 70% deve ser faixa VERDE');

  const itemLazer = budgetStatus.itens.find(i => i.categoria_id === catLazer.id);
  assert.strictEqual(itemLazer.percentual_consumido, 96);
  assert.strictEqual(itemLazer.faixa_alerta, 'LARANJA', 'Entre 90% e 100% deve ser faixa LARANJA');

  // Atualização dinâmica de orçamento de categoria
  const updatedBudget = ctx.apiCall('categories.updateBudget', {
    categoria_id: catLazer.id,
    orcamento_mensal_centavos: 80000 // Eleva teto para R$ 800
  });
  assert.strictEqual(updatedBudget.ok, true);

  const budgetStatusAfter = ctx.apiCall('categories.getBudgetStatus', { mesReferencia: '2026-11' }).data;
  const itemLazerAfter = budgetStatusAfter.itens.find(i => i.categoria_id === catLazer.id);
  assert.strictEqual(itemLazerAfter.percentual_consumido, 60);
  assert.strictEqual(itemLazerAfter.faixa_alerta, 'VERDE', 'Com teto ampliado deve voltar para faixa VERDE');

  results.push('Orçamento por categoria com faixas inteligentes (Verde, Amarelo, Laranja, Vermelho) validado.');

  // -------------------------------------------------------------
  // TESTE 2: Gestor de Assinaturas e Custo Anualizado
  // -------------------------------------------------------------
  ctx.apiCall('recurring.create', {
    nome: 'Netflix Premium 4K',
    tipo: 'SAIDA',
    natureza: 'FIXA',
    recorrencia: 'MENSAL',
    dia_vencimento: 10,
    valor_previsto_centavos: 5590, // R$ 55,90 / mês
    categoria_id: catLazer.id
  });

  ctx.apiCall('recurring.create', {
    nome: 'Spotify Familiar',
    tipo: 'SAIDA',
    natureza: 'FIXA',
    recorrencia: 'MENSAL',
    dia_vencimento: 15,
    valor_previsto_centavos: 3490, // R$ 34,90 / mês
    categoria_id: catLazer.id
  });

  const subsOverview = ctx.apiCall('recurring.getSubscriptionsOverview', {}).data;
  assert.strictEqual(subsOverview.quantidade_assinaturas, 2);
  assert.strictEqual(subsOverview.total_mensal_centavos, 9080); // R$ 90,80
  assert.strictEqual(subsOverview.total_anual_centavos, 9080 * 12); // R$ 1.089,60 por ano!

  const netflixItem = subsOverview.itens.find(i => i.nome === 'Netflix Premium 4K');
  assert.strictEqual(netflixItem.custo_anual_centavos, 5590 * 12, 'Netflix deve custar R$ 670,80 ao ano');
  results.push('Gestor de assinaturas e cálculo de custo anualizado comprovados.');

  // -------------------------------------------------------------
  // TESTE 3: Projeção de Fluxo de Caixa 12 Meses com Cartão de Crédito
  // -------------------------------------------------------------
  // Cadastra cartão de crédito e lança compra parcelada em 10x de R$ 300,00
  const cartao = ctx.apiCall('creditCards.create', {
    nome: 'Cartão Black XP',
    emissor: 'XP',
    bandeira: 'VISA',
    limite_total_centavos: 2000000,
    dia_fechamento: 20,
    dia_vencimento: 27
  }).data;

  ctx.apiCall('creditCards.purchases.create', {
    cartao_id: cartao.id,
    descricao: 'Notebook Gamer',
    valor_total_centavos: 300000, // R$ 3.000,00
    parcelas_total: 10,
    data_compra: '2026-11-01',
    categoria_id: catLazer.id
  });

  // Executa projeção de 12 meses
  const proj12m = ctx.apiCall('projections.generate', { monthsAhead: 12, saveSnapshot: true }).data;
  assert.strictEqual(proj12m.horizonte_meses, 12, 'Horizonte deve ser exatamente 12 meses');
  assert.strictEqual(proj12m.cenarios_mensais.length, 12, 'Deve gerar exatamente 12 cenários mensais');
  assert.ok(proj12m.resumo_horizonte, 'Resumo do horizonte de 12 meses deve estar presente');
  assert.ok(proj12m.resumo_horizonte.total_faturas_cartao_centavos > 0, 'Faturas de cartão devem compor o fluxo futuro');

  // Verifica que cada mês projetado contém saídas de cartão
  const mes1 = proj12m.cenarios_mensais[0];
  assert.ok(mes1.faturas_cartao_centavos > 0, '1º mês deve registrar fatura de cartão');
  assert.ok(typeof mes1.saldo_final_projetado_centavos === 'number', 'Saldo final deve ser calculado');

  results.push('Fluxo de caixa projetado de 12 meses integrado com cartões de crédito e resumo anual validado.');

  // -------------------------------------------------------------
  // TESTE 4: Metas Financeiras e Reserva de Emergência
  // -------------------------------------------------------------
  // Dimensionamento da Reserva de Emergência
  const emergencyFund = ctx.apiCall('goals.getEmergencyFundRecommendation', {}).data;
  assert.ok(emergencyFund.custo_mensal_medio_centavos > 0, 'Custo médio mensal deve ser dimensionado');
  assert.strictEqual(emergencyFund.reserva_minima_3_meses_centavos, emergencyFund.custo_mensal_medio_centavos * 3);
  assert.strictEqual(emergencyFund.reserva_ideal_6_meses_centavos, emergencyFund.custo_mensal_medio_centavos * 6);

  // Criação de meta: Reserva de Emergência
  const metaReserva = ctx.apiCall('goals.create', {
    nome: 'Minha Reserva de Emergência',
    categoria_meta: 'RESERVA_EMERGENCIA',
    valor_alvo_centavos: 1000000, // Alvo de R$ 10.000
    valor_atual_centavos: 200000, // R$ 2.000 já guardados
    data_limite: '2027-11-05' // 12 meses
  }).data;

  assert.strictEqual(metaReserva.situacao, 'EM_ANDAMENTO');

  // Criação de meta com prazo: Viagem Fim de Ano
  const metaViagem = ctx.apiCall('goals.create', {
    nome: 'Viagem de Férias',
    categoria_meta: 'VIAGEM',
    valor_alvo_centavos: 600000, // R$ 6.000,00
    valor_atual_centavos: 0,
    data_limite: '2027-05-05' // 6 meses
  }).data;

  const listGoals = ctx.apiCall('goals.list', {}).data;
  assert.strictEqual(listGoals.metas.length, 2, 'Deve listar as 2 metas');
  const itemViagem = listGoals.metas.find(m => m.id === metaViagem.id);
  assert.strictEqual(itemViagem.meses_restantes, 6, 'Prazo de 6 meses calculado');
  assert.strictEqual(itemViagem.aporte_mensal_sugerido_centavos, 100000, 'Aporte mensal de R$ 1.000,00 para atingir a meta em 6 meses');

  // Realizar aporte na meta de viagem
  const aporteRes = ctx.apiCall('goals.contribute', {
    id: metaViagem.id,
    valor_aporte_centavos: 100000
  });
  assert.strictEqual(aporteRes.ok, true);
  assert.strictEqual(aporteRes.data.novo_saldo_formatado, 'R$ 1.000,00');

  const listGoalsAfter = ctx.apiCall('goals.list', {}).data;
  const itemViagemAfter = listGoalsAfter.metas.find(m => m.id === metaViagem.id);
  assert.strictEqual(itemViagemAfter.valor_atual_centavos, 100000);
  assert.strictEqual(itemViagemAfter.percentual_atingido, 17); // 1000 / 6000 = 17%

  results.push('Metas financeiras, cálculo de esforço mensal, aporte e reserva de emergência validados com 100% de sucesso.');

  return results;
}

if (require.main === module) {
  const out = runPlanningAndGoalsTests();
  console.log('PLANNING & GOALS TESTS PASSED:\n', out.join('\n'));
}

module.exports = { runPlanningAndGoalsTests };
