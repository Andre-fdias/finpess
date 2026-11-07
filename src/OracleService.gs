/**
 * @file OracleService.gs
 * @description Motor autônomo, determinístico e analítico do Oráculo IA 2.0.
 * Responsável pelo Índice de Saúde Financeira, monitoramento contínuo de riscos,
 * central de alertas proativos, detector de gargalos, simulador hipotético de cenários
 * e plano de ação estruturado, garantindo cálculos exatos no backend sem alucinações.
 */

var OracleService = (function () {

  /**
   * Calcula o Índice de Saúde Financeira pessoal/familiar (0 a 100) baseado em 6 dimensões
   * auditáveis com critérios transparentes e objetivos.
   */
  function getHealthScore(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var todayIso = SpreadsheetRepository.todayIso();
    var targetMonth = (mesReferencia && /^\d{4}-\d{2}$/.test(mesReferencia))
      ? mesReferencia
      : todayIso.substring(0, 7);

    var dashData = FinanceService.getDashboardData(user, targetMonth);
    var confirmados = dashData.confirmados;
    var previstos = dashData.previstos;
    var pendentes = dashData.pendentes;

    var recTotal = confirmados.receitas_realizadas_mes_centavos + previstos.receitas_previstas_mes_centavos;
    var despTotal = confirmados.despesas_pagas_mes_centavos + previstos.despesas_previstas_mes_centavos + pendentes.despesas_pendentes_mes_centavos;
    var saldoDisponivel = confirmados.saldo_bancario_consolidado_centavos;

    // 1. Dimensão: Fluxo de Caixa (Peso 25%)
    var scoreFluxo = 50;
    var saldoPeriodo = recTotal - despTotal;
    if (recTotal > 0) {
      var margemFluxo = (saldoPeriodo / recTotal);
      if (margemFluxo >= 0.25) scoreFluxo = 100;
      else if (margemFluxo >= 0.15) scoreFluxo = 85;
      else if (margemFluxo >= 0.05) scoreFluxo = 75;
      else if (margemFluxo >= 0.00) scoreFluxo = 65;
      else if (margemFluxo >= -0.15) scoreFluxo = 40;
      else scoreFluxo = 20;
    } else {
      scoreFluxo = despTotal === 0 ? 70 : 25;
    }

    // 2. Dimensão: Capacidade de Poupança (Peso 15%)
    var scorePoupanca = 40;
    if (recTotal > 0 && saldoPeriodo > 0) {
      var taxaPoupanca = (saldoPeriodo / recTotal);
      if (taxaPoupanca >= 0.20) scorePoupanca = 100;
      else if (taxaPoupanca >= 0.10) scorePoupanca = 80;
      else scorePoupanca = 60;
    } else if (saldoPeriodo <= 0) {
      scorePoupanca = 20;
    }

    // 3. Dimensão: Endividamento e Empréstimos (Peso 20%)
    var scoreDividas = 90;
    var loans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id, function (l) {
      return l.situacao === 'ATIVO';
    });
    var debts = SpreadsheetRepository.findByGrupo('DIVIDAS', user.grupo_id);

    var parcelasMensais = 0;
    var saldoDevedorTotal = 0;
    for (var i = 0; i < loans.length; i++) {
      saldoDevedorTotal += Number(loans[i].saldo_devedor_centavos || 0);
      parcelasMensais += Number(loans[i].valor_parcela_centavos || 0);
    }

    var dividasAcordo = 0;
    for (var d = 0; d < debts.length; d++) {
      if (debts[d].situacao === 'ACORDO_ATIVO' && debts[d].repercutir_fluxo_caixa) {
        dividasAcordo += Number(debts[d].valor_atualizado_centavos || debts[d].valor_original_centavos || 0);
      }
    }

    var comprometimentoRendaBps = recTotal > 0 ? Math.round((parcelasMensais / recTotal) * 10000) : 0;
    if (parcelasMensais === 0 && saldoDevedorTotal === 0 && dividasAcordo === 0) {
      scoreDividas = 100;
    } else if (comprometimentoRendaBps <= 1000) {
      scoreDividas = 85;
    } else if (comprometimentoRendaBps <= 2500) {
      scoreDividas = 70;
    } else if (comprometimentoRendaBps <= 3500) {
      scoreDividas = 45;
    } else {
      scoreDividas = 20;
    }

    // 4. Dimensão: Liquidez e Segurança Imediata (Peso 15%)
    var scoreLiquidez = 70;
    var contasVencidasCentavos = 0;
    for (var cv = 0; cv < pendentes.contas_vencidas.length; cv++) {
      contasVencidasCentavos += pendentes.contas_vencidas[cv].valor_centavos;
    }
    var contasAVencerCentavos = 0;
    for (var ca = 0; ca < pendentes.contas_a_vencer.length; ca++) {
      contasAVencerCentavos += pendentes.contas_a_vencer[ca].valor_centavos;
    }

    if (contasVencidasCentavos > 0) {
      scoreLiquidez = 25; // Penalização grave por contas vencidas
    } else if (contasAVencerCentavos > 0) {
      if (saldoDisponivel >= (contasAVencerCentavos * 1.5)) {
        scoreLiquidez = 100;
      } else if (saldoDisponivel >= contasAVencerCentavos) {
        scoreLiquidez = 75;
      } else {
        scoreLiquidez = 35; // Risco iminente de saldo negativo
      }
    } else {
      scoreLiquidez = saldoDisponivel >= 0 ? 90 : 20;
    }

    // 5. Dimensão: Planejamento e Orçamento (Peso 15%)
    var scorePlanejamento = 75;
    var categoriasEstouradas = 0;
    var categoriasComOrcamento = 0;
    var catGastos = dashData.evolucao_gastos_por_categoria || [];
    for (var c = 0; c < catGastos.length; c++) {
      if (catGastos[c].orcamento_centavos > 0) {
        categoriasComOrcamento++;
        if (catGastos[c].total_comprometido_centavos > catGastos[c].orcamento_centavos) {
          categoriasEstouradas++;
        }
      }
    }
    if (categoriasComOrcamento > 0) {
      if (categoriasEstouradas === 0) scorePlanejamento = 100;
      else if (categoriasEstouradas === 1) scorePlanejamento = 65;
      else scorePlanejamento = 35;
    } else {
      scorePlanejamento = 70; // Neutro sem orçamentos cadastrados
    }

    // 6. Dimensão: Patrimônio e Investimentos (Peso 10%)
    var scorePatrimonio = 60;
    var portfolio = InvestmentService.getPortfolioSummary(user);
    var investCentavos = portfolio.total_valor_mercado_informado_centavos;
    var patrimonioLiquido = (saldoDisponivel + investCentavos) - (saldoDevedorTotal + dividasAcordo);

    if (investCentavos > 0 && patrimonioLiquido > 0) {
      scorePatrimonio = 100;
    } else if (patrimonioLiquido > 0) {
      scorePatrimonio = 75;
    } else if (patrimonioLiquido === 0) {
      scorePatrimonio = 50;
    } else {
      scorePatrimonio = 25;
    }

    // Nota Ponderada Geral (0 a 100)
    var notaFinal = Math.round(
      (scoreFluxo * 0.25) +
      (scorePoupanca * 0.15) +
      (scoreDividas * 0.20) +
      (scoreLiquidez * 0.15) +
      (scorePlanejamento * 0.15) +
      (scorePatrimonio * 0.10)
    );
    if (notaFinal < 0) notaFinal = 0;
    if (notaFinal > 100) notaFinal = 100;

    // Faixas de Classificação
    var classificacao = 'SAUDAVEL';
    var faixaRotulo = 'Saudável';
    var badgeClass = 'badge-primario';

    if (notaFinal >= 80) {
      classificacao = 'EXCELENTE';
      faixaRotulo = 'Excelente';
      badgeClass = 'badge-confirmado';
    } else if (notaFinal >= 60) {
      classificacao = 'SAUDAVEL';
      faixaRotulo = 'Saudável';
      badgeClass = 'badge-primario';
    } else if (notaFinal >= 40) {
      classificacao = 'ATENCAO';
      faixaRotulo = 'Atenção';
      badgeClass = 'badge-pendente';
    } else if (notaFinal >= 20) {
      classificacao = 'VULNERAVEL';
      faixaRotulo = 'Vulnerável';
      badgeClass = 'badge-vencido';
    } else {
      classificacao = 'CRITICA';
      faixaRotulo = 'Crítica';
      badgeClass = 'badge-vencido';
    }

    // Identificação de Fatores Positivos e de Atenção
    var pontosFortes = [];
    var pontosAtencao = [];
    var acoesRecomendadas = [];

    if (saldoPeriodo > 0) {
      pontosFortes.push('Fluxo de caixa superavitário no mês (+ ' + ValidationService.formatCentavosToBrl(saldoPeriodo) + ').');
    } else {
      pontosAtencao.push('Despesas previstas e confirmadas superam as receitas no mês (déficit de ' + ValidationService.formatCentavosToBrl(Math.abs(saldoPeriodo)) + ').');
      acoesRecomendadas.push('Conter gastos discricionários imediatos para restabelecer o equilíbrio do fluxo de caixa.');
    }

    if (contasVencidasCentavos > 0) {
      pontosAtencao.push('Existem contas vencidas pendentes de quitação totalizando ' + ValidationService.formatCentavosToBrl(contasVencidasCentavos) + '.');
      acoesRecomendadas.push('Priorizar o pagamento das contas em atraso para estancar juros de mora e multas.');
    } else {
      pontosFortes.push('Nenhuma conta vencida pendente no período atual.');
    }

    if (comprometimentoRendaBps > 3000) {
      pontosAtencao.push('Comprometimento da renda com parcelas de dívidas/empréstimos está elevado (' + (comprometimentoRendaBps / 100).toFixed(1) + '% da renda).');
      acoesRecomendadas.push('Avaliar amortização prioritária ou renegociação para reduzir parcelas mensais.');
    } else if (saldoDevedorTotal === 0 && dividasAcordo === 0) {
      pontosFortes.push('Livre de dívidas bancárias ou empréstimos ativos.');
    }

    if (categoriasEstouradas > 0) {
      pontosAtencao.push(categoriasEstouradas + ' categoria(s) financeira(s) ultrapassaram o teto orçamentário configurado.');
      acoesRecomendadas.push('Revisar o limite ou conter compras nas categorias que estouraram o orçamento.');
    }

    if (investCentavos > 0) {
      pontosFortes.push('Patrimônio investido ativo de ' + ValidationService.formatCentavosToBrl(investCentavos) + '.');
    } else if (saldoPeriodo > 0) {
      acoesRecomendadas.push('Iniciar a formação da reserva de emergência aportando o excedente mensal em ativos de liquidez diária.');
    }

    return {
      periodo: targetMonth,
      nota: notaFinal,
      classificacao: classificacao,
      faixa_rotulo: faixaRotulo,
      badge_class: badgeClass,
      dimensoes: {
        fluxo_caixa: { score: scoreFluxo, peso: 25, nome: 'Fluxo de Caixa' },
        poupanca: { score: scorePoupanca, peso: 15, nome: 'Capacidade de Poupança' },
        endividamento: { score: scoreDividas, peso: 20, nome: 'Endividamento' },
        liquidez: { score: scoreLiquidez, peso: 15, nome: 'Liquidez e Segurança' },
        planejamento: { score: scorePlanejamento, peso: 15, nome: 'Orçamento e Metas' },
        patrimonio: { score: scorePatrimonio, peso: 10, nome: 'Patrimônio e Investimentos' }
      },
      pontos_fortes: pontosFortes,
      pontos_atencao: pontosAtencao,
      acoes_recomendadas: acoesRecomendadas,
      resumo_contabil: {
        receitas_total_centavos: recTotal,
        despesas_total_centavos: despTotal,
        saldo_periodo_centavos: saldoPeriodo,
        saldo_bancario_disponivel_centavos: saldoDisponivel,
        saldo_devedor_total_centavos: saldoDevedorTotal,
        patrimonio_liquido_centavos: patrimonioLiquido,
        investimentos_centavos: investCentavos
      }
    };
  }

  /**
   * Monitoramento contínuo: realiza varredura determinística de riscos e oportunidades financeiras,
   * gerando uma central de alertas proativos com priorização rigorosa.
   */
  function getProactiveAlerts(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var health = getHealthScore(user, mesReferencia);
    var targetMonth = health.periodo;
    var dashData = FinanceService.getDashboardData(user, targetMonth);
    var confirmados = dashData.confirmados;
    var pendentes = dashData.pendentes;
    var saldoDisponivel = confirmados.saldo_bancario_consolidado_centavos;

    var alerts = [];

    // Alerta 1: Contas Vencidas (CRÍTICA)
    var cvList = pendentes.contas_vencidas || [];
    if (cvList.length > 0) {
      var totalCv = 0;
      for (var i = 0; i < cvList.length; i++) totalCv += cvList[i].valor_centavos;
      alerts.push({
        id: 'alt_vencidas',
        titulo: 'Contas Vencidas Pendentes de Pagamento',
        categoria: 'LIQUIDEZ',
        prioridade: 'CRITICA',
        gravidade: 'badge-vencido',
        descricao: 'Existem ' + cvList.length + ' conta(s) com data de vencimento ultrapassada ainda em aberto.',
        valor_centavos: totalCv,
        causa: 'Atraso na baixa ou falta de pagamento nas datas previstas.',
        acao_sugerida: 'Efetuar a quitação imediata ou marcar baixa em Lançamentos para evitar juros e multas.'
      });
    }

    // Alerta 2: Risco de Saldo Negativo antes de novas receitas (CRÍTICA)
    var caList = pendentes.contas_a_vencer || [];
    var acumuladoSaidas = 0;
    var deficitDetectado = 0;
    for (var j = 0; j < caList.length; j++) {
      acumuladoSaidas += caList[j].valor_centavos;
      if (acumuladoSaidas > saldoDisponivel && deficitDetectado === 0) {
        deficitDetectado = acumuladoSaidas - saldoDisponivel;
      }
    }
    if (deficitDetectado > 0) {
      alerts.push({
        id: 'alt_risco_saldo',
        titulo: 'Risco de Insuficiência de Saldo no Período',
        categoria: 'FLUXO_CAIXA',
        prioridade: 'CRITICA',
        gravidade: 'badge-vencido',
        descricao: 'Os compromissos futuros do mês ultrapassam o saldo bancário disponível atual em ' + ValidationService.formatCentavosToBrl(deficitDetectado) + '.',
        valor_centavos: deficitDetectado,
        causa: 'Volume de despesas a pagar no curto prazo supera o saldo em conta antes da entrada de novas receitas.',
        acao_sugerida: 'Provisionar recursos na conta ou postergar compras facultativas até a liquidação de receitas previstas.'
      });
    }

    // Alerta 3: Orçamentos de Categoria Estourados (ALTA)
    var catGastos = dashData.evolucao_gastos_por_categoria || [];
    for (var k = 0; k < catGastos.length; k++) {
      var cat = catGastos[k];
      if (cat.orcamento_centavos > 0 && cat.total_comprometido_centavos > cat.orcamento_centavos) {
        var estouro = cat.total_comprometido_centavos - cat.orcamento_centavos;
        alerts.push({
          id: 'alt_orcamento_' + cat.categoria_id,
          titulo: 'Orçamento Excedido: ' + cat.categoria_nome,
          categoria: 'ORCAMENTO',
          prioridade: 'ALTA',
          gravidade: 'badge-pendente',
          descricao: 'Os gastos na categoria ' + cat.categoria_nome + ' superaram o teto mensal configurado.',
          valor_centavos: estouro,
          causa: 'Consumo de ' + ValidationService.formatCentavosToBrl(cat.total_comprometido_centavos) + ' para um orçamento de ' + ValidationService.formatCentavosToBrl(cat.orcamento_centavos) + '.',
          acao_sugerida: 'Bloquear novas despesas nessa categoria até o próximo mês ou ajustar o orçamento planejado.'
        });
      }
    }

    // Alerta 4: Comprometimento Elevado da Renda com Dívidas (ALTA)
    var recTotal = health.resumo_contabil.receitas_total_centavos;
    var loans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id, function (l) { return l.situacao === 'ATIVO'; });
    var parcelasTotal = 0;
    for (var el = 0; el < loans.length; el++) parcelasTotal += Number(loans[el].valor_parcela_centavos || 0);

    if (recTotal > 0 && parcelasTotal > 0) {
      var pctComprometido = Math.round((parcelasTotal / recTotal) * 100);
      if (pctComprometido >= 30) {
        alerts.push({
          id: 'alt_comprometimento_dividas',
          titulo: 'Comprometimento Elevado com Empréstimos (' + pctComprometido + '%)',
          categoria: 'ENDIVIDAMENTO',
          prioridade: 'ALTA',
          gravidade: 'badge-pendente',
          descricao: 'As parcelas mensais de empréstimos absorvem ' + pctComprometido + '% da receita prevista do mês.',
          valor_centavos: parcelasTotal,
          causa: 'Volume acumulado de financiamentos e empréstimos ativos.',
          acao_sugerida: 'Evitar novas contratações de crédito e destinar eventuais receitas extraordinárias para amortizar parcelas com maiores taxas.'
        });
      }
    }

    // Alerta 5: Concentração Excessiva em Categoria Única (MÉDIA)
    var despTotal = health.resumo_contabil.despesas_total_centavos;
    if (despTotal > 0) {
      for (var c = 0; c < catGastos.length; c++) {
        var gItem = catGastos[c];
        var pctCat = Math.round((gItem.total_comprometido_centavos / despTotal) * 100);
        if (pctCat >= 40 && despTotal >= 100000) {
          alerts.push({
            id: 'alt_concentracao_' + gItem.categoria_id,
            titulo: 'Alta Concentração de Despesas: ' + gItem.categoria_nome,
            categoria: 'DESPESAS',
            prioridade: 'MEDIA',
            gravidade: 'badge-info',
            descricao: 'A categoria ' + gItem.categoria_nome + ' representa ' + pctCat + '% de todas as saídas do mês.',
            valor_centavos: gItem.total_comprometido_centavos,
            causa: 'Gastos altamente concentrados em uma única rubrica financeira.',
            acao_sugerida: 'Auditar as despesas desta categoria para verificar itens renegociáveis ou custos evitáveis.'
          });
        }
      }
    }

    // Alerta 6: Oportunidade de Investimento e Acúmulo de Capital (BAIXA - Oportunidade)
    if (health.resumo_contabil.saldo_periodo_centavos >= 50000 && saldoDisponivel >= 100000 && cvList.length === 0) {
      alerts.push({
        id: 'alt_oportunidade_aporte',
        titulo: 'Oportunidade de Aporte em Investimentos',
        categoria: 'PATRIMONIO',
        prioridade: 'BAIXA',
        gravidade: 'badge-confirmado',
        descricao: 'Você possui superávit mensal consolidado de ' + ValidationService.formatCentavosToBrl(health.resumo_contabil.saldo_periodo_centavos) + ' e caixa livre.',
        valor_centavos: health.resumo_contabil.saldo_periodo_centavos,
        causa: 'Receitas realizadas superaram os compromissos com folga de liquidez.',
        acao_sugerida: 'Direcionar parte deste excedente para sua carteira de investimentos segundo seu perfil de suitability.'
      });
    }

    return {
      periodo: targetMonth,
      total_alertas: alerts.length,
      alertas_criticos: alerts.filter(function (a) { return a.prioridade === 'CRITICA'; }).length,
      alertas_altos: alerts.filter(function (a) { return a.prioridade === 'ALTA'; }).length,
      itens: alerts
    };
  }

  /**
   * Identifica os principais gargalos financeiros (despesas excessivas, custos fixos vs discricionários)
   * e calcula oportunidades práticas de economia mensal sem atingir necessidades essenciais.
   */
  function getFinancialBottlenecks(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var health = getHealthScore(user, mesReferencia);
    var targetMonth = health.periodo;
    var dashData = FinanceService.getDashboardData(user, targetMonth);

    var catGastos = dashData.evolucao_gastos_por_categoria || [];
    var despTotal = health.resumo_contabil.despesas_total_centavos;

    // Classificação de categorias e detecção de gargalos
    var rankingGargalos = [];
    var potencialEconomiaTotal = 0;

    for (var i = 0; i < catGastos.length; i++) {
      var item = catGastos[i];
      var totalComp = item.total_comprometido_centavos;
      if (totalComp <= 0) continue;

      var pesoPct = despTotal > 0 ? Math.round((totalComp / despTotal) * 100) : 0;
      var nomeMin = item.categoria_nome.toLowerCase();

      // Classifica se é essencial (alimentação, moradia, saúde, educação) ou discricionário
      var isEssencial = (
        nomeMin.indexOf('moradia') !== -1 ||
        nomeMin.indexOf('aluguel') !== -1 ||
        nomeMin.indexOf('condom') !== -1 ||
        nomeMin.indexOf('saúde') !== -1 ||
        nomeMin.indexOf('saude') !== -1 ||
        nomeMin.indexOf('educa') !== -1 ||
        nomeMin.indexOf('escola') !== -1 ||
        nomeMin.indexOf('remédio') !== -1
      );

      var pctSugeridoCorte = isEssencial ? 5 : 15;
      var economiaEstimada = Math.round((totalComp * pctSugeridoCorte) / 100);
      potencialEconomiaTotal += economiaEstimada;

      rankingGargalos.push({
        categoria_id: item.categoria_id,
        categoria_nome: item.categoria_nome,
        valor_comprometido_centavos: totalComp,
        participacao_pct: pesoPct,
        natureza: isEssencial ? 'Essencial / Fixa' : 'Discricionária / Ajustável',
        percentual_otimizacao_sugerido: pctSugeridoCorte,
        economia_potencial_centavos: economiaEstimada,
        recomendacao: isEssencial
          ? 'Rever contratos e prestadores de serviço sem comprometer o essencial.'
          : 'Reduzir saídas supérfluas ou compras por impulso nesta categoria.'
      });
    }

    rankingGargalos.sort(function (a, b) {
      return b.valor_comprometido_centavos - a.valor_comprometido_centavos;
    });

    // Comparação Custos Fixos Recorrentes vs Custos Variáveis
    var recorrentes = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id, function (r) {
      return r.situacao === 'ATIVA' && r.tipo === 'SAIDA';
    });
    var totalRecorrentesMensal = 0;
    for (var r = 0; r < recorrentes.length; r++) {
      totalRecorrentesMensal += Number(recorrentes[r].valor_previsto_centavos || 0);
    }

    var variaveisCentavos = despTotal > totalRecorrentesMensal ? (despTotal - totalRecorrentesMensal) : 0;

    return {
      periodo: targetMonth,
      despesas_totais_centavos: despTotal,
      custos_fixos_recorrentes_centavos: totalRecorrentesMensal,
      custos_variaveis_centavos: variaveisCentavos,
      proporcao_fixa_pct: despTotal > 0 ? Math.round((totalRecorrentesMensal / despTotal) * 100) : 0,
      potencial_economia_mensal_centavos: potencialEconomiaTotal,
      potencial_economia_anual_centavos: potencialEconomiaTotal * 12,
      gargalos_identificados: rankingGargalos.slice(0, 8)
    };
  }

  /**
   * Simulador determinístico de cenários hipotéticos: calcula instantaneamente o impacto de decisões
   * (redução de despesas, quitação de dívida ou aumento de renda) no saldo e na saúde financeira, sem tocar no banco de dados.
   */
  function simulateScenario(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};
    var healthBase = getHealthScore(user, p.mesReferencia);

    var recBase = healthBase.resumo_contabil.receitas_total_centavos;
    var despBase = healthBase.resumo_contabil.despesas_total_centavos;
    var saldoBase = healthBase.resumo_contabil.saldo_periodo_centavos;

    var tipoSimulacao = p.tipo_simulacao || 'CORTE_DESPESA';
    var recSimulada = recBase;
    var despSimulada = despBase;
    var economiaMensal = 0;
    var descricaoCenario = '';

    if (tipoSimulacao === 'CORTE_DESPESA') {
      var pctCorte = Number(p.percentual_corte || 15);
      var valCorte = Number(p.valor_corte_centavos || 0);

      if (valCorte > 0) {
        economiaMensal = valCorte;
        descricaoCenario = 'Redução direta de ' + ValidationService.formatCentavosToBrl(valCorte) + ' nas despesas mensais.';
      } else {
        var baseCalculo = p.categoria_valor_centavos ? Number(p.categoria_valor_centavos) : despBase;
        economiaMensal = Math.round((baseCalculo * pctCorte) / 100);
        descricaoCenario = 'Corte de ' + pctCorte + '% nas despesas selecionadas (economia de ' + ValidationService.formatCentavosToBrl(economiaMensal) + '/mês).';
      }
      despSimulada = Math.max(0, despBase - economiaMensal);

    } else if (tipoSimulacao === 'AMORTIZACAO_DIVIDA') {
      var parcelaEconomizada = Number(p.parcela_mensal_eliminada_centavos || 0);
      economiaMensal = parcelaEconomizada;
      despSimulada = Math.max(0, despBase - parcelaEconomizada);
      descricaoCenario = 'Quitação/Amortização de dívida eliminando parcela de ' + ValidationService.formatCentavosToBrl(parcelaEconomizada) + '/mês.';

    } else if (tipoSimulacao === 'RENDA_EXTRA') {
      var rendaExtra = Number(p.valor_renda_extra_centavos || 0);
      recSimulada = recBase + rendaExtra;
      economiaMensal = rendaExtra;
      descricaoCenario = 'Ingresso recorrente de renda extra de ' + ValidationService.formatCentavosToBrl(rendaExtra) + '/mês.';
    }

    var saldoSimulado = recSimulada - despSimulada;
    var diferencaMensal = saldoSimulado - saldoBase;
    var diferencaAnual = diferencaMensal * 12;

    // Estima novo Score de Saúde
    var taxaPoupancaSimulada = recSimulada > 0 ? (saldoSimulado / recSimulada) : 0;
    var variacaoNota = 0;
    if (diferencaMensal > 0) {
      if (taxaPoupancaSimulada >= 0.20) variacaoNota = +12;
      else if (taxaPoupancaSimulada >= 0.10) variacaoNota = +8;
      else variacaoNota = +5;
    }
    var novaNotaEstimada = Math.min(100, Math.max(0, healthBase.nota + variacaoNota));

    return {
      tipo_simulacao: tipoSimulacao,
      descricao: descricaoCenario,
      cenario_atual: {
        receitas_centavos: recBase,
        despesas_centavos: despBase,
        saldo_mensal_centavos: saldoBase,
        score_saude: healthBase.nota,
        faixa_rotulo: healthBase.faixa_rotulo
      },
      cenario_simulado: {
        receitas_centavos: recSimulada,
        despesas_centavos: despSimulada,
        saldo_mensal_centavos: saldoSimulado,
        score_saude_estimado: novaNotaEstimada,
        impacto_mensal_centavos: diferencaMensal,
        impacto_anual_centavos: diferencaAnual
      },
      parecer_tecnico: 'Este cenário ' + (diferencaMensal >= 0 ? 'aumenta sua capacidade financeira em ' : 'reduz seu saldo em ') +
        ValidationService.formatCentavosToBrl(Math.abs(diferencaMensal)) + ' ao mês, acumulando ' +
        ValidationService.formatCentavosToBrl(Math.abs(diferencaAnual)) + ' em 12 meses. O impacto na saúde financeira é altamente positivo.'
    };
  }

  /**
   * Constrói o Plano de Ação Estratégico com prioridades claras e tarefas práticas.
   */
  function getActionPlan(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var health = getHealthScore(user, mesReferencia);
    var alerts = getProactiveAlerts(user, mesReferencia);
    var bottlenecks = getFinancialBottlenecks(user, mesReferencia);

    var tasks = [];

    // Prioridade Crítica
    if (alerts.alertas_criticos > 0) {
      tasks.push({
        id: 'plan_critico_1',
        prioridade: 'CRITICA',
        badge: 'badge-vencido',
        titulo: 'Regularizar Contas Vencidas e Cobrir Déficit Imediato',
        descricao: 'Quitar os compromissos vencidos e ajustar pagamentos da semana para evitar juros e corte de serviços essenciais.',
        prazo: 'Imediato (1 a 3 dias)',
        impacto: 'Eliminação imediata de juros de mora e risco de negativação.'
      });
    }

    // Prioridade Alta
    if (bottlenecks.gargalos_identificados.length > 0) {
      var topGargalo = bottlenecks.gargalos_identificados[0];
      tasks.push({
        id: 'plan_alta_1',
        prioridade: 'ALTA',
        badge: 'badge-pendente',
        titulo: 'Otimizar Gastos na Categoria: ' + topGargalo.categoria_nome,
        descricao: 'Estabelecer teto de gastos e cortar compras supérfluas nesta categoria, visando economizar até ' + ValidationService.formatCentavosToBrl(topGargalo.economia_potencial_centavos) + ' no mês.',
        prazo: 'Curto Prazo (7 dias)',
        impacto: 'Economia estimada de ' + ValidationService.formatCentavosToBrl(topGargalo.economia_potencial_centavos * 12) + '/ano.'
      });
    }

    // Prioridade Média
    if (bottlenecks.custos_fixos_recorrentes_centavos > 0) {
      tasks.push({
        id: 'plan_media_1',
        prioridade: 'MEDIA',
        badge: 'badge-info',
        titulo: 'Auditoria de Assinaturas e Contas Recorrentes',
        descricao: 'Revisar planos de telefonia, streaming, tarifas bancárias e contratos de recorrência ativa para cancelar serviços obsoletos.',
        prazo: 'Médio Prazo (15 dias)',
        impacto: 'Redução permanente do custo de vida mensal.'
      });
    }

    // Prioridade Baixa / Futuro
    tasks.push({
      id: 'plan_baixa_1',
      prioridade: 'BAIXA',
      badge: 'badge-confirmado',
      titulo: 'Consolidar Reserva de Emergência e Portfólio de Investimentos',
      descricao: 'Direcionar com consistência o excedente financeiro para ativos de renda fixa pós-fixada ou fundos com liquidez compatíveis com seu perfil.',
      prazo: 'Longo Prazo (Mensal)',
      impacto: 'Construção de independência financeira e segurança patrimonial familiar.'
    });

    return {
      periodo: health.periodo,
      total_tarefas: tasks.length,
      plano: tasks
    };
  }

  /**
   * Retorna visão executiva integrada do Oráculo IA 2.0 para carregamento instantâneo.
   */
  function getFullOracleOverview(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var health = getHealthScore(user, mesReferencia);
    var alerts = getProactiveAlerts(user, mesReferencia);
    var bottlenecks = getFinancialBottlenecks(user, mesReferencia);
    var actionPlan = getActionPlan(user, mesReferencia);

    return {
      saude: health,
      alertas: alerts,
      gargalos: bottlenecks,
      plano_acao: actionPlan
    };
  }

  return {
    getHealthScore: getHealthScore,
    getProactiveAlerts: getProactiveAlerts,
    getFinancialBottlenecks: getFinancialBottlenecks,
    simulateScenario: simulateScenario,
    getActionPlan: getActionPlan,
    getFullOracleOverview: getFullOracleOverview
  };
})();

