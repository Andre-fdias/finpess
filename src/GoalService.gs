/**
 * @file GoalService.gs
 * @description Gestão de Metas Financeiras e Reserva de Emergência Inteligente.
 * Permite cadastrar objetivos com prazos, valores-alvo, cálculo do esforço mensal
 * de poupança necessário, aportes com histórico e dimensionamento da reserva ideal
 * baseado na média real de despesas essenciais do usuário.
 */

var GoalService = (function () {
  var GOAL_CATEGORIES = [
    'RESERVA_EMERGENCIA',
    'VIAGEM',
    'VEICULO',
    'IMOVEL',
    'EDUCACAO',
    'INVESTIMENTO',
    'APOSENTADORIA',
    'OUTROS'
  ];

  var GOAL_STATUSES = ['EM_ANDAMENTO', 'CONCLUIDA', 'PAUSADA', 'CANCELADA'];

  function formatCurrency(centavos) {
    var v = Math.round(Number(centavos || 0));
    var isNeg = v < 0;
    v = Math.abs(v);
    var inteiros = Math.floor(v / 100);
    var cents = v % 100;
    var intStr = inteiros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var centStr = cents < 10 ? '0' + cents : '' + cents;
    return (isNeg ? '-' : '') + 'R$ ' + intStr + ',' + centStr;
  }

  function getMonthsDifference(startIso, endIso) {
    if (!startIso || !endIso) return 1;
    var y1 = parseInt(startIso.substring(0, 4), 10);
    var m1 = parseInt(startIso.substring(5, 7), 10);
    var y2 = parseInt(endIso.substring(0, 4), 10);
    var m2 = parseInt(endIso.substring(5, 7), 10);
    var diff = (y2 - y1) * 12 + (m2 - m1);
    return Math.max(1, diff);
  }

  function listGoals(user, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var today = SpreadsheetRepository.todayIso();

    var goals = SpreadsheetRepository.findByGrupo('METAS_FINANCEIRAS', user.grupo_id, function (g) {
      if (opts.situacao && g.situacao !== opts.situacao) return false;
      return g.situacao !== 'EXCLUIDA';
    });

    var enriched = goals.map(function (g) {
      var alvo = Number(g.valor_alvo_centavos) || 0;
      var atual = Number(g.valor_atual_centavos) || 0;
      var falta = Math.max(0, alvo - atual);
      var pct = alvo > 0 ? Math.min(100, Math.round((atual / alvo) * 100)) : 0;
      var mesesRestantes = g.data_limite ? getMonthsDifference(today, g.data_limite) : 1;
      var aporteMensalSugerido = (falta > 0 && mesesRestantes > 0) ? Math.ceil(falta / mesesRestantes) : 0;

      return {
        id: g.id,
        grupo_id: g.grupo_id,
        nome: g.nome,
        descricao: g.descricao || '',
        categoria_meta: g.categoria_meta,
        valor_alvo_centavos: alvo,
        valor_alvo_formatado: formatCurrency(alvo),
        valor_atual_centavos: atual,
        valor_atual_formatado: formatCurrency(atual),
        falta_centavos: falta,
        falta_formatado: formatCurrency(falta),
        percentual_atingido: pct,
        data_limite: g.data_limite || '',
        data_limite_br: g.data_limite ? ValidationService.formatDateBr(g.data_limite) : 'Sem prazo fixo',
        meses_restantes: mesesRestantes,
        aporte_mensal_sugerido_centavos: aporteMensalSugerido,
        aporte_mensal_sugerido_formatado: formatCurrency(aporteMensalSugerido),
        conta_bancaria_id: g.conta_bancaria_id || '',
        cor: g.cor || '#2563eb',
        icone: g.icone || 'target',
        situacao: g.situacao,
        observacoes: g.observacoes || '',
        criado_em: g.criado_em,
        atualizado_em: g.atualizado_em
      };
    });

    enriched.sort(function (a, b) {
      if (a.situacao !== b.situacao) {
        if (a.situacao === 'EM_ANDAMENTO') return -1;
        if (b.situacao === 'EM_ANDAMENTO') return 1;
      }
      return String(a.data_limite || '9999').localeCompare(String(b.data_limite || '9999'));
    });

    var totalAlvo = 0;
    var totalAtual = 0;
    for (var i = 0; i < enriched.length; i++) {
      if (enriched[i].situacao === 'EM_ANDAMENTO') {
        totalAlvo += enriched[i].valor_alvo_centavos;
        totalAtual += enriched[i].valor_atual_centavos;
      }
    }

    return {
      total_alvo_centavos: totalAlvo,
      total_alvo_formatado: formatCurrency(totalAlvo),
      total_acumulado_centavos: totalAtual,
      total_acumulado_formatado: formatCurrency(totalAtual),
      percentual_geral: totalAlvo > 0 ? Math.min(100, Math.round((totalAtual / totalAlvo) * 100)) : 0,
      metas: enriched
    };
  }

  function createGoal(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload) throw new Error('Dados da meta não informados.');

    var nome = ValidationService.sanitizeText(payload.nome, 120);
    if (!nome) throw new Error('O nome da meta é obrigatório.');

    var cat = ValidationService.validateEnum(payload.categoria_meta || 'OUTROS', GOAL_CATEGORIES, 'categoria_meta');
    var valorAlvo = ValidationService.validateCentavos(payload.valor_alvo_centavos, 'valor_alvo_centavos', false);
    if (valorAlvo <= 0) throw new Error('O valor-alvo da meta deve ser maior que zero.');

    var valorAtual = payload.valor_atual_centavos
      ? ValidationService.validateCentavos(payload.valor_atual_centavos, 'valor_atual_centavos', true)
      : 0;

    var dataLimite = payload.data_limite ? ValidationService.validateIsoDate(payload.data_limite, 'data_limite') : '';
    var contaId = payload.conta_bancaria_id ? ValidationService.sanitizeText(payload.conta_bancaria_id, 50) : '';

    var now = SpreadsheetRepository.nowIso();
    var situacao = (valorAtual >= valorAlvo) ? 'CONCLUIDA' : 'EM_ANDAMENTO';

    var created = SpreadsheetRepository.insert('METAS_FINANCEIRAS', {
      id: SpreadsheetRepository.generateId('met'),
      grupo_id: user.grupo_id,
      nome: nome,
      descricao: ValidationService.sanitizeText(payload.descricao || '', 300),
      categoria_meta: cat,
      valor_alvo_centavos: valorAlvo,
      valor_atual_centavos: valorAtual,
      data_limite: dataLimite,
      conta_bancaria_id: contaId,
      cor: ValidationService.sanitizeText(payload.cor || '#2563eb', 20),
      icone: ValidationService.sanitizeText(payload.icone || 'target', 40),
      situacao: situacao,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 300),
      criado_em: now,
      atualizado_em: now,
      criado_por: user.id
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'META_CRIADA',
      entidade: 'METAS_FINANCEIRAS',
      entidade_id: created.id,
      origem: 'WEB',
      detalhes: { nome: nome, valor_alvo: valorAlvo, categoria: cat }
    });

    return created;
  }

  function updateGoal(user, goalId, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var goal = SpreadsheetRepository.findById('METAS_FINANCEIRAS', goalId, user.grupo_id);
    if (!goal) throw new Error('Meta financeira não encontrada.');

    var p = payload || {};
    var patch = { atualizado_em: SpreadsheetRepository.nowIso() };

    if (p.nome !== undefined) patch.nome = ValidationService.sanitizeText(p.nome, 120);
    if (p.descricao !== undefined) patch.descricao = ValidationService.sanitizeText(p.descricao, 300);
    if (p.categoria_meta !== undefined) {
      patch.categoria_meta = ValidationService.validateEnum(p.categoria_meta, GOAL_CATEGORIES, 'categoria_meta');
    }
    if (p.valor_alvo_centavos !== undefined) {
      patch.valor_alvo_centavos = ValidationService.validateCentavos(p.valor_alvo_centavos, 'valor_alvo_centavos', false);
    }
    if (p.valor_atual_centavos !== undefined) {
      patch.valor_atual_centavos = ValidationService.validateCentavos(p.valor_atual_centavos, 'valor_atual_centavos', true);
    }
    if (p.data_limite !== undefined) {
      patch.data_limite = p.data_limite ? ValidationService.validateIsoDate(p.data_limite, 'data_limite') : '';
    }
    if (p.conta_bancaria_id !== undefined) {
      patch.conta_bancaria_id = ValidationService.sanitizeText(p.conta_bancaria_id, 50);
    }
    if (p.cor !== undefined) patch.cor = ValidationService.sanitizeText(p.cor, 20);
    if (p.icone !== undefined) patch.icone = ValidationService.sanitizeText(p.icone, 40);
    if (p.situacao !== undefined) {
      patch.situacao = ValidationService.validateEnum(p.situacao, GOAL_STATUSES, 'situacao');
    }
    if (p.observacoes !== undefined) patch.observacoes = ValidationService.sanitizeText(p.observacoes, 300);

    // Auto-conclusão se valor atual atingir o alvo
    var alvoFinal = patch.valor_alvo_centavos !== undefined ? patch.valor_alvo_centavos : Number(goal.valor_alvo_centavos);
    var atualFinal = patch.valor_atual_centavos !== undefined ? patch.valor_atual_centavos : Number(goal.valor_atual_centavos);
    if (atualFinal >= alvoFinal && patch.situacao !== 'PAUSADA' && patch.situacao !== 'CANCELADA') {
      patch.situacao = 'CONCLUIDA';
    }

    var updated = SpreadsheetRepository.updateById('METAS_FINANCEIRAS', goal.id, patch, user.grupo_id);
    return updated;
  }

  function deleteGoal(user, goalId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var goal = SpreadsheetRepository.findById('METAS_FINANCEIRAS', goalId, user.grupo_id);
    if (!goal) throw new Error('Meta financeira não encontrada.');

    SpreadsheetRepository.deleteById('METAS_FINANCEIRAS', goal.id, user.grupo_id);
    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'META_EXCLUIDA',
      entidade: 'METAS_FINANCEIRAS',
      entidade_id: goal.id,
      origem: 'WEB',
      detalhes: { nome: goal.nome }
    });

    return { ok: true, id: goal.id };
  }

  /**
   * Registra um aporte (contribuição financeira) para uma meta existente.
   */
  function contributeToGoal(user, goalId, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var goal = SpreadsheetRepository.findById('METAS_FINANCEIRAS', goalId, user.grupo_id);
    if (!goal) throw new Error('Meta financeira não encontrada.');

    var p = payload || {};
    var aporte = ValidationService.validateCentavos(p.valor_aporte_centavos, 'valor_aporte_centavos', false);
    if (aporte <= 0) throw new Error('O valor do aporte deve ser maior que zero.');

    var novoAtual = (Number(goal.valor_atual_centavos) || 0) + aporte;
    var alvo = Number(goal.valor_alvo_centavos) || 0;
    var novaSituacao = novoAtual >= alvo ? 'CONCLUIDA' : 'EM_ANDAMENTO';

    var updated = SpreadsheetRepository.updateById('METAS_FINANCEIRAS', goal.id, {
      valor_atual_centavos: novoAtual,
      situacao: novaSituacao,
      atualizado_em: SpreadsheetRepository.nowIso()
    }, user.grupo_id);

    // Opcionalmente registra lançamento de saída para a conta bancária
    if (p.debitar_conta_bancaria && p.conta_bancaria_id) {
      try {
        var categories = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
        var catId = (categories.length > 0) ? categories[0].id : '';
        SpreadsheetRepository.insert('LANCAMENTOS', {
          id: SpreadsheetRepository.generateId('lan'),
          grupo_id: user.grupo_id,
          tipo: 'SAIDA',
          natureza_operacao: 'APORTE_META',
          transferencia_id: '',
          descricao: 'Aporte Meta: ' + goal.nome,
          valor_centavos: aporte,
          data_lancamento: SpreadsheetRepository.todayIso(),
          data_competencia: SpreadsheetRepository.todayIso(),
          data_pagamento: SpreadsheetRepository.todayIso(),
          categoria_id: catId,
          subcategoria_id: '',
          conta_bancaria_id: p.conta_bancaria_id,
          forma_pagamento: 'OUTROS',
          situacao: 'CONFIRMADO',
          origem: 'WEB',
          observacoes: 'Aporte para a meta ' + goal.nome + ' | ' + (p.observacoes || ''),
          criado_em: SpreadsheetRepository.nowIso(),
          atualizado_em: SpreadsheetRepository.nowIso(),
          usuario_responsavel_id: user.id
        });
      } catch (eLan) {}
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'META_APORTE_REALIZADO',
      entidade: 'METAS_FINANCEIRAS',
      entidade_id: goal.id,
      origem: 'WEB',
      detalhes: { nome: goal.nome, aporte: aporte, saldo_atual: novoAtual }
    });

    return {
      ok: true,
      meta: updated,
      valor_aporte_formatado: formatCurrency(aporte),
      novo_saldo_formatado: formatCurrency(novoAtual),
      concluida: novaSituacao === 'CONCLUIDA'
    };
  }

  /**
   * Dimensiona a Reserva de Emergência Ideal calculando a média das despesas essenciais
   * reais dos últimos meses e comparando com a cobertura atual.
   */
  function calculateEmergencyFundRecommendation(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var today = SpreadsheetRepository.todayIso();
    var curYear = parseInt(today.substring(0, 4), 10);
    var curMonth = parseInt(today.substring(5, 7), 10);

    var pastMonths = [];
    for (var m = 1; m <= 3; m++) {
      var d = new Date(Date.UTC(curYear, curMonth - 1 - m, 1));
      pastMonths.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
    }

    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      if (l.tipo !== 'SAIDA' || l.situacao === 'CANCELADO' || l.natureza_operacao === 'TRANSFERENCIA') return false;
      var ym = String(l.data_lancamento).substring(0, 7);
      return pastMonths.indexOf(ym) !== -1;
    });

    var totalDespesasHistorico = 0;
    for (var i = 0; i < launches.length; i++) {
      totalDespesasHistorico += Number(launches[i].valor_centavos) || 0;
    }

    var divisor = pastMonths.length > 0 ? pastMonths.length : 1;
    var mediaMensal = Math.round(totalDespesasHistorico / divisor);
    // Se histórico for nulo, busca contas recorrentes de despesa
    if (mediaMensal === 0) {
      var recs = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id, function (r) {
        return r.tipo === 'SAIDA' && r.situacao === 'ATIVA';
      });
      for (var rIdx = 0; rIdx < recs.length; rIdx++) {
        mediaMensal += Number(recs[rIdx].valor_previsto_centavos) || 0;
      }
    }
    if (mediaMensal === 0) mediaMensal = 300000; // Padrão base R$ 3.000,00 se sem dados

    var reserva3m = mediaMensal * 3;
    var reserva6m = mediaMensal * 6;
    var reserva12m = mediaMensal * 12;

    // Busca se já existe meta de reserva cadastrada
    var metaReserva = SpreadsheetRepository.findOne('METAS_FINANCEIRAS', function (g) {
      return g.grupo_id === user.grupo_id && g.categoria_meta === 'RESERVA_EMERGENCIA' && g.situacao !== 'EXCLUIDA';
    });

    var saldoReservaAtual = metaReserva ? Number(metaReserva.valor_atual_centavos) : 0;
    var mesesCobertos = mediaMensal > 0 ? (saldoReservaAtual / mediaMensal).toFixed(1) : 0;

    return {
      custo_mensal_medio_centavos: mediaMensal,
      custo_mensal_medio_formatado: formatCurrency(mediaMensal),
      reserva_minima_3_meses_centavos: reserva3m,
      reserva_minima_3_meses_formatado: formatCurrency(reserva3m),
      reserva_ideal_6_meses_centavos: reserva6m,
      reserva_ideal_6_meses_formatado: formatCurrency(reserva6m),
      reserva_conforto_12_meses_centavos: reserva12m,
      reserva_conforto_12_meses_formatado: formatCurrency(reserva12m),
      meta_existente: metaReserva ? {
        id: metaReserva.id,
        nome: metaReserva.nome,
        valor_alvo_formatado: formatCurrency(metaReserva.valor_alvo_centavos),
        valor_atual_formatado: formatCurrency(metaReserva.valor_atual_centavos),
        meses_cobertos: mesesCobertos
      } : null
    };
  }

  return {
    listGoals: listGoals,
    createGoal: createGoal,
    updateGoal: updateGoal,
    deleteGoal: deleteGoal,
    contributeToGoal: contributeToGoal,
    calculateEmergencyFundRecommendation: calculateEmergencyFundRecommendation
  };
})();

