/**
 * @file RecurringAccountService.gs
 * @description Cadastro independente de contas mensais recorrentes (receitas e despesas),
 * geração idempotente de previsões sem duplicidade, pagamento efetivo e atualização
 * que preserva rigorosamente o histórico de pagamentos realizados.
 */

var RecurringAccountService = (function () {
  var NATURES = ['FIXA', 'VARIAVEL'];
  var FREQUENCIES = ['MENSAL', 'ANUAL', 'SEMANAL', 'QUINZENAL'];
  var COMPETENCE_RULES = ['MES_VENCIMENTO', 'MES_ANTERIOR', 'MES_SEGUINTE'];
  var RECURRING_STATUSES = ['ATIVA', 'PAUSADA', 'CANCELADA'];

  function clampDayToMonth(year, month1Based, desiredDay) {
    var lastDayOfMonth = new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
    return Math.min(Math.max(1, desiredDay), lastDayOfMonth);
  }

  function computeCompetenceDate(dueDateIso, competenceRule) {
    var parts = dueDateIso.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (competenceRule === 'MES_ANTERIOR') {
      var prev = new Date(Date.UTC(y, m - 2, 1));
      return prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0') + '-01';
    }
    if (competenceRule === 'MES_SEGUINTE') {
      var next = new Date(Date.UTC(y, m, 1));
      return next.getUTCFullYear() + '-' + String(next.getUTCMonth() + 1).padStart(2, '0') + '-01';
    }
    return dueDateIso;
  }

  function createRecurringAccount(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados da conta recorrente não informados.');
    }
    var nome = ValidationService.sanitizeText(payload.nome, 120);
    if (!nome) {
      throw new Error('O nome da conta recorrente é obrigatório.');
    }
    var tipo = ValidationService.validateEnum(payload.tipo || 'SAIDA', ValidationService.LAUNCH_TYPES, 'tipo');
    var valorPrevisto = ValidationService.validateCentavos(payload.valor_previsto_centavos, 'valor_previsto_centavos', false);
    var natureza = ValidationService.validateEnum(payload.natureza || 'FIXA', NATURES, 'natureza');
    var recorrencia = ValidationService.validateEnum(payload.recorrencia || 'MENSAL', FREQUENCIES, 'recorrencia');
    var diaVencimento = parseInt(payload.dia_vencimento, 10);
    if (isNaN(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
      throw new Error('O dia de vencimento deve estar entre 1 e 31.');
    }

    if (!payload.categoria_id) {
      throw new Error('A categoria é obrigatória para cadastrar uma conta recorrente.');
    }
    var category = SpreadsheetRepository.findById('CATEGORIAS', payload.categoria_id, user.grupo_id);
    if (!category) {
      throw new Error('Categoria não encontrada no seu grupo financeiro.');
    }

    var contaPadraoId = '';
    if (payload.conta_bancaria_padrao_id) {
      var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', payload.conta_bancaria_padrao_id, user.grupo_id);
      if (!acc) throw new Error('Conta bancária padrão não encontrada no seu grupo financeiro.');
      contaPadraoId = acc.id;
    }

    var dataInicio = ValidationService.validateIsoDate(
      payload.data_inicio || SpreadsheetRepository.todayIso(),
      'data_inicio',
      false
    );
    var dataTermino = payload.data_termino
      ? ValidationService.validateIsoDate(payload.data_termino, 'data_termino', true)
      : '';
    if (dataTermino && dataTermino < dataInicio) {
      throw new Error('A data de término não pode ser anterior à data de início.');
    }

    var formaPagamento = ValidationService.validateEnum(
      payload.forma_pagamento || 'BOLETO',
      ValidationService.PAYMENT_METHODS,
      'forma_pagamento'
    );
    var regraCompetencia = ValidationService.validateEnum(
      payload.regra_competencia || 'MES_VENCIMENTO',
      COMPETENCE_RULES,
      'regra_competencia'
    );
    var situacao = ValidationService.validateEnum(payload.situacao || 'ATIVA', RECURRING_STATUSES, 'situacao');
    var antecedencia = payload.antecedencia_lembrete_dias !== undefined
      ? Math.max(0, Math.min(30, parseInt(payload.antecedencia_lembrete_dias, 10) || 3))
      : 3;

    var created = SpreadsheetRepository.insert('CONTAS_RECORRENTES', {
      id: SpreadsheetRepository.generateId('rec'),
      grupo_id: user.grupo_id,
      nome: nome,
      tipo: tipo,
      categoria_id: category.id,
      subcategoria_id: payload.subcategoria_id ? ValidationService.sanitizeText(payload.subcategoria_id, 64) : '',
      valor_previsto_centavos: valorPrevisto,
      natureza: natureza,
      recorrencia: recorrencia,
      dia_vencimento: diaVencimento,
      data_inicio: dataInicio,
      data_termino: dataTermino,
      conta_bancaria_padrao_id: contaPadraoId,
      forma_pagamento: formaPagamento,
      regra_competencia: regraCompetencia,
      notificacoes_ativas: payload.notificacoes_ativas !== undefined ? Boolean(payload.notificacoes_ativas) : true,
      antecedencia_lembrete_dias: antecedencia,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      situacao: situacao,
      criado_por: user.id
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CONTA_RECORRENTE_CRIADA',
      entidade: 'CONTAS_RECORRENTES',
      entidade_id: created.id,
      origem: 'WEB',
      detalhes: {
        nome: nome,
        valor_previsto_centavos: valorPrevisto,
        dia_vencimento: diaVencimento,
        recorrencia: recorrencia
      }
    });

    return created;
  }

  /**
   * Atualiza uma conta recorrente.
   * REGRA CRÍTICA: Jamais modifica pagamentos históricos (CONFIRMADO ou CANCELADO).
   * Se applyToFutureUnpaid = true, atualiza apenas os lançamentos futuros ainda em estado PREVISTO ou PENDENTE.
   */
  function updateRecurringAccount(user, recurringId, patch, applyToFutureUnpaid) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var existing = SpreadsheetRepository.findById('CONTAS_RECORRENTES', recurringId, user.grupo_id);
    if (!existing) {
      throw new Error('Conta recorrente não encontrada.');
    }

    var updateFields = {};
    if (patch.nome !== undefined) {
      updateFields.nome = ValidationService.sanitizeText(patch.nome, 120);
      if (!updateFields.nome) throw new Error('O nome não pode ficar vazio.');
    }
    if (patch.valor_previsto_centavos !== undefined) {
      updateFields.valor_previsto_centavos = ValidationService.validateCentavos(
        patch.valor_previsto_centavos,
        'valor_previsto_centavos',
        false
      );
    }
    if (patch.dia_vencimento !== undefined) {
      var d = parseInt(patch.dia_vencimento, 10);
      if (isNaN(d) || d < 1 || d > 31) throw new Error('Dia de vencimento inválido.');
      updateFields.dia_vencimento = d;
    }
    if (patch.natureza !== undefined) {
      updateFields.natureza = ValidationService.validateEnum(patch.natureza, NATURES, 'natureza');
    }
    if (patch.recorrencia !== undefined) {
      updateFields.recorrencia = ValidationService.validateEnum(patch.recorrencia, FREQUENCIES, 'recorrencia');
    }
    if (patch.categoria_id !== undefined) {
      var cat = SpreadsheetRepository.findById('CATEGORIAS', patch.categoria_id, user.grupo_id);
      if (!cat) throw new Error('Categoria inválida.');
      updateFields.categoria_id = cat.id;
    }
    if (patch.subcategoria_id !== undefined) {
      updateFields.subcategoria_id = ValidationService.sanitizeText(patch.subcategoria_id, 64);
    }
    if (patch.conta_bancaria_padrao_id !== undefined) {
      if (patch.conta_bancaria_padrao_id) {
        var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', patch.conta_bancaria_padrao_id, user.grupo_id);
        if (!acc) throw new Error('Conta bancária padrão inválida.');
        updateFields.conta_bancaria_padrao_id = acc.id;
      } else {
        updateFields.conta_bancaria_padrao_id = '';
      }
    }
    if (patch.forma_pagamento !== undefined) {
      updateFields.forma_pagamento = ValidationService.validateEnum(patch.forma_pagamento, ValidationService.PAYMENT_METHODS, 'forma_pagamento');
    }
    if (patch.data_inicio !== undefined && patch.data_inicio) {
      updateFields.data_inicio = ValidationService.validateIsoDate(patch.data_inicio, 'data_inicio', false);
    }
    if (patch.data_termino !== undefined) {
      updateFields.data_termino = patch.data_termino
        ? ValidationService.validateIsoDate(patch.data_termino, 'data_termino', true)
        : '';
    }
    if (patch.situacao !== undefined) {
      updateFields.situacao = ValidationService.validateEnum(patch.situacao, RECURRING_STATUSES, 'situacao');
    }
    if (patch.notificacoes_ativas !== undefined) {
      updateFields.notificacoes_ativas = Boolean(patch.notificacoes_ativas);
    }
    if (patch.antecedencia_lembrete_dias !== undefined) {
      updateFields.antecedencia_lembrete_dias = Math.max(0, Math.min(30, parseInt(patch.antecedencia_lembrete_dias, 10) || 0));
    }
    if (patch.observacoes !== undefined) {
      updateFields.observacoes = ValidationService.sanitizeText(patch.observacoes, 400);
    }

    var updatedRule = SpreadsheetRepository.updateById('CONTAS_RECORRENTES', recurringId, updateFields, user.grupo_id);
    var updatedOccurrencesCount = 0;

    if (applyToFutureUnpaid) {
      var unpaidOccurrences = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
        return (
          l.referencia_recorrencia_id === recurringId &&
          (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE')
        );
      });

      for (var i = 0; i < unpaidOccurrences.length; i++) {
        var occ = unpaidOccurrences[i];
        var occPatch = {
          descricao: updatedRule.nome,
          valor_centavos: updatedRule.valor_previsto_centavos,
          categoria_id: updatedRule.categoria_id,
          subcategoria_id: updatedRule.subcategoria_id,
          forma_pagamento: updatedRule.forma_pagamento
        };
        if (updatedRule.conta_bancaria_padrao_id) {
          occPatch.conta_bancaria_id = updatedRule.conta_bancaria_padrao_id;
        }
        if (occ.competencia_recorrencia && /^\d{4}-\d{2}$/.test(occ.competencia_recorrencia)) {
          var ymParts = occ.competencia_recorrencia.split('-');
          var y = parseInt(ymParts[0], 10);
          var m = parseInt(ymParts[1], 10);
          var day = clampDayToMonth(y, m, updatedRule.dia_vencimento);
          var newDueDate = ymParts[0] + '-' + ymParts[1] + '-' + String(day).padStart(2, '0');
          occPatch.data_lancamento = newDueDate;
          occPatch.data_competencia = computeCompetenceDate(newDueDate, updatedRule.regra_competencia);
        }
        if (updatedRule.situacao === 'CANCELADA') {
          occPatch.situacao = 'CANCELADO';
        }
        SpreadsheetRepository.updateById('LANCAMENTOS', occ.id, occPatch, user.grupo_id);
        updatedOccurrencesCount++;
      }
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CONTA_RECORRENTE_ALTERADA',
      entidade: 'CONTAS_RECORRENTES',
      entidade_id: recurringId,
      origem: 'WEB',
      detalhes: {
        campos_alterados: Object.keys(updateFields),
        aplicado_ocorrencias_futuras_nao_pagas: Boolean(applyToFutureUnpaid),
        ocorrencias_atualizadas: updatedOccurrencesCount
      }
    });

    return {
      regra: updatedRule,
      ocorrencias_futuras_atualizadas: updatedOccurrencesCount
    };
  }

  /**
   * Gera de forma idempotente as previsões (situacao = PREVISTO) de todas as contas recorrentes ativas
   * para um mês de competência (YYYY-MM). Não duplica registros mesmo se executado repetidamente.
   */
  function generateMonthlyForecasts(user, competenciaMes) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!competenciaMes || !/^\d{4}-\d{2}$/.test(competenciaMes)) {
      throw new Error('Competência mensal inválida (esperado YYYY-MM).');
    }
    var parts = competenciaMes.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var monthStart = competenciaMes + '-01';
    var lastDay = clampDayToMonth(year, month, 31);
    var monthEnd = competenciaMes + '-' + String(lastDay).padStart(2, '0');

    var activeRules = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id, function (r) {
      return r.situacao === 'ATIVA';
    });

    // Descobre conta bancária fallback do grupo caso a recorrência não tenha conta padrão
    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
      return a.situacao === 'ATIVA';
    });
    var fallbackAccountId = user.conta_padrao_id || (accounts.length > 0 ? accounts[0].id : '');
    if (!fallbackAccountId && activeRules.length > 0) {
      throw new Error('Cadastre pelo menos uma conta bancária ativa antes de gerar previsões de contas recorrentes.');
    }

    var existingLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id);
    var createdForecasts = [];
    var skippedExisting = [];

    for (var i = 0; i < activeRules.length; i++) {
      var rule = activeRules[i];
      if (rule.data_inicio && rule.data_inicio > monthEnd) {
        continue;
      }
      if (rule.data_termino && rule.data_termino < monthStart) {
        continue;
      }
      if (rule.recorrencia === 'ANUAL' && rule.data_inicio) {
        var startMonth = rule.data_inicio.substring(5, 7);
        if (startMonth !== parts[1]) {
          continue;
        }
      }

      var externalKey = 'rec_' + rule.id + '_' + competenciaMes;
      var alreadyExists = false;
      for (var j = 0; j < existingLaunches.length; j++) {
        var l = existingLaunches[j];
        if (
          (l.id_origem_externa === externalKey) ||
          (l.referencia_recorrencia_id === rule.id && l.competencia_recorrencia === competenciaMes && l.situacao !== 'CANCELADO')
        ) {
          alreadyExists = true;
          skippedExisting.push(l);
          break;
        }
      }

      if (alreadyExists) {
        continue;
      }

      var dueDay = clampDayToMonth(year, month, Number(rule.dia_vencimento || 10));
      var dueDateIso = competenciaMes + '-' + String(dueDay).padStart(2, '0');
      var compDateIso = computeCompetenceDate(dueDateIso, rule.regra_competencia || 'MES_VENCIMENTO');
      var targetAccountId = rule.conta_bancaria_padrao_id || fallbackAccountId;

      var created = FinanceService.createLaunch(user, {
        tipo: rule.tipo,
        descricao: rule.nome,
        valor_centavos: rule.valor_previsto_centavos,
        data_lancamento: dueDateIso,
        data_competencia: compDateIso,
        categoria_id: rule.categoria_id,
        subcategoria_id: rule.subcategoria_id || '',
        conta_bancaria_id: targetAccountId,
        forma_pagamento: rule.forma_pagamento || 'BOLETO',
        situacao: 'PREVISTO',
        origem: 'RECORRENCIA',
        referencia_recorrencia_id: rule.id,
        competencia_recorrencia: competenciaMes,
        id_origem_externa: externalKey,
        observacoes: 'Previsão gerada por conta recorrente (' + rule.natureza + ')'
      }, 'RECORRENCIA');

      createdForecasts.push(created);
      existingLaunches.push(created);
    }

    return {
      competencia: competenciaMes,
      gerados_quantidade: createdForecasts.length,
      ignorados_existentes_quantidade: skippedExisting.length,
      gerados: createdForecasts,
      existentes: skippedExisting
    };
  }

  /**
   * Registra o pagamento/recebimento efetivo de uma ocorrência de conta recorrente de forma idempotente.
   * Se a previsão do mês já existir, atualiza-a para CONFIRMADO; caso contrário, cria-a já CONFIRMADA.
   */
  function payRecurringOccurrence(user, recurringId, competenciaMes, paymentDetails) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var rule = SpreadsheetRepository.findById('CONTAS_RECORRENTES', recurringId, user.grupo_id);
    if (!rule) {
      throw new Error('Conta recorrente não encontrada.');
    }
    if (!competenciaMes || !/^\d{4}-\d{2}$/.test(competenciaMes)) {
      throw new Error('Competência mensal inválida (esperado YYYY-MM).');
    }

    var externalKey = 'rec_' + rule.id + '_' + competenciaMes;
    var existingLaunch = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
      return (
        l.grupo_id === user.grupo_id &&
        l.situacao !== 'CANCELADO' &&
        (l.id_origem_externa === externalKey ||
          (l.referencia_recorrencia_id === rule.id && l.competencia_recorrencia === competenciaMes))
      );
    });

    var payDate = (paymentDetails && paymentDetails.data_pagamento)
      ? ValidationService.validateIsoDate(paymentDetails.data_pagamento, 'data_pagamento', false)
      : SpreadsheetRepository.todayIso();
    var paidValue = (paymentDetails && paymentDetails.valor_centavos !== undefined)
      ? ValidationService.validateCentavos(paymentDetails.valor_centavos, 'valor_centavos', false)
      : rule.valor_previsto_centavos;

    if (existingLaunch) {
      if (existingLaunch.situacao === 'CONFIRMADO') {
        return existingLaunch; // Idempotente: já está confirmado
      }
      return FinanceService.confirmLaunch(user, existingLaunch.id, {
        data_pagamento: payDate,
        valor_centavos: paidValue,
        conta_bancaria_id: (paymentDetails && paymentDetails.conta_bancaria_id) || existingLaunch.conta_bancaria_id
      });
    }

    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
      return a.situacao === 'ATIVA';
    });
    var accountId = (paymentDetails && paymentDetails.conta_bancaria_id) ||
      rule.conta_bancaria_padrao_id ||
      user.conta_padrao_id ||
      (accounts.length > 0 ? accounts[0].id : '');

    var parts = competenciaMes.split('-');
    var dueDay = clampDayToMonth(parseInt(parts[0], 10), parseInt(parts[1], 10), Number(rule.dia_vencimento || 10));
    var dueDateIso = competenciaMes + '-' + String(dueDay).padStart(2, '0');

    return FinanceService.createLaunch(user, {
      tipo: rule.tipo,
      descricao: rule.nome,
      valor_centavos: paidValue,
      data_lancamento: dueDateIso,
      data_competencia: computeCompetenceDate(dueDateIso, rule.regra_competencia || 'MES_VENCIMENTO'),
      data_pagamento: payDate,
      categoria_id: rule.categoria_id,
      subcategoria_id: rule.subcategoria_id || '',
      conta_bancaria_id: accountId,
      forma_pagamento: (paymentDetails && paymentDetails.forma_pagamento) || rule.forma_pagamento || 'BOLETO',
      situacao: 'CONFIRMADO',
      origem: 'RECORRENCIA',
      referencia_recorrencia_id: rule.id,
      competencia_recorrencia: competenciaMes,
      id_origem_externa: externalKey,
      observacoes: 'Pagamento confirmado de conta recorrente'
    }, 'WEB');
  }

  function listRecurringAccounts(user, competenciaMes) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var rules = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id);
    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < cats.length; c++) catMap[cats[c].id] = cats[c];

    var accs = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id);
    var accMap = {};
    for (var a = 0; a < accs.length; a++) accMap[accs[a].id] = accs[a];

    var targetMonth = competenciaMes || SpreadsheetRepository.todayIso().substring(0, 7);
    var monthLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.competencia_recorrencia === targetMonth && l.situacao !== 'CANCELADO';
    });

    return rules.map(function (r) {
      var occ = null;
      for (var i = 0; i < monthLaunches.length; i++) {
        if (monthLaunches[i].referencia_recorrencia_id === r.id) {
          occ = monthLaunches[i];
          break;
        }
      }
      var copy = {};
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k) && k !== '_rowIndex') {
          copy[k] = r[k];
        }
      }
      copy.categoria_nome = catMap[r.categoria_id] ? catMap[r.categoria_id].nome : 'Geral';
      copy.conta_bancaria_nome = accMap[r.conta_bancaria_padrao_id] ? accMap[r.conta_bancaria_padrao_id].nome_identificacao : '';
      copy.ocorrencia_mes_atual = occ;
      return copy;
    });
  }

  /**
   * Agrupa e projeta os custos de assinaturas e despesas fixas recorrentes,
   * calculando o custo anualizado de cada uma e o total anual comprometido.
   */
  function getSubscriptionsOverview(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var all = listRecurringAccounts(user, false);
    var expenses = all.filter(function (r) {
      return r.tipo === 'SAIDA' && r.situacao === 'ATIVA';
    });

    var items = expenses.map(function (e) {
      var val = Number(e.valor_previsto_centavos) || 0;
      var mens = val;
      if (e.recorrencia === 'ANUAL') mens = Math.round(val / 12);
      else if (e.recorrencia === 'SEMANAL') mens = Math.round(val * 4.33);
      else if (e.recorrencia === 'QUINZENAL') mens = val * 2;

      var anual = mens * 12;

      return {
        id: e.id,
        nome: e.nome,
        categoria: e.categoria_nome,
        natureza: e.natureza,
        recorrencia: e.recorrencia,
        dia_vencimento: e.dia_vencimento,
        valor_base_centavos: val,
        custo_mensal_centavos: mens,
        custo_mensal_formatado: (mens / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        custo_anual_centavos: anual,
        custo_anual_formatado: (anual / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        forma_pagamento: e.forma_pagamento
      };
    });

    items.sort(function (a, b) {
      return b.custo_anual_centavos - a.custo_anual_centavos;
    });

    var totalMensal = 0;
    var totalAnual = 0;
    for (var i = 0; i < items.length; i++) {
      totalMensal += items[i].custo_mensal_centavos;
      totalAnual += items[i].custo_anual_centavos;
    }

    return {
      quantidade_assinaturas: items.length,
      total_mensal_centavos: totalMensal,
      total_mensal_formatado: (totalMensal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      total_anual_centavos: totalAnual,
      total_anual_formatado: (totalAnual / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      itens: items
    };
  }

  return {
    NATURES: NATURES,
    FREQUENCIES: FREQUENCIES,
    COMPETENCE_RULES: COMPETENCE_RULES,
    RECURRING_STATUSES: RECURRING_STATUSES,
    createRecurringAccount: createRecurringAccount,
    updateRecurringAccount: updateRecurringAccount,
    generateMonthlyForecasts: generateMonthlyForecasts,
    payRecurringOccurrence: payRecurringOccurrence,
    listRecurringAccounts: listRecurringAccounts,
    getSubscriptionsOverview: getSubscriptionsOverview
  };
})();

