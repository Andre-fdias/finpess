/**
 * @file ProjectionService.gs
 * @description Motor de projeção de fluxo de caixa futuro. Combina saldos bancários
 * realizados, receitas/despesas recorrentes, lançamentos futuros e parcelas de
 * acordos/empréstimos, separando valores confirmados de estimados e detalhando
 * todas as premissas e registros que compõem cada total.
 */

var ProjectionService = (function () {
  function generateCashFlowProjection(user, monthsAhead, saveSnapshot) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var horizon = Math.max(1, Math.min(24, parseInt(monthsAhead || 6, 10)));
    var today = SpreadsheetRepository.todayIso();
    var baseYear = parseInt(today.substring(0, 4), 10);
    var baseMonth = parseInt(today.substring(5, 7), 10);

    var bankAccounts = BankAccountService.listBankAccountsWithBalances(user, false);
    var saldoDisponivelHoje = 0;
    for (var b = 0; b < bankAccounts.length; b++) {
      saldoDisponivelHoje += bankAccounts[b].saldo_confirmado_centavos;
    }

    var allLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.situacao !== 'CANCELADO' && l.natureza_operacao !== 'TRANSFERENCIA';
    });
    var activeRecurring = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id, function (r) {
      return r.situacao === 'ATIVA';
    });
    var activeDebts = SpreadsheetRepository.findByGrupo('DIVIDAS', user.grupo_id);
    var debtMap = {};
    for (var d = 0; d < activeDebts.length; d++) debtMap[activeDebts[d].id] = activeDebts[d];

    var activeLoans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id);
    var loanMap = {};
    for (var lIdx = 0; lIdx < activeLoans.length; lIdx++) loanMap[activeLoans[lIdx].id] = activeLoans[lIdx];

    var unpaidParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
    });

    var cartoesCredito = SpreadsheetRepository.findByGrupo('CARTOES_CREDITO', user.grupo_id, function (c) {
      return Boolean(c.ativo);
    });
    var cartaoMap = {};
    for (var cIdx = 0; cIdx < cartoesCredito.length; cIdx++) {
      cartaoMap[cartoesCredito[cIdx].id] = cartoesCredito[cIdx];
    }

    var allInvoices = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id);
    var allCardInstallments = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (pc) {
      return pc.situacao !== 'PAGA' && pc.situacao !== 'CANCELADA';
    });

    var runningProjectedBalance = saldoDisponivelHoje;
    var monthlyScenarios = [];

    for (var mOffset = 0; mOffset < horizon; mOffset++) {
      var targetDate = new Date(Date.UTC(baseYear, baseMonth - 1 + mOffset, 1));
      var ym = targetDate.getUTCFullYear() + '-' + String(targetDate.getUTCMonth() + 1).padStart(2, '0');
      var monthStart = ym + '-01';
      var lastDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, 0)).getUTCDate();
      var monthEnd = ym + '-' + String(lastDay).padStart(2, '0');

      var saldoInicialMes = runningProjectedBalance;
      var receitasConfirmadas = 0;
      var receitasPrevistas = 0;
      var despesasConfirmadas = 0;
      var despesasPrevistas = 0;
      var parcelasCompromissos = 0;
      var registrosComponentes = [];

      // 1. Lançamentos já registrados no mês
      var recurringIdsPresentInLaunches = {};
      var parcelaIdsPresentInLaunches = {};

      for (var i = 0; i < allLaunches.length; i++) {
        var lan = allLaunches[i];
        if (String(lan.data_lancamento).substring(0, 7) !== ym) continue;
        if (lan.referencia_recorrencia_id) {
          recurringIdsPresentInLaunches[lan.referencia_recorrencia_id] = true;
        }
        if (lan.referencia_parcela_id) {
          parcelaIdsPresentInLaunches[lan.referencia_parcela_id] = true;
        }

        var v = Number(lan.valor_centavos || 0);
        if (lan.situacao === 'CONFIRMADO') {
          if (lan.tipo === 'ENTRADA') receitasConfirmadas += v;
          else if (lan.tipo === 'SAIDA') despesasConfirmadas += v;
        } else {
          if (lan.tipo === 'ENTRADA') receitasPrevistas += v;
          else if (lan.tipo === 'SAIDA') despesasPrevistas += v;
        }

        registrosComponentes.push({
          origem_registro: 'LANCAMENTO',
          id: lan.id,
          descricao: lan.descricao,
          tipo: lan.tipo,
          situacao: lan.situacao,
          data: lan.data_lancamento,
          valor_centavos: v,
          afeta_projecao_futura: lan.situacao !== 'CONFIRMADO'
        });
      }

      // 2. Contas recorrentes ativas que ainda não geraram lançamento naquele mês
      for (var r = 0; r < activeRecurring.length; r++) {
        var rule = activeRecurring[r];
        if (recurringIdsPresentInLaunches[rule.id]) continue;
        if (rule.data_inicio && rule.data_inicio > monthEnd) continue;
        if (rule.data_termino && rule.data_termino < monthStart) continue;
        if (rule.recorrencia === 'ANUAL' && rule.data_inicio && rule.data_inicio.substring(5, 7) !== ym.substring(5, 7)) {
          continue;
        }

        var rv = Number(rule.valor_previsto_centavos || 0);
        var rDay = Math.min(lastDay, Math.max(1, Number(rule.dia_vencimento || 10)));
        var rDate = ym + '-' + String(rDay).padStart(2, '0');

        if (rule.tipo === 'ENTRADA') receitasPrevistas += rv;
        else despesasPrevistas += rv;

        registrosComponentes.push({
          origem_registro: 'CONTA_RECORRENTE_PROJETADA',
          id: rule.id,
          descricao: rule.nome + ' (Recorrência ' + rule.natureza + ')',
          tipo: rule.tipo,
          situacao: 'ESTIMADO',
          data: rDate,
          valor_centavos: rv,
          afeta_projecao_futura: true
        });
      }

      // 3. Parcelas de dívidas (com acordo ativo) e empréstimos (não deduzidos em folha líquida)
      for (var p = 0; p < unpaidParcelas.length; p++) {
        var par = unpaidParcelas[p];
        if (String(par.data_vencimento).substring(0, 7) !== ym) continue;
        if (parcelaIdsPresentInLaunches[par.id]) continue;

        var incluirNoFluxo = false;
        if (par.origem_tipo === 'DIVIDA') {
          var parentDebt = debtMap[par.origem_id];
          incluirNoFluxo = Boolean(parentDebt && parentDebt.situacao === 'ACORDO_ATIVO' && parentDebt.repercutir_fluxo_caixa);
        } else if (par.origem_tipo === 'EMPRESTIMO') {
          var parentLoan = loanMap[par.origem_id];
          if (parentLoan && parentLoan.situacao === 'ATIVO') {
            incluirNoFluxo = !(parentLoan.desconto_em_folha && parentLoan.desconto_em_folha_ja_deduzido_salario);
          }
        }

        if (incluirNoFluxo) {
          var pv = Number(par.valor_centavos || 0);
          parcelasCompromissos += pv;
          registrosComponentes.push({
            origem_registro: 'PARCELA_' + par.origem_tipo,
            id: par.id,
            descricao: par.observacoes || ('Parcela ' + par.numero_parcela + '/' + par.total_parcelas),
            tipo: 'SAIDA',
            situacao: 'COMPROMISSO_FUTURO',
            data: par.data_vencimento,
            valor_centavos: pv,
            afeta_projecao_futura: true
          });
        }
      }

      // 4. Faturas de Cartão de Crédito do mês (em aberto ou projetadas por parcelas de compras)
      var faturasCartaoCentavos = 0;
      var faturasProcessadasIds = {};

      for (var f = 0; f < allInvoices.length; f++) {
        var fat = allInvoices[f];
        if (fat.mes_competencia !== ym) continue;
        faturasProcessadasIds[fat.id] = true;

        var fatAberta = Math.max(0, (Number(fat.valor_total_centavos) || 0) - (Number(fat.valor_pago_centavos) || 0));
        var jaTemLancamento = false;
        for (var la = 0; la < allLaunches.length; la++) {
          if (allLaunches[la].natureza_operacao === 'PAGAMENTO_FATURA' && 
              (allLaunches[la].id_origem_externa === fat.id || allLaunches[la].id === fat.lancamento_pagamento_id)) {
            jaTemLancamento = true;
            break;
          }
        }

        if (!jaTemLancamento && fatAberta > 0 && fat.situacao !== 'PAGA') {
          faturasCartaoCentavos += fatAberta;
          var nomeCartao = (cartaoMap[fat.cartao_id] && cartaoMap[fat.cartao_id].nome) || 'Cartão de Crédito';
          registrosComponentes.push({
            origem_registro: 'FATURA_CARTAO_PROJETADA',
            id: fat.id,
            descricao: 'Fatura ' + nomeCartao + ' (' + ym + ')',
            tipo: 'SAIDA',
            situacao: fat.situacao,
            data: fat.data_vencimento || (ym + '-10'),
            valor_centavos: fatAberta,
            afeta_projecao_futura: true
          });
        }
      }

      for (var pc = 0; pc < allCardInstallments.length; pc++) {
        var pCard = allCardInstallments[pc];
        if (pCard.mes_competencia !== ym) continue;
        if (pCard.fatura_id && faturasProcessadasIds[pCard.fatura_id]) continue;

        var pVal = Number(pCard.valor_centavos) || 0;
        faturasCartaoCentavos += pVal;
        var cardObj = cartaoMap[pCard.cartao_id] || { nome: 'Cartão de Crédito' };
        registrosComponentes.push({
          origem_registro: 'PARCELA_CARTAO_PROJETADA',
          id: pCard.id,
          descricao: 'Parcela ' + pCard.numero_parcela + '/' + pCard.total_parcelas + ' - ' + cardObj.nome,
          tipo: 'SAIDA',
          situacao: 'PREVISTO',
          data: ym + '-10',
          valor_centavos: pVal,
          afeta_projecao_futura: true
        });
      }

      // Nota: O saldo inicial do mês corrente já reflete os lançamentos CONFIRMADOS até hoje.
      // Assim, a variação líquida futura daquele mês é composta por receitas previstas menos saídas previstas, compromissos e faturas de cartão.
      var variacaoFuturaLiquida = receitasPrevistas - despesasPrevistas - parcelasCompromissos - faturasCartaoCentavos;
      var saldoFinalProjetado = saldoInicialMes + variacaoFuturaLiquida;
      runningProjectedBalance = saldoFinalProjetado;

      var scenario = {
        competencia: ym,
        saldo_inicial_referencia_centavos: saldoInicialMes,
        receitas_confirmadas_centavos: receitasConfirmadas,
        receitas_previstas_centavos: receitasPrevistas,
        despesas_confirmadas_centavos: despesasConfirmadas,
        despesas_previstas_centavos: despesasPrevistas,
        parcelas_compromissos_centavos: parcelasCompromissos,
        faturas_cartao_centavos: faturasCartaoCentavos,
        variacao_futura_liquida_centavos: variacaoFuturaLiquida,
        saldo_final_projetado_centavos: saldoFinalProjetado,
        alerta_saldo_negativo: saldoFinalProjetado < 0,
        deficit_centavos: saldoFinalProjetado < 0 ? Math.abs(saldoFinalProjetado) : 0,
        registros_componentes: registrosComponentes
      };

      monthlyScenarios.push(scenario);

      if (saveSnapshot) {
        SpreadsheetRepository.insert('PROJECOES', {
          id: SpreadsheetRepository.generateId('prj'),
          grupo_id: user.grupo_id,
          competencia: ym,
          saldo_inicial_realizado_centavos: saldoInicialMes,
          receitas_confirmadas_centavos: receitasConfirmadas,
          receitas_previstas_centavos: receitasPrevistas,
          despesas_confirmadas_centavos: despesasConfirmadas,
          despesas_previstas_centavos: despesasPrevistas,
          parcelas_compromissos_centavos: parcelasCompromissos,
          saldo_final_projetado_centavos: saldoFinalProjetado,
          premissas_json: JSON.stringify({
            horizonte_meses: horizon,
            inclui_recorrencias_ativas: true,
            inclui_faturas_cartao: true,
            exclui_dividas_sem_acordo: true,
            exclui_consignado_ja_deduzido_liquido: true
          }),
          gerado_por: user.id
        });
      }
    }

    var totRecProj = 0;
    var totDespProj = 0;
    var totFatProj = 0;
    var totCompProj = 0;
    var menorSaldo = saldoDisponivelHoje;
    var mesMenorSaldo = monthlyScenarios.length > 0 ? monthlyScenarios[0].competencia : '';
    var mesesCriticos = [];

    for (var sc = 0; sc < monthlyScenarios.length; sc++) {
      var s = monthlyScenarios[sc];
      totRecProj += s.receitas_previstas_centavos;
      totDespProj += s.despesas_previstas_centavos;
      totFatProj += s.faturas_cartao_centavos;
      totCompProj += s.parcelas_compromissos_centavos;
      if (s.saldo_final_projetado_centavos < menorSaldo) {
        menorSaldo = s.saldo_final_projetado_centavos;
        mesMenorSaldo = s.competencia;
      }
      if (s.alerta_saldo_negativo) {
        mesesCriticos.push({
          competencia: s.competencia,
          deficit_centavos: s.deficit_centavos,
          saldo_final_centavos: s.saldo_final_projetado_centavos
        });
      }
    }

    return {
      aviso_importante: 'Projeção financeira estimada: valores projetados NÃO representam dinheiro disponível na conta bancária.',
      data_geracao: SpreadsheetRepository.nowIso(),
      saldo_bancario_confirmado_atual_centavos: saldoDisponivelHoje,
      horizonte_meses: horizon,
      resumo_horizonte: {
        total_receitas_previstas_centavos: totRecProj,
        total_despesas_previstas_centavos: totDespProj,
        total_faturas_cartao_centavos: totFatProj,
        total_compromissos_centavos: totCompProj,
        saldo_final_projetado_centavos: runningProjectedBalance,
        menor_saldo_projetado_centavos: menorSaldo,
        mes_menor_saldo: mesMenorSaldo,
        meses_criticos_count: mesesCriticos.length,
        meses_criticos: mesesCriticos
      },
      premissas: [
        'O ponto de partida utiliza exclusivamente o saldo confirmado das contas bancárias ativas.',
        'Lançamentos já confirmados não são somados em duplicidade ao saldo atual.',
        'Contas recorrentes ativas sem lançamento gerado no mês são projetadas pelo seu valor previsto.',
        'Faturas e parcelas de compras no cartão de crédito comprometem o caixa no mês de vencimento.',
        'Dívidas antigas ou protestadas sem acordo ativo não entram na projeção.',
        'Empréstimos consignados cujo desconto já está abatido no salário líquido cadastrado não são descontados novamente.'
      ],
      cenarios_mensais: monthlyScenarios
    };
  }

  return {
    generateCashFlowProjection: generateCashFlowProjection
  };
})();

