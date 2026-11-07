/**
 * @file DebtService.gs
 * @description Módulo exclusivo do sistema web para gestão de dívidas (antigas, protestadas,
 * em negociação e acordos ativos). Dívidas antigas ou protestadas NÃO são lançadas
 * automaticamente como despesas mensais até que um acordo seja aprovado.
 */

var DebtService = (function () {
  var DEBT_STATUSES = ['ANTIGA', 'PROTESTADA', 'EM_NEGOCIACAO', 'ACORDO_ATIVO', 'QUITADA', 'CANCELADA'];

  function assertWebChannelOnly(channel) {
    if (channel && String(channel).toUpperCase() === 'TELEGRAM') {
      throw new Error('FORBIDDEN_TELEGRAM_SCOPE: O módulo de dívidas é gerenciado exclusivamente pelo sistema web. O Telegram não pode criar, editar, renegociar ou excluir dívidas.');
    }
  }

  function createDebt(user, payload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados da dívida não informados.');
    }
    var credor = ValidationService.sanitizeText(payload.credor, 120);
    var descricao = ValidationService.sanitizeText(payload.descricao, 200);
    if (!credor || !descricao) {
      throw new Error('Credor e descrição da dívida são obrigatórios.');
    }
    var valorOriginal = ValidationService.validateCentavos(payload.valor_original_centavos, 'valor_original_centavos', false);
    var valorAtualizado = payload.valor_atualizado_centavos !== undefined
      ? ValidationService.validateCentavos(payload.valor_atualizado_centavos, 'valor_atualizado_centavos', true)
      : valorOriginal;
    var dataOrigem = ValidationService.validateIsoDate(
      payload.data_origem || SpreadsheetRepository.todayIso(),
      'data_origem',
      false
    );
    var vencimentoOriginal = ValidationService.validateIsoDate(
      payload.vencimento_original || dataOrigem,
      'vencimento_original',
      false
    );
    var situacao = ValidationService.validateEnum(payload.situacao || 'ANTIGA', DEBT_STATUSES, 'situacao');

    // Regra de negócio: Dívidas antigas ou protestadas NÃO repercutem automaticamente no fluxo de caixa mensal
    var repercutir = situacao === 'ACORDO_ATIVO' && Boolean(payload.repercutir_fluxo_caixa);

    var created = SpreadsheetRepository.insert('DIVIDAS', {
      id: SpreadsheetRepository.generateId('div'),
      grupo_id: user.grupo_id,
      credor: credor,
      descricao: descricao,
      valor_original_centavos: valorOriginal,
      valor_atualizado_centavos: valorAtualizado,
      data_origem: dataOrigem,
      vencimento_original: vencimentoOriginal,
      situacao: situacao,
      proposta_negociacao: ValidationService.sanitizeText(payload.proposta_negociacao || '', 300),
      valor_negociado_centavos: payload.valor_negociado_centavos ? ValidationService.validateCentavos(payload.valor_negociado_centavos, 'valor_negociado_centavos', true) : 0,
      quantidade_parcelas: payload.quantidade_parcelas ? Math.max(0, parseInt(payload.quantidade_parcelas, 10) || 0) : 0,
      primeiro_vencimento_acordo: payload.primeiro_vencimento_acordo ? ValidationService.validateIsoDate(payload.primeiro_vencimento_acordo, 'primeiro_vencimento_acordo', true) : '',
      repercutir_fluxo_caixa: repercutir,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      criado_por: user.id
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'DIVIDA_CADASTRADA',
      entidade: 'DIVIDAS',
      entidade_id: created.id,
      origem: 'WEB',
      detalhes: {
        credor: credor,
        valor_original_centavos: valorOriginal,
        situacao: situacao,
        repercutir_fluxo_caixa: repercutir
      }
    });

    return created;
  }

  /**
   * Formaliza um acordo de negociação para uma dívida existente e gera as parcelas acordadas,
   * permitindo que passem a repercutir de forma controlada no fluxo de caixa futuro.
   */
  function approveDebtAgreement(user, debtId, agreementPayload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    var debt = SpreadsheetRepository.findById('DIVIDAS', debtId, user.grupo_id);
    if (!debt) {
      throw new Error('Dívida não encontrada.');
    }
    var valorNegociado = ValidationService.validateCentavos(agreementPayload.valor_negociado_centavos, 'valor_negociado_centavos', false);
    var qtdParcelas = parseInt(agreementPayload.quantidade_parcelas, 10);
    if (isNaN(qtdParcelas) || qtdParcelas < 1 || qtdParcelas > 240) {
      throw new Error('Quantidade de parcelas do acordo deve estar entre 1 e 240.');
    }
    var primeiroVencimento = ValidationService.validateIsoDate(
      agreementPayload.primeiro_vencimento_acordo,
      'primeiro_vencimento_acordo',
      false
    );
    var repercutir = agreementPayload.repercutir_fluxo_caixa !== undefined
      ? Boolean(agreementPayload.repercutir_fluxo_caixa)
      : true;

    var updatedDebt = SpreadsheetRepository.updateById('DIVIDAS', debtId, {
      situacao: 'ACORDO_ATIVO',
      proposta_negociacao: ValidationService.sanitizeText(agreementPayload.proposta_negociacao || 'Acordo formalizado', 300),
      valor_negociado_centavos: valorNegociado,
      quantidade_parcelas: qtdParcelas,
      primeiro_vencimento_acordo: primeiroVencimento,
      repercutir_fluxo_caixa: repercutir
    }, user.grupo_id);

    // Cancela parcelas antigas não pagas dessa dívida antes de gerar o novo plano
    var oldParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'DIVIDA' && p.origem_id === debtId && p.situacao !== 'PAGA';
    });
    for (var o = 0; o < oldParcelas.length; o++) {
      SpreadsheetRepository.updateById('PARCELAS', oldParcelas[o].id, { situacao: 'CANCELADA' }, user.grupo_id);
    }

    var valorBaseParcela = Math.floor(valorNegociado / qtdParcelas);
    var restoCentavos = valorNegociado - (valorBaseParcela * qtdParcelas);
    var parts = primeiroVencimento.split('-');
    var startYear = parseInt(parts[0], 10);
    var startMonth = parseInt(parts[1], 10);
    var startDay = parseInt(parts[2], 10);

    var parcelasBatch = [];
    for (var i = 1; i <= qtdParcelas; i++) {
      var targetDate = new Date(Date.UTC(startYear, startMonth - 1 + (i - 1), 1));
      var ty = targetDate.getUTCFullYear();
      var tm = targetDate.getUTCMonth() + 1;
      var lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      var td = Math.min(startDay, lastDay);
      var dueIso = ty + '-' + String(tm).padStart(2, '0') + '-' + String(td).padStart(2, '0');
      var valParcela = i === 1 ? (valorBaseParcela + restoCentavos) : valorBaseParcela;

      parcelasBatch.push({
        id: SpreadsheetRepository.generateId('par'),
        grupo_id: user.grupo_id,
        origem_tipo: 'DIVIDA',
        origem_id: debtId,
        numero_parcela: i,
        total_parcelas: qtdParcelas,
        valor_centavos: valParcela,
        data_vencimento: dueIso,
        data_pagamento: '',
        situacao: 'PREVISTA',
        lancamento_id: '',
        observacoes: 'Acordo: ' + debt.credor + ' (' + i + '/' + qtdParcelas + ')'
      });
    }

    var insertedParcelas = SpreadsheetRepository.insertBatch('PARCELAS', parcelasBatch);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'ACORDO_DIVIDA_APROVADO',
      entidade: 'DIVIDAS',
      entidade_id: debtId,
      origem: 'WEB',
      detalhes: {
        valor_negociado_centavos: valorNegociado,
        quantidade_parcelas: qtdParcelas,
        repercutir_fluxo_caixa: repercutir
      }
    });

    return {
      divida: updatedDebt,
      parcelas: insertedParcelas
    };
  }

  function payDebtInstallment(user, parcelaId, paymentPayload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    var parcela = SpreadsheetRepository.findById('PARCELAS', parcelaId, user.grupo_id);
    if (!parcela || parcela.origem_tipo !== 'DIVIDA') {
      throw new Error('Parcela de dívida não encontrada.');
    }
    if (parcela.situacao === 'PAGA') {
      return parcela;
    }
    var debt = SpreadsheetRepository.findById('DIVIDAS', parcela.origem_id, user.grupo_id);
    var payDate = (paymentPayload && paymentPayload.data_pagamento)
      ? ValidationService.validateIsoDate(paymentPayload.data_pagamento, 'data_pagamento', false)
      : SpreadsheetRepository.todayIso();
    var paidVal = (paymentPayload && paymentPayload.valor_centavos !== undefined)
      ? ValidationService.validateCentavos(paymentPayload.valor_centavos, 'valor_centavos', false)
      : parcela.valor_centavos;

    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) { return a.situacao === 'ATIVA'; });
    var accountId = (paymentPayload && paymentPayload.conta_bancaria_id) || user.conta_padrao_id || (accounts[0] && accounts[0].id);
    if (!accountId) {
      throw new Error('Informe uma conta bancária ativa para registrar o pagamento da parcela.');
    }
    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var commitCat = null;
    for (var c = 0; c < cats.length; c++) {
      if (cats[c].nome.toLowerCase().indexOf('compromisso') !== -1 || cats[c].tipo === 'SAIDA') {
        commitCat = cats[c];
        if (cats[c].nome.toLowerCase().indexOf('compromisso') !== -1) break;
      }
    }

    var launch = FinanceService.createLaunch(user, {
      tipo: 'SAIDA',
      descricao: 'Parcela Acordo Dívida - ' + (debt ? debt.credor : '') + ' (' + parcela.numero_parcela + '/' + parcela.total_parcelas + ')',
      valor_centavos: paidVal,
      data_lancamento: parcela.data_vencimento,
      data_competencia: parcela.data_vencimento,
      data_pagamento: payDate,
      categoria_id: commitCat ? commitCat.id : cats[0].id,
      conta_bancaria_id: accountId,
      forma_pagamento: (paymentPayload && paymentPayload.forma_pagamento) || 'BOLETO',
      situacao: 'CONFIRMADO',
      origem: 'MANUAL',
      referencia_parcela_id: parcela.id,
      id_origem_externa: 'par_div_' + parcela.id,
      observacoes: 'Pagamento de parcela de acordo de dívida'
    }, 'WEB');

    var updatedParcela = SpreadsheetRepository.updateById('PARCELAS', parcela.id, {
      situacao: 'PAGA',
      data_pagamento: payDate,
      valor_centavos: paidVal,
      lancamento_id: launch.id
    }, user.grupo_id);

    // Verifica se todas as parcelas da dívida foram pagas
    var remaining = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'DIVIDA' && p.origem_id === parcela.origem_id && p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
    });
    if (remaining.length === 0 && debt) {
      SpreadsheetRepository.updateById('DIVIDAS', debt.id, { situacao: 'QUITADA' }, user.grupo_id);
    }

    return updatedParcela;
  }

  function listDebts(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var debts = SpreadsheetRepository.findByGrupo('DIVIDAS', user.grupo_id);
    var allParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'DIVIDA' && p.situacao !== 'CANCELADA';
    });

    return debts.map(function (d) {
      var dParcelas = allParcelas.filter(function (p) { return p.origem_id === d.id; });
      dParcelas.sort(function (a, b) { return a.numero_parcela - b.numero_parcela; });
      var copy = {};
      for (var k in d) {
        if (Object.prototype.hasOwnProperty.call(d, k) && k !== '_rowIndex') copy[k] = d[k];
      }
      copy.parcelas = dParcelas;
      return copy;
    });
  }

  function updateDebt(user, debtId, patch, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    var debt = SpreadsheetRepository.findById('DIVIDAS', debtId, user.grupo_id);
    if (!debt) {
      throw new Error('Dívida não encontrada.');
    }
    var updateData = {};
    if (patch.credor !== undefined) {
      updateData.credor = ValidationService.sanitizeText(patch.credor, 120);
    }
    if (patch.descricao !== undefined) {
      updateData.descricao = ValidationService.sanitizeText(patch.descricao, 200);
    }
    if (patch.valor_atualizado_centavos !== undefined) {
      updateData.valor_atualizado_centavos = ValidationService.validateCentavos(patch.valor_atualizado_centavos, 'valor_atualizado_centavos', false);
    }
    if (patch.situacao !== undefined) {
      updateData.situacao = ValidationService.validateEnum(patch.situacao, DEBT_STATUSES, 'situacao');
    }
    if (patch.observacoes !== undefined) {
      updateData.observacoes = ValidationService.sanitizeText(patch.observacoes, 400);
    }
    if (patch.proposta_negociacao !== undefined) {
      updateData.proposta_negociacao = ValidationService.sanitizeText(patch.proposta_negociacao, 300);
    }

    var updated = SpreadsheetRepository.updateById('DIVIDAS', debtId, updateData, user.grupo_id);
    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'DIVIDA_ATUALIZADA',
      entidade: 'DIVIDAS',
      entidade_id: debtId,
      origem: 'WEB',
      detalhes: updateData
    });
    return updated;
  }

  return {
    DEBT_STATUSES: DEBT_STATUSES,
    assertWebChannelOnly: assertWebChannelOnly,
    createDebt: createDebt,
    approveDebtAgreement: approveDebtAgreement,
    payDebtInstallment: payDebtInstallment,
    updateDebt: updateDebt,
    listDebts: listDebts
  };
})();

