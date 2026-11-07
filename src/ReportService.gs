/**
 * @file ReportService.gs
 * @description Central profissional de inteligência financeira (Business Intelligence),
 * demonstrativos gerenciais (DRE pessoal, fluxo de caixa, custos por categoria),
 * evolução patrimonial, comparativos entre períodos e análise interpretativa assistida por IA.
 */

var ReportService = (function () {
  /**
   * Normaliza data para formato YYYY-MM-DD
   */
  function normalizeDateIso(d) {
    if (!d) return '';
    if (d instanceof Date) {
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyy-MM-dd');
      }
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }
    var s = String(d).trim();
    var brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1];
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.substring(0, 10);
    }
    return s;
  }

  /**
   * Determina as datas de início e fim baseadas no filtro de período
   */
  function resolvePeriodDates(params) {
    var p = params || {};
    var todayIso = SpreadsheetRepository.todayIso();
    var curYear = parseInt(todayIso.substring(0, 4), 10);
    var curMonth = parseInt(todayIso.substring(5, 7), 10);

    var periodType = String(p.periodo_tipo || 'MES_ATUAL').toUpperCase();
    var startIso = '';
    var endIso = '';
    var periodLabel = '';

    if (periodType === 'PERSONALIZADO' && p.data_inicio && p.data_fim) {
      startIso = normalizeDateIso(p.data_inicio);
      endIso = normalizeDateIso(p.data_fim);
      periodLabel = 'De ' + startIso + ' até ' + endIso;
    } else if (periodType === 'MES_ANTERIOR') {
      var prevMonthDate = new Date(Date.UTC(curYear, curMonth - 2, 1));
      var py = prevMonthDate.getUTCFullYear();
      var pm = prevMonthDate.getUTCMonth() + 1;
      var lastDayPrev = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      var pmStr = String(pm).padStart(2, '0');
      startIso = py + '-' + pmStr + '-01';
      endIso = py + '-' + pmStr + '-' + String(lastDayPrev).padStart(2, '0');
      periodLabel = 'Mês Anterior (' + pmStr + '/' + py + ')';
    } else if (periodType === 'ULTIMOS_3_MESES') {
      var d3 = new Date(Date.UTC(curYear, curMonth - 3, 1));
      var y3 = d3.getUTCFullYear();
      var m3Str = String(d3.getUTCMonth() + 1).padStart(2, '0');
      var lastDayCur = new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate();
      startIso = y3 + '-' + m3Str + '-01';
      endIso = curYear + '-' + String(curMonth).padStart(2, '0') + '-' + String(lastDayCur).padStart(2, '0');
      periodLabel = 'Últimos 3 Meses';
    } else if (periodType === 'ANO_ATUAL') {
      startIso = curYear + '-01-01';
      endIso = curYear + '-12-31';
      periodLabel = 'Ano de ' + curYear;
    } else {
      // Padrão: MES_ATUAL
      var targetY = p.ano ? parseInt(p.ano, 10) : curYear;
      var targetM = p.mes && /^\d{4}-\d{2}$/.test(p.mes) ? parseInt(p.mes.substring(5, 7), 10) : curMonth;
      if (p.mes && /^\d{4}-\d{2}$/.test(p.mes)) {
        targetY = parseInt(p.mes.substring(0, 4), 10);
      }
      var tmStr = String(targetM).padStart(2, '0');
      var lastDayM = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
      startIso = targetY + '-' + tmStr + '-01';
      endIso = targetY + '-' + tmStr + '-' + String(lastDayM).padStart(2, '0');
      periodLabel = tmStr + '/' + targetY;
    }

    return {
      periodo_tipo: periodType,
      data_inicio: startIso,
      data_fim: endIso,
      rotulo: periodLabel
    };
  }

  /**
   * Consulta completa e consolidação de dados para o relatório de Business Intelligence
   */
  function getComprehensiveReport(user, params) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = params || {};
    var period = resolvePeriodDates(p);
    var startIso = period.data_inicio;
    var endIso = period.data_fim;

    // 1. Carregar Categorias
    var categories = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < categories.length; c++) {
      catMap[categories[c].id] = categories[c];
    }

    // 2. Carregar Contas Bancárias
    var bankAccounts = BankAccountService.listBankAccountsWithBalances(user, false);
    var bankMap = {};
    var saldoBancarioConsolidadoHoje = 0;
    for (var b = 0; b < bankAccounts.length; b++) {
      bankMap[bankAccounts[b].id] = bankAccounts[b];
      saldoBancarioConsolidadoHoje += bankAccounts[b].saldo_confirmado_centavos;
    }

    // 3. Carregar e Filtrar Lançamentos
    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      if (l.situacao === 'CANCELADO') return false;
      if (l.natureza_operacao === 'TRANSFERENCIA') return false;
      var d = normalizeDateIso(l.data_lancamento);
      if (!d || d < startIso || d > endIso) return false;
      if (p.conta_bancaria_id && l.conta_bancaria_id !== p.conta_bancaria_id) return false;
      if (p.categoria_id && l.categoria_id !== p.categoria_id) return false;
      if (p.tipo && l.tipo !== p.tipo) return false;
      return true;
    });

    var receitasConfirmadas = 0;
    var receitasPrevistas = 0;
    var despesasConfirmadas = 0;
    var despesasPrevistas = 0;

    var catReceitasMap = {};
    var catDespesasMap = {};
    var topDespesas = [];
    var topReceitas = [];
    var despesasFixas = 0;
    var despesasVariaveis = 0;

    var contasPagasCount = 0;
    var contasPagasCentavos = 0;
    var contasPendentesCount = 0;
    var contasPendentesCentavos = 0;
    var todayIso = SpreadsheetRepository.todayIso();
    var contasVencidasCount = 0;
    var contasVencidasCentavos = 0;

    for (var i = 0; i < launches.length; i++) {
      var lan = launches[i];
      var v = Number(lan.valor_centavos || 0);
      var cat = catMap[lan.categoria_id];
      var catNome = cat ? cat.nome : 'Sem Categoria';
      var dLan = normalizeDateIso(lan.data_lancamento);

      if (lan.tipo === 'ENTRADA') {
        if (lan.situacao === 'CONFIRMADO') {
          receitasConfirmadas += v;
        } else {
          receitasPrevistas += v;
        }

        catReceitasMap[catNome] = (catReceitasMap[catNome] || 0) + v;
        topReceitas.push({
          id: lan.id,
          descricao: lan.descricao,
          data: dLan,
          categoria: catNome,
          valor_centavos: v,
          situacao: lan.situacao
        });
      } else if (lan.tipo === 'SAIDA') {
        if (lan.situacao === 'CONFIRMADO') {
          despesasConfirmadas += v;
          contasPagasCount++;
          contasPagasCentavos += v;
        } else {
          despesasPrevistas += v;
          contasPendentesCount++;
          contasPendentesCentavos += v;
          if (dLan < todayIso) {
            contasVencidasCount++;
            contasVencidasCentavos += v;
          }
        }

        catDespesasMap[catNome] = (catDespesasMap[catNome] || 0) + v;
        if (lan.referencia_recorrencia_id || lan.origem === 'RECORRENTE') {
          despesasFixas += v;
        } else {
          despesasVariaveis += v;
        }

        topDespesas.push({
          id: lan.id,
          descricao: lan.descricao,
          data: dLan,
          categoria: catNome,
          valor_centavos: v,
          situacao: lan.situacao
        });
      }
    }

    // Ordenar Top 10 Maiores Despesas e Receitas
    topDespesas.sort(function (a, b) { return b.valor_centavos - a.valor_centavos; });
    topReceitas.sort(function (a, b) { return b.valor_centavos - a.valor_centavos; });
    topDespesas = topDespesas.slice(0, 10);
    topReceitas = topReceitas.slice(0, 10);

    // Distribuição por Categoria
    var totalDespesasGeral = despesasConfirmadas + despesasPrevistas;
    var distDespesas = [];
    for (var cd in catDespesasMap) {
      var valCd = catDespesasMap[cd];
      distDespesas.push({
        categoria: cd,
        valor_centavos: valCd,
        percentual_bps: totalDespesasGeral > 0 ? Math.round((valCd / totalDespesasGeral) * 10000) : 0
      });
    }
    distDespesas.sort(function (a, b) { return b.valor_centavos - a.valor_centavos; });

    var totalReceitasGeral = receitasConfirmadas + receitasPrevistas;
    var distReceitas = [];
    for (var cr in catReceitasMap) {
      var valCr = catReceitasMap[cr];
      distReceitas.push({
        categoria: cr,
        valor_centavos: valCr,
        percentual_bps: totalReceitasGeral > 0 ? Math.round((valCr / totalReceitasGeral) * 10000) : 0
      });
    }
    distReceitas.sort(function (a, b) { return b.valor_centavos - a.valor_centavos; });

    // 4. Endividamento (Dívidas e Empréstimos)
    var loans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id, function (l) {
      return l.situacao === 'ATIVO';
    });
    var saldoDevedorEmprestimos = 0;
    var parcelasMensaisEmprestimos = 0;
    var consignadosSaldoInformativo = 0;
    for (var el = 0; el < loans.length; el++) {
      saldoDevedorEmprestimos += Number(loans[el].saldo_devedor_centavos || 0);
      parcelasMensaisEmprestimos += Number(loans[el].valor_parcela_centavos || 0);
      if (loans[el].desconto_em_folha) {
        consignadosSaldoInformativo += Number(loans[el].saldo_devedor_centavos || 0);
      }
    }

    var debts = SpreadsheetRepository.findByGrupo('DIVIDAS', user.grupo_id);
    var dividasAcordoAtivo = 0;
    var dividasAntigasInformativo = 0;
    for (var ed = 0; ed < debts.length; ed++) {
      var dItem = debts[ed];
      if (dItem.situacao === 'ACORDO_ATIVO' && dItem.repercutir_fluxo_caixa) {
        dividasAcordoAtivo += Number(dItem.valor_atualizado_centavos || dItem.valor_original_centavos || 0);
      } else if (dItem.situacao === 'ANTIGA' || dItem.situacao === 'PROTESTADA' || !dItem.repercutir_fluxo_caixa) {
        dividasAntigasInformativo += Number(dItem.valor_atualizado_centavos || dItem.valor_original_centavos || 0);
      }
    }

    // 5. Investimentos e Patrimônio Líquido
    var portfolio = InvestmentService.getPortfolioSummary(user);
    var carteiraInvestimentos = portfolio.total_valor_mercado_informado_centavos;
    var totalRendimentosInvestimentos = portfolio.total_rendimentos_registrados_centavos;

    var patrimonioLiquidoEstimado = (saldoBancarioConsolidadoHoje + carteiraInvestimentos) - (saldoDevedorEmprestimos + dividasAcordoAtivo);

    // 6. Orçamento Previsto x Realizado por Categoria
    var orcamentoComparativo = [];
    for (var catId in catMap) {
      var itemCat = catMap[catId];
      if (itemCat.tipo !== 'SAIDA') continue;
      var orcVal = Number(itemCat.orcamento_mensal_centavos || 0);
      var gastoRealizado = 0;
      var gastoPrevisto = 0;

      for (var k = 0; k < launches.length; k++) {
        if (launches[k].categoria_id === catId && launches[k].tipo === 'SAIDA') {
          var lv = Number(launches[k].valor_centavos || 0);
          if (launches[k].situacao === 'CONFIRMADO') gastoRealizado += lv;
          else gastoPrevisto += lv;
        }
      }

      if (orcVal > 0 || gastoRealizado > 0 || gastoPrevisto > 0) {
        var totalComprometido = gastoRealizado + gastoPrevisto;
        var saldoOrcamento = orcVal - totalComprometido;
        orcamentoComparativo.push({
          categoria_id: catId,
          categoria_nome: itemCat.nome,
          orcamento_centavos: orcVal,
          realizado_centavos: gastoRealizado,
          previsto_centavos: gastoPrevisto,
          saldo_orcamento_centavos: saldoOrcamento,
          percentual_consumido_bps: orcVal > 0 ? Math.round((totalComprometido / orcVal) * 10000) : 10000,
          alerta_estourado: saldoOrcamento < 0
        });
      }
    }
    orcamentoComparativo.sort(function (a, b) { return a.saldo_orcamento_centavos - b.saldo_orcamento_centavos; });

    // 7. Evolução Histórica dos Últimos 6 Meses para Gráficos
    var historicalMonths = [];
    var curParts = todayIso.split('-');
    var yrInt = parseInt(curParts[0], 10);
    var moInt = parseInt(curParts[1], 10);
    var monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    for (var mIdx = 5; mIdx >= 0; mIdx--) {
      var dtHist = new Date(Date.UTC(yrInt, moInt - 1 - mIdx, 1));
      var hy = dtHist.getUTCFullYear();
      var hm = dtHist.getUTCMonth() + 1;
      var hym = hy + '-' + String(hm).padStart(2, '0');

      var recM = 0;
      var desM = 0;
      for (var h = 0; h < launches.length; h++) {
        var lh = launches[h];
        if (String(lh.data_lancamento).substring(0, 7) === hym && lh.situacao === 'CONFIRMADO') {
          if (lh.tipo === 'ENTRADA') recM += Number(lh.valor_centavos || 0);
          else if (lh.tipo === 'SAIDA') desM += Number(lh.valor_centavos || 0);
        }
      }

      historicalMonths.push({
        competencia: hym,
        nome_mes: monthsNames[hm - 1] + '/' + String(hy).substring(2),
        receitas_centavos: recM,
        despesas_centavos: desM,
        resultado_centavos: recM - desM
      });
    }

    // 8. Indicadores Executivos
    var resultadoRealizado = receitasConfirmadas - despesasConfirmadas;
    var taxaPoupancaBps = receitasConfirmadas > 0 && resultadoRealizado > 0
      ? Math.round((resultadoRealizado / receitasConfirmadas) * 10000)
      : 0;
    var comprometimentoRendaBps = receitasConfirmadas > 0
      ? Math.round((despesasConfirmadas / receitasConfirmadas) * 10000)
      : (despesasConfirmadas > 0 ? 10000 : 0);

    return {
      periodo: period,
      resumo_executivo: {
        receitas_confirmadas_centavos: receitasConfirmadas,
        receitas_previstas_centavos: receitasPrevistas,
        total_receitas_centavos: totalReceitasGeral,
        despesas_confirmadas_centavos: despesasConfirmadas,
        despesas_previstas_centavos: despesasPrevistas,
        total_despesas_centavos: totalDespesasGeral,
        resultado_realizado_centavos: resultadoRealizado,
        resultado_projetado_centavos: totalReceitasGeral - totalDespesasGeral,
        taxa_poupanca_bps: taxaPoupancaBps,
        comprometimento_renda_bps: comprometimentoRendaBps,
        saldo_bancario_hoje_centavos: saldoBancarioConsolidadoHoje,
        patrimonio_liquido_estimado_centavos: patrimonioLiquidoEstimado,
        situacao_geral: resultadoRealizado >= 0 ? 'SUPERAVIT' : 'DEFICIT'
      },
      contas_compromissos: {
        contas_pagas_count: contasPagasCount,
        contas_pagas_centavos: contasPagasCentavos,
        contas_pendentes_count: contasPendentesCount,
        contas_pendentes_centavos: contasPendentesCentavos,
        contas_vencidas_count: contasVencidasCount,
        contas_vencidas_centavos: contasVencidasCentavos
      },
      despesas_analise: {
        despesas_fixas_centavos: despesasFixas,
        despesas_variaveis_centavos: despesasVariaveis,
        distribuicao_por_categoria: distDespesas,
        top_10_despesas: topDespesas
      },
      receitas_analise: {
        distribuicao_por_categoria: distReceitas,
        top_10_receitas: topReceitas
      },
      endividamento: {
        saldo_devedor_emprestimos_centavos: saldoDevedorEmprestimos,
        parcelas_mensais_emprestimos_centavos: parcelasMensaisEmprestimos,
        consignados_saldo_informativo_centavos: consignadosSaldoInformativo,
        dividas_acordo_ativo_centavos: dividasAcordoAtivo,
        dividas_antigas_informativo_centavos: dividasAntigasInformativo,
        total_passivos_exigiveis_centavos: saldoDevedorEmprestimos + dividasAcordoAtivo
      },
      investimentos: {
        total_aplicado_centavos: portfolio.total_custo_aquisicao_centavos,
        total_mercado_centavos: carteiraInvestimentos,
        total_rendimentos_centavos: totalRendimentosInvestimentos,
        distribuicao_por_classe: portfolio.distribuicao_por_classe
      },
      orcamento_comparativo: orcamentoComparativo,
      evolucao_historica_6m: historicalMonths,
      total_lancamentos_periodo: launches.length
    };
  }

  /**
   * Gera parecer interpretativo do Controller IA para o período analisado
   */
  function getAiNarrativeReport(user, params) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var report = getComprehensiveReport(user, params);
    var exec = report.resumo_executivo;
    var periodLabel = report.periodo.rotulo;

    var fmtRec = ValidationService.formatCentavosToBrl(exec.receitas_confirmadas_centavos);
    var fmtDesp = ValidationService.formatCentavosToBrl(exec.despesas_confirmadas_centavos);
    var fmtRes = ValidationService.formatCentavosToBrl(exec.resultado_realizado_centavos);
    var fmtPatrimonio = ValidationService.formatCentavosToBrl(exec.patrimonio_liquido_estimado_centavos);
    var taxaPoupPercent = (exec.taxa_poupanca_bps / 100).toFixed(1) + '%';
    var compPercent = (exec.comprometimento_renda_bps / 100).toFixed(1) + '%';

    var pontosPositivos = [];
    var pontosAtencao = [];
    var recomendacoes = [];

    if (exec.resultado_realizado_centavos >= 0) {
      pontosPositivos.push('Resultado operacional positivo de ' + fmtRes + ' no período (' + periodLabel + '), gerando margem de segurança financeira.');
      if (exec.taxa_poupanca_bps >= 1500) {
        pontosPositivos.push('Taxa de economia saudável de ' + taxaPoupPercent + ' da renda líquida confirmada, acima do piso recomendado de 10% a 15%.');
      }
    } else {
      pontosAtencao.push('Déficit operacional de ' + fmtRes + ' no período analisado: as saídas realizadas superaram as entradas confirmadas.');
      pontosAtencao.push('Comprometimento da renda alcançou ' + compPercent + ', exigindo contenção de despesas variáveis e revisão de limites.');
      recomendacoes.push('Priorizar corte temporário em categorias variáveis e não essenciais até recompor o fluxo de caixa positivo.');
    }

    if (report.contas_compromissos.contas_vencidas_count > 0) {
      pontosAtencao.push('Identificamos ' + report.contas_compromissos.contas_vencidas_count + ' conta(s) vencida(s) totalizando ' + ValidationService.formatCentavosToBrl(report.contas_compromissos.contas_vencidas_centavos) + '. Regularize para evitar juros.');
      recomendacoes.push('Realizar a quitação imediata das contas vencidas para evitar incidência de encargos moratórios e protestos.');
    }

    if (report.endividamento.total_passivos_exigiveis_centavos > 0) {
      var fmtPassivo = ValidationService.formatCentavosToBrl(report.endividamento.total_passivos_exigiveis_centavos);
      pontosAtencao.push('Passivos exigíveis sob controle somam ' + fmtPassivo + ' em empréstimos e parcelas de acordos em andamento.');
      recomendacoes.push('Acompanhar o cronograma de amortizações de empréstimos e avaliar liquidação antecipada de contratos com taxas de juros mais altas.');
    } else {
      pontosPositivos.push('Ausência de endividamento oneroso ativo ou empréstimos pessoais pendentes de quitação.');
    }

    if (report.investimentos.total_mercado_centavos > 0) {
      pontosPositivos.push('Patrimônio investido de ' + ValidationService.formatCentavosToBrl(report.investimentos.total_mercado_centavos) + ', contribuindo para a geração de renda passiva e valorização real.');
    } else {
      recomendacoes.push('Iniciar a formação da Reserva de Emergência em ativos de Renda Fixa com liquidez diária (como Tesouro Selic ou CDB 100% CDI).');
    }

    var orcEstourados = report.orcamento_comparativo.filter(function (o) { return o.alerta_estourado; });
    if (orcEstourados.length > 0) {
      var nomesEst = orcEstourados.map(function (o) { return o.categoria_nome; }).join(', ');
      pontosAtencao.push('Categorias que ultrapassaram o teto orçado no período: ' + nomesEst + '.');
      recomendacoes.push('Reavaliar o teto das categorias estouradas ou remanejar sobras de outras áreas para equilibrar o mês.');
    } else if (report.orcamento_comparativo.length > 0) {
      pontosPositivos.push('Todas as categorias orçadas permaneceram dentro do limite estipulado no planejamento.');
    }

    var resumoExecutivo = 'No período analisado (' + periodLabel + '), suas receitas totalizaram ' + fmtRec + ' contra ' + fmtDesp + ' em despesas, ' +
      (exec.resultado_realizado_centavos >= 0
        ? 'resultando em um superávit de ' + fmtRes + ' e taxa de economia de ' + taxaPoupPercent + '.'
        : 'gerando um descompasso de ' + fmtRes + ' no fluxo operacional.') +
      ' O patrimônio líquido estimado atual está consolidado em ' + fmtPatrimonio + '.';

    return {
      periodo: periodLabel,
      data_analise: SpreadsheetRepository.nowIso(),
      resumo_executivo: resumoExecutivo,
      pontos_positivos: pontosPositivos,
      pontos_atencao: pontosAtencao,
      recomendacoes: recomendacoes,
      tendencia: exec.resultado_realizado_centavos >= 0 ? 'FAVORAVEL' : 'ATENCAO',
      indicadores_chave: {
        receitas_confirmadas: fmtRec,
        despesas_confirmadas: fmtDesp,
        resultado_liquido: fmtRes,
        taxa_poupanca: taxaPoupPercent,
        comprometimento_renda: compPercent,
        patrimonio_liquido: fmtPatrimonio
      }
    };
  }

  /**
   * Calcula a Demonstração do Resultado do Exercício (DRE Gerencial Completa)
   * sob o Regime de Competência, com análise vertical (AV %) e conciliação de caixa.
   */
  function getDreReport(user, params) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = params || {};
    var period = resolvePeriodDates(p);
    var startIso = period.data_inicio;
    var endIso = period.data_fim;

    var categories = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var subcategories = SpreadsheetRepository.findByGrupo('SUBCATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < categories.length; c++) catMap[categories[c].id] = categories[c];
    var subMap = {};
    for (var s = 0; s < subcategories.length; s++) subMap[subcategories[s].id] = subcategories[s];

    // Lançamentos do grupo
    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      if (l.situacao === 'CANCELADO') return false;
      if (l.natureza_operacao === 'TRANSFERENCIA') return false;
      var d = normalizeDateIso(l.data_lancamento);
      return d && d >= startIso && d <= endIso;
    });

    // Compras no cartão no período (competência do cartão)
    var cardPurchases = [];
    try {
      cardPurchases = SpreadsheetRepository.findByGrupo('COMPRAS_CARTAO', user.grupo_id, function (cp) {
        if (cp.situacao === 'CANCELADO') return false;
        var d = normalizeDateIso(cp.data_compra);
        return d && d >= startIso && d <= endIso;
      });
    } catch (eCard) {}

    // Faturas quitadas no período (caixa de cartão)
    var cardInvoicesPaid = [];
    try {
      cardInvoicesPaid = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id, function (fc) {
        if (fc.situacao !== 'PAGA') return false;
        var d = normalizeDateIso(fc.data_pagamento || fc.data_vencimento);
        return d && d >= startIso && d <= endIso;
      });
    } catch (eInv) {}

    // Grupos contábeis
    var receitaAtivaCentavos = 0;
    var receitaAtivaItens = [];
    var outrasReceitasCentavos = 0;
    var outrasReceitasItens = [];
    var deducoesCentavos = 0;
    var deducoesItens = [];

    var custosEssenciaisCentavos = 0;
    var custosEssenciaisItens = [];
    var despesasDiscricionariasCentavos = 0;
    var despesasDiscricionariasItens = [];

    var receitasFinanceirasCentavos = 0;
    var receitasFinanceirasItens = [];
    var despesasFinanceirasCentavos = 0;
    var despesasFinanceirasItens = [];

    var caixaEntradasCentavos = 0;
    var caixaSaidasCentavos = 0;

    // Função de classificação contábil inteligente
    function classificarDespesa(catNome, subNome, desc) {
      var text = (catNome + ' ' + subNome + ' ' + desc).toLowerCase();
      if (/juros|tarifa|encargo|iof|anuidade|financiamento|empréstimo|consignado|acordo|multa/i.test(text)) {
        return 'FINANCEIRA';
      }
      if (/moradia|aluguel|condomínio|energia|luz|água|gás|iptu|supermercado|feira|açougue|saúde|médic|farmácia|plano de saúde|transporte público|combustível|escola|educação|mensalidade escolar|internet/i.test(text)) {
        return 'ESSENCIAL';
      }
      return 'DISCRICIONARIA';
    }

    function classificarReceita(catNome, subNome, desc) {
      var text = (catNome + ' ' + subNome + ' ' + desc).toLowerCase();
      if (/investimento|rendimento|dividendo|provento|juros sobre capital|cdi|selic|poupança/i.test(text)) {
        return 'FINANCEIRA';
      }
      if (/imposto|darf|tributo|das|simples|retenção/i.test(text)) {
        return 'DEDUCAO';
      }
      if (/salário|pró-labore|faturamento|honorário|comissão|quinzena|ordenado/i.test(text)) {
        return 'ATIVA';
      }
      return 'OUTRAS';
    }

    // Processa lançamentos
    for (var i = 0; i < launches.length; i++) {
      var l = launches[i];
      var val = Number(l.valor_centavos || 0);
      var cat = catMap[l.categoria_id];
      var catNome = cat ? cat.nome : 'Sem Categoria';
      var sub = subMap[l.subcategoria_id];
      var subNome = sub ? sub.nome : '';
      var desc = l.descricao || '';

      if (l.tipo === 'ENTRADA') {
        if (l.situacao === 'CONFIRMADO') {
          caixaEntradasCentavos += val;
        }
        var tipoRec = classificarReceita(catNome, subNome, desc);
        if (tipoRec === 'FINANCEIRA') {
          receitasFinanceirasCentavos += val;
          receitasFinanceirasItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        } else if (tipoRec === 'DEDUCAO') {
          deducoesCentavos += val;
          deducoesItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        } else if (tipoRec === 'ATIVA') {
          receitaAtivaCentavos += val;
          receitaAtivaItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        } else {
          outrasReceitasCentavos += val;
          outrasReceitasItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        }
      } else if (l.tipo === 'SAIDA') {
        if (l.situacao === 'CONFIRMADO') {
          caixaSaidasCentavos += val;
        }
        var tipoDesp = classificarDespesa(catNome, subNome, desc);
        if (tipoDesp === 'FINANCEIRA') {
          despesasFinanceirasCentavos += val;
          despesasFinanceirasItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        } else if (tipoDesp === 'ESSENCIAL') {
          custosEssenciaisCentavos += val;
          custosEssenciaisItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        } else {
          despesasDiscricionariasCentavos += val;
          despesasDiscricionariasItens.push({ descricao: desc, categoria: catNome, valor_centavos: val });
        }
      }
    }

    // Processa compras de cartão de crédito no período
    var comprasCartaoPeriodoCentavos = 0;
    for (var cp = 0; cp < cardPurchases.length; cp++) {
      var purchase = cardPurchases[cp];
      var valCp = Number(purchase.valor_total_centavos || 0);
      comprasCartaoPeriodoCentavos += valCp;
      var catCp = catMap[purchase.categoria_id];
      var catCpNome = catCp ? catCp.nome : 'Cartão de Crédito';
      var descCp = purchase.descricao || 'Compra no Cartão';

      var tipoCp = classificarDespesa(catCpNome, '', descCp);
      if (tipoCp === 'FINANCEIRA') {
        despesasFinanceirasCentavos += valCp;
        despesasFinanceirasItens.push({ descricao: descCp + ' (Cartão)', categoria: catCpNome, valor_centavos: valCp });
      } else if (tipoCp === 'ESSENCIAL') {
        custosEssenciaisCentavos += valCp;
        custosEssenciaisItens.push({ descricao: descCp + ' (Cartão)', categoria: catCpNome, valor_centavos: valCp });
      } else {
        despesasDiscricionariasCentavos += valCp;
        despesasDiscricionariasItens.push({ descricao: descCp + ' (Cartão)', categoria: catCpNome, valor_centavos: valCp });
      }
    }

    // Faturas quitadas no período
    var faturasPagasCaixaCentavos = 0;
    for (var f = 0; f < cardInvoicesPaid.length; f++) {
      faturasPagasCaixaCentavos += Number(cardInvoicesPaid[f].valor_total_centavos || 0);
    }

    // Totais e Cálculos Contábeis
    var receitaOperacionalBrutaCentavos = receitaAtivaCentavos + outrasReceitasCentavos;
    var receitaLiquidaCentavos = Math.max(0, receitaOperacionalBrutaCentavos - deducoesCentavos);
    var baseAv = receitaLiquidaCentavos > 0 ? receitaLiquidaCentavos : (receitaOperacionalBrutaCentavos > 0 ? receitaOperacionalBrutaCentavos : 1);

    var lucroBrutoCentavos = receitaLiquidaCentavos - custosEssenciaisCentavos;
    var margemBrutaPct = Math.round((lucroBrutoCentavos / baseAv) * 1000) / 10;

    var ebitdaPessoalCentavos = lucroBrutoCentavos - despesasDiscricionariasCentavos;
    var margemOperacionalPct = Math.round((ebitdaPessoalCentavos / baseAv) * 1000) / 10;

    var resultadoFinanceiroCentavos = receitasFinanceirasCentavos - despesasFinanceirasCentavos;

    var resultadoLiquidoCentavos = ebitdaPessoalCentavos + resultadoFinanceiroCentavos;
    var margemLiquidaPct = Math.round((resultadoLiquidoCentavos / baseAv) * 1000) / 10;

    var caixaLiquidoCentavos = caixaEntradasCentavos - caixaSaidasCentavos;
    var diferencaCompetenciaCaixaCentavos = resultadoLiquidoCentavos - caixaLiquidoCentavos;

    function calcularAv(valCentavos) {
      if (baseAv <= 0) return 0;
      return Math.round((valCentavos / baseAv) * 1000) / 10;
    }

    return {
      periodo: period,
      base_receita_liquida_centavos: receitaLiquidaCentavos,
      receita_operacional_bruta: {
        total_centavos: receitaOperacionalBrutaCentavos,
        av_pct: calcularAv(receitaOperacionalBrutaCentavos),
        receita_ativa_centavos: receitaAtivaCentavos,
        receita_ativa_av_pct: calcularAv(receitaAtivaCentavos),
        outras_receitas_centavos: outrasReceitasCentavos,
        outras_receitas_av_pct: calcularAv(outrasReceitasCentavos),
        itens_destaque: receitaAtivaItens.slice(0, 5)
      },
      deducoes_tributos: {
        total_centavos: deducoesCentavos,
        av_pct: calcularAv(deducoesCentavos),
        itens: deducoesItens
      },
      receita_liquida: {
        total_centavos: receitaLiquidaCentavos,
        av_pct: 100.0
      },
      custos_essenciais: {
        total_centavos: custosEssenciaisCentavos,
        av_pct: calcularAv(custosEssenciaisCentavos),
        itens_destaque: custosEssenciaisItens.slice(0, 8)
      },
      lucro_bruto: {
        total_centavos: lucroBrutoCentavos,
        margem_pct: margemBrutaPct
      },
      despesas_discricionarias: {
        total_centavos: despesasDiscricionariasCentavos,
        av_pct: calcularAv(despesasDiscricionariasCentavos),
        itens_destaque: despesasDiscricionariasItens.slice(0, 8)
      },
      resultado_operacional_ebitda: {
        total_centavos: ebitdaPessoalCentavos,
        margem_pct: margemOperacionalPct
      },
      resultado_financeiro: {
        total_centavos: resultadoFinanceiroCentavos,
        receitas_financeiras_centavos: receitasFinanceirasCentavos,
        receitas_financeiras_av_pct: calcularAv(receitasFinanceirasCentavos),
        despesas_financeiras_centavos: despesasFinanceirasCentavos,
        despesas_financeiras_av_pct: calcularAv(despesasFinanceirasCentavos)
      },
      resultado_liquido: {
        total_centavos: resultadoLiquidoCentavos,
        margem_liquida_pct: margemLiquidaPct,
        situacao: resultadoLiquidoCentavos >= 0 ? 'LUCRO' : 'PREJUIZO'
      },
      conciliacao_caixa: {
        caixa_entradas_centavos: caixaEntradasCentavos,
        caixa_saidas_centavos: caixaSaidasCentavos,
        caixa_liquido_centavos: caixaLiquidoCentavos,
        compras_cartao_periodo_centavos: comprasCartaoPeriodoCentavos,
        faturas_pagas_caixa_centavos: faturasPagasCaixaCentavos,
        diferenca_centavos: diferencaCompetenciaCaixaCentavos
      }
    };
  }

  return {
    getComprehensiveReport: getComprehensiveReport,
    getAiNarrativeReport: getAiNarrativeReport,
    getDreReport: getDreReport
  };
})();
