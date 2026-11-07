/**
 * @file BankAccountService.gs
 * @description Gerenciamento de contas bancárias manuais, cálculo de saldo confirmado
 * (separado de previsões), extrato por período, transferências entre contas próprias
 * sem duplicidade no resultado e reconciliação manual.
 */

var BankAccountService = (function () {
  var ACCOUNT_TYPES = ['CORRENTE', 'POUPANCA', 'PAGAMENTO', 'DINHEIRO', 'OUTRA'];
  var ACCOUNT_STATUSES = ['ATIVA', 'INATIVA', 'ARQUIVADA'];

  function createBankAccount(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados da conta bancária não informados.');
    }
    var instituicao = ValidationService.sanitizeText(payload.instituicao, 100);
    var nomeIdentificacao = ValidationService.sanitizeText(payload.nome_identificacao, 100);
    if (!instituicao || !nomeIdentificacao) {
      throw new Error('Instituição e nome de identificação da conta bancária são obrigatórios.');
    }
    var tipoConta = ValidationService.validateEnum(payload.tipo_conta || 'CORRENTE', ACCOUNT_TYPES, 'tipo_conta');
    var saldoInicial = Number(payload.saldo_inicial_centavos || 0);
    if (!Number.isFinite(saldoInicial) || Math.floor(saldoInicial) !== saldoInicial) {
      throw new Error('O saldo inicial deve ser um inteiro em centavos.');
    }
    var dataSaldoInicial = ValidationService.validateIsoDate(
      payload.data_saldo_inicial || SpreadsheetRepository.todayIso(),
      'data_saldo_inicial',
      false
    );
    var situacao = ValidationService.validateEnum(payload.situacao || 'ATIVA', ACCOUNT_STATUSES, 'situacao');
    var proprietarioId = payload.proprietario_id ? String(payload.proprietario_id).trim() : user.id;

    var created = SpreadsheetRepository.insert('CONTAS_BANCARIAS', {
      id: SpreadsheetRepository.generateId('acc'),
      grupo_id: user.grupo_id,
      instituicao: instituicao,
      nome_identificacao: nomeIdentificacao,
      tipo_conta: tipoConta,
      saldo_inicial_centavos: saldoInicial,
      data_saldo_inicial: dataSaldoInicial,
      situacao: situacao,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      proprietario_id: proprietarioId,
      criado_por: user.id
    });

    // Se o usuário ainda não tem conta padrão, vincula esta como padrão
    if (!user.conta_padrao_id) {
      SpreadsheetRepository.updateById('USUARIOS', user.id, { conta_padrao_id: created.id });
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CONTA_BANCARIA_CRIADA',
      entidade: 'CONTAS_BANCARIAS',
      entidade_id: created.id,
      origem: 'WEB',
      detalhes: { nome: nomeIdentificacao, instituicao: instituicao, saldo_inicial_centavos: saldoInicial }
    });

    return computeAccountSummary(created, SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id));
  }

  function updateBankAccount(user, accountId, patch) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var existing = SpreadsheetRepository.findById('CONTAS_BANCARIAS', accountId, user.grupo_id);
    if (!existing) {
      throw new Error('Conta bancária não encontrada.');
    }
    var updateData = {};
    if (patch.instituicao !== undefined) {
      updateData.instituicao = ValidationService.sanitizeText(patch.instituicao, 100);
      if (!updateData.instituicao) throw new Error('A instituição não pode ficar vazia.');
    }
    if (patch.nome_identificacao !== undefined) {
      updateData.nome_identificacao = ValidationService.sanitizeText(patch.nome_identificacao, 100);
      if (!updateData.nome_identificacao) throw new Error('O nome de identificação não pode ficar vazio.');
    }
    if (patch.tipo_conta !== undefined) {
      updateData.tipo_conta = ValidationService.validateEnum(patch.tipo_conta, ACCOUNT_TYPES, 'tipo_conta');
    }
    if (patch.saldo_inicial_centavos !== undefined) {
      var si = Number(patch.saldo_inicial_centavos);
      if (!Number.isFinite(si) || Math.floor(si) !== si) {
        throw new Error('saldo_inicial_centavos deve ser inteiro em centavos.');
      }
      updateData.saldo_inicial_centavos = si;
    }
    if (patch.data_saldo_inicial !== undefined) {
      updateData.data_saldo_inicial = ValidationService.validateIsoDate(patch.data_saldo_inicial, 'data_saldo_inicial', false);
    }
    if (patch.situacao !== undefined) {
      updateData.situacao = ValidationService.validateEnum(patch.situacao, ACCOUNT_STATUSES, 'situacao');
    }
    if (patch.observacoes !== undefined) {
      updateData.observacoes = ValidationService.sanitizeText(patch.observacoes, 400);
    }
    if (patch.proprietario_id !== undefined) {
      updateData.proprietario_id = patch.proprietario_id ? String(patch.proprietario_id).trim() : '';
    }

    var updated = SpreadsheetRepository.updateById('CONTAS_BANCARIAS', accountId, updateData, user.grupo_id);
    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CONTA_BANCARIA_ATUALIZADA',
      entidade: 'CONTAS_BANCARIAS',
      entidade_id: accountId,
      origem: 'WEB',
      detalhes: updateData
    });

    return computeAccountSummary(updated, SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id));
  }

  /**
   * Calcula saldos de uma conta bancária separando rigorosamente:
   * - saldo_confirmado_centavos: Saldo inicial + entradas CONFIRMADAS - saídas CONFIRMADAS
   * - entradas_previstas_centavos / saidas_previstas_centavos: Lançamentos PREVISTOS ou PENDENTES
   * - saldo_projetado_centavos: saldo_confirmado + entradas_previstas - saidas_previstas
   */
  function computeAccountSummary(account, allGroupLaunches) {
    var saldoInicial = Number(account.saldo_inicial_centavos || 0);
    var entradasConfirmadas = 0;
    var saidasConfirmadas = 0;
    var entradasPrevistas = 0;
    var saidasPrevistas = 0;
    var entradasPendentes = 0;
    var saidasPendentes = 0;

    for (var i = 0; i < allGroupLaunches.length; i++) {
      var l = allGroupLaunches[i];
      if (l.conta_bancaria_id !== account.id) continue;
      if (l.situacao === 'CANCELADO') continue;

      var val = Number(l.valor_centavos || 0);
      if (l.situacao === 'CONFIRMADO') {
        if (l.tipo === 'ENTRADA') entradasConfirmadas += val;
        else if (l.tipo === 'SAIDA') saidasConfirmadas += val;
      } else if (l.situacao === 'PREVISTO') {
        if (l.tipo === 'ENTRADA') entradasPrevistas += val;
        else if (l.tipo === 'SAIDA') saidasPrevistas += val;
      } else if (l.situacao === 'PENDENTE') {
        if (l.tipo === 'ENTRADA') entradasPendentes += val;
        else if (l.tipo === 'SAIDA') saidasPendentes += val;
      }
    }

    var saldoConfirmado = saldoInicial + entradasConfirmadas - saidasConfirmadas;
    var saldoProjetado = saldoConfirmado + entradasPrevistas + entradasPendentes - saidasPrevistas - saidasPendentes;

    var copy = {};
    for (var k in account) {
      if (Object.prototype.hasOwnProperty.call(account, k) && k !== '_rowIndex') {
        copy[k] = account[k];
      }
    }
    copy.entradas_confirmadas_centavos = entradasConfirmadas;
    copy.saidas_confirmadas_centavos = saidasConfirmadas;
    copy.entradas_previstas_centavos = entradasPrevistas;
    copy.saidas_previstas_centavos = saidasPrevistas;
    copy.entradas_pendentes_centavos = entradasPendentes;
    copy.saidas_pendentes_centavos = saidasPendentes;
    copy.saldo_confirmado_centavos = saldoConfirmado;
    copy.saldo_projetado_centavos = saldoProjetado;
    copy.proprietario_id = account.proprietario_id || '';
    copy.proprietario_nome = '';
    copy.proprietario_email = '';
    if (account.proprietario_id) {
      try {
        var ownerUser = SpreadsheetRepository.findById('USUARIOS', account.proprietario_id);
        if (ownerUser) {
          copy.proprietario_nome = ownerUser.nome || ownerUser.email || '';
          copy.proprietario_email = ownerUser.email || '';
        }
      } catch (eUser) {}
    }
    return copy;
  }

  function listBankAccountsWithBalances(user, includeInactive) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
      if (includeInactive) return true;
      return a.situacao === 'ATIVA';
    });
    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id);
    return accounts.map(function (acc) {
      return computeAccountSummary(acc, launches);
    });
  }

  /**
   * Realiza transferência entre duas contas próprias do mesmo grupo financeiro.
   * Cria dois registros vinculados (SAIDA na origem e ENTRADA no destino) com natureza_operacao = TRANSFERENCIA,
   * atualizando o saldo das contas sem duplicar receitas ou despesas de consumo no resultado mensal.
   */
  function createOwnAccountTransfer(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || !payload.conta_origem_id || !payload.conta_destino_id) {
      throw new Error('Conta de origem e conta de destino são obrigatórias para transferência.');
    }
    if (payload.conta_origem_id === payload.conta_destino_id) {
      throw new Error('A conta de origem e a conta de destino devem ser diferentes.');
    }
    var origemAcc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', payload.conta_origem_id, user.grupo_id);
    var destinoAcc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', payload.conta_destino_id, user.grupo_id);
    if (!origemAcc || !destinoAcc) {
      throw new Error('Contas bancárias de transferência não encontradas no seu grupo financeiro.');
    }
    var valorCentavos = ValidationService.validateCentavos(payload.valor_centavos, 'valor_centavos', false);
    var dataTransferencia = ValidationService.validateIsoDate(
      payload.data_lancamento || SpreadsheetRepository.todayIso(),
      'data_lancamento',
      false
    );
    var situacao = ValidationService.validateEnum(payload.situacao || 'CONFIRMADO', ['CONFIRMADO', 'PREVISTO', 'PENDENTE'], 'situacao');
    var descricaoBase = ValidationService.sanitizeText(
      payload.descricao || ('Transferência: ' + origemAcc.nome_identificacao + ' -> ' + destinoAcc.nome_identificacao),
      180
    );

    // Localiza categoria de transferências ou usa a primeira disponível
    var transferCat = SpreadsheetRepository.findOne('CATEGORIAS', function (c) {
      return c.grupo_id === user.grupo_id && c.nome.toLowerCase().indexOf('transfer') !== -1;
    });
    var catId = transferCat ? transferCat.id : 'TRANSFERENCIA_INTERNA';
    var transferenciaId = SpreadsheetRepository.generateId('trf');

    var saidaRecord = {
      id: SpreadsheetRepository.generateId('lan'),
      grupo_id: user.grupo_id,
      tipo: 'SAIDA',
      natureza_operacao: 'TRANSFERENCIA',
      transferencia_id: transferenciaId,
      descricao: descricaoBase + ' (Saída p/ ' + destinoAcc.nome_identificacao + ')',
      valor_centavos: valorCentavos,
      data_lancamento: dataTransferencia,
      data_competencia: dataTransferencia,
      data_pagamento: situacao === 'CONFIRMADO' ? dataTransferencia : '',
      categoria_id: catId,
      subcategoria_id: '',
      conta_bancaria_id: origemAcc.id,
      forma_pagamento: 'TRANSFERENCIA',
      situacao: situacao,
      origem: 'MANUAL',
      referencia_recorrencia_id: '',
      competencia_recorrencia: '',
      referencia_parcela_id: '',
      id_origem_externa: transferenciaId + '_OUT',
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      usuario_responsavel_id: user.id
    };

    var entradaRecord = {
      id: SpreadsheetRepository.generateId('lan'),
      grupo_id: user.grupo_id,
      tipo: 'ENTRADA',
      natureza_operacao: 'TRANSFERENCIA',
      transferencia_id: transferenciaId,
      descricao: descricaoBase + ' (Entrada de ' + origemAcc.nome_identificacao + ')',
      valor_centavos: valorCentavos,
      data_lancamento: dataTransferencia,
      data_competencia: dataTransferencia,
      data_pagamento: situacao === 'CONFIRMADO' ? dataTransferencia : '',
      categoria_id: catId,
      subcategoria_id: '',
      conta_bancaria_id: destinoAcc.id,
      forma_pagamento: 'TRANSFERENCIA',
      situacao: situacao,
      origem: 'MANUAL',
      referencia_recorrencia_id: '',
      competencia_recorrencia: '',
      referencia_parcela_id: '',
      id_origem_externa: transferenciaId + '_IN',
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      usuario_responsavel_id: user.id
    };

    var inserted = SpreadsheetRepository.insertBatch('LANCAMENTOS', [saidaRecord, entradaRecord]);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'TRANSFERENCIA_CONTAS_PROPRIAS',
      entidade: 'LANCAMENTOS',
      entidade_id: transferenciaId,
      origem: 'WEB',
      detalhes: {
        conta_origem_id: origemAcc.id,
        conta_destino_id: destinoAcc.id,
        valor_centavos: valorCentavos,
        situacao: situacao
      }
    });

    return {
      transferencia_id: transferenciaId,
      saida: inserted[0],
      entrada: inserted[1]
    };
  }

  /**
   * Retorna o extrato detalhado e a evolução do saldo de uma conta bancária em um período.
   */
  function getAccountStatement(user, accountId, startDate, endDate) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var account = SpreadsheetRepository.findById('CONTAS_BANCARIAS', accountId, user.grupo_id);
    if (!account) {
      throw new Error('Conta bancária não encontrada.');
    }
    var start = startDate ? ValidationService.validateIsoDate(startDate, 'startDate', true) : '1970-01-01';
    var end = endDate ? ValidationService.validateIsoDate(endDate, 'endDate', true) : '2099-12-31';

    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.conta_bancaria_id === account.id && l.situacao !== 'CANCELADO';
    });

    launches.sort(function (a, b) {
      var cmp = String(a.data_lancamento).localeCompare(String(b.data_lancamento));
      if (cmp !== 0) return cmp;
      return String(a.criado_em).localeCompare(String(b.criado_em));
    });

    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var subs = SpreadsheetRepository.findByGrupo('SUBCATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < cats.length; c++) catMap[cats[c].id] = cats[c];
    var subMap = {};
    for (var s = 0; s < subs.length; s++) subMap[subs[s].id] = subs[s];

    var runningConfirmed = Number(account.saldo_inicial_centavos || 0);
    var saldoAnteriorPeriodo = runningConfirmed;
    var itemsInPeriod = [];
    var receitasPeriodoConfirmadas = 0;
    var despesasPeriodoConfirmadas = 0;

    for (var i = 0; i < launches.length; i++) {
      var item = launches[i];
      var val = Number(item.valor_centavos || 0);
      if (item.situacao === 'CONFIRMADO') {
        if (item.tipo === 'ENTRADA') runningConfirmed += val;
        else if (item.tipo === 'SAIDA') runningConfirmed -= val;
      }

      if (item.data_lancamento < start) {
        if (item.situacao === 'CONFIRMADO') {
          saldoAnteriorPeriodo = runningConfirmed;
        }
      } else if (item.data_lancamento <= end) {
        if (item.situacao === 'CONFIRMADO') {
          if (item.tipo === 'ENTRADA') receitasPeriodoConfirmadas += val;
          else if (item.tipo === 'SAIDA') despesasPeriodoConfirmadas += val;
        }
        var enriched = {};
        for (var k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k) && k !== '_rowIndex') {
            enriched[k] = item[k];
          }
        }
        enriched.categoria_nome = catMap[item.categoria_id] ? catMap[item.categoria_id].nome : 'Sem Categoria';
        enriched.subcategoria_nome = subMap[item.subcategoria_id] ? subMap[item.subcategoria_id].nome : '';
        enriched.saldo_acumulado_confirmado_centavos = runningConfirmed;
        itemsInPeriod.push(enriched);
      }
    }

    return {
      conta: computeAccountSummary(account, launches),
      periodo: { inicio: start, fim: end },
      saldo_anterior_centavos: saldoAnteriorPeriodo,
      receitas_confirmadas_periodo_centavos: receitasPeriodoConfirmadas,
      despesas_confirmadas_periodo_centavos: despesasPeriodoConfirmadas,
      saldo_final_confirmado_centavos: runningConfirmed,
      lancamentos: itemsInPeriod
    };
  }

  /**
   * Reconciliação manual: compara o saldo real informado pelo usuário com o saldo confirmado calculado.
   * Se solicitado (gerar_ajuste = true), cria um lançamento de ajuste auditado.
   */
  function reconcileAccountBalance(user, accountId, informedBalanceCentavos, createAdjustment) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var account = SpreadsheetRepository.findById('CONTAS_BANCARIAS', accountId, user.grupo_id);
    if (!account) {
      throw new Error('Conta bancária não encontrada.');
    }
    var informed = Number(informedBalanceCentavos);
    if (!Number.isFinite(informed) || Math.floor(informed) !== informed) {
      throw new Error('O saldo informado para conciliação deve ser um número inteiro em centavos.');
    }
    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id);
    var summary = computeAccountSummary(account, launches);
    var diff = informed - summary.saldo_confirmado_centavos;
    var adjustmentLaunch = null;

    if (createAdjustment && diff !== 0) {
      var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
      var defaultCatId = cats.length > 0 ? cats[0].id : 'AJUSTE_CONCILIACAO';
      adjustmentLaunch = SpreadsheetRepository.insert('LANCAMENTOS', {
        id: SpreadsheetRepository.generateId('lan'),
        grupo_id: user.grupo_id,
        tipo: diff > 0 ? 'ENTRADA' : 'SAIDA',
        natureza_operacao: 'PADRAO',
        transferencia_id: '',
        descricao: 'Ajuste de Reconciliação Manual (' + account.nome_identificacao + ')',
        valor_centavos: Math.abs(diff),
        data_lancamento: SpreadsheetRepository.todayIso(),
        data_competencia: SpreadsheetRepository.todayIso(),
        data_pagamento: SpreadsheetRepository.todayIso(),
        categoria_id: defaultCatId,
        subcategoria_id: '',
        conta_bancaria_id: account.id,
        forma_pagamento: 'OUTRO',
        situacao: 'CONFIRMADO',
        origem: 'MANUAL',
        observacoes: 'Ajuste automático de reconciliação bancária manual.',
        usuario_responsavel_id: user.id
      });
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CONCILIACAO_BANCARIA_MANUAL',
      entidade: 'CONTAS_BANCARIAS',
      entidade_id: account.id,
      origem: 'WEB',
      detalhes: {
        saldo_calculado_centavos: summary.saldo_confirmado_centavos,
        saldo_informado_centavos: informed,
        diferenca_centavos: diff,
        ajuste_gerado: Boolean(adjustmentLaunch)
      }
    });

    return {
      conta_id: account.id,
      saldo_calculado_anterior_centavos: summary.saldo_confirmado_centavos,
      saldo_informado_centavos: informed,
      diferenca_centavos: diff,
      conciliado: diff === 0 || Boolean(adjustmentLaunch),
      lancamento_ajuste: adjustmentLaunch
    };
  }

  return {
    ACCOUNT_TYPES: ACCOUNT_TYPES,
    ACCOUNT_STATUSES: ACCOUNT_STATUSES,
    createBankAccount: createBankAccount,
    updateBankAccount: updateBankAccount,
    computeAccountSummary: computeAccountSummary,
    listBankAccountsWithBalances: listBankAccountsWithBalances,
    createOwnAccountTransfer: createOwnAccountTransfer,
    getAccountStatement: getAccountStatement,
    reconcileAccountBalance: reconcileAccountBalance
  };
})();

