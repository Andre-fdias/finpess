/**
 * @file LoanService.gs
 * @description Módulo exclusivo do sistema web para empréstimos pessoais e consignados
 * (com desconto em folha). Evita dupla contagem de parcelas descontadas diretamente
 * do salário quando a receita cadastrada já corresponde ao salário líquido.
 */

var LoanService = (function () {
  var LOAN_TYPES = ['PESSOAL', 'CONSIGNADO', 'FINANCIAMENTO', 'OUTRO'];
  var LOAN_STATUSES = ['ATIVO', 'QUITADO', 'SUSPENSO', 'CANCELADO'];

  function assertWebChannelOnly(channel) {
    if (channel && String(channel).toUpperCase() === 'TELEGRAM') {
      throw new Error('FORBIDDEN_TELEGRAM_SCOPE: O módulo de empréstimos é gerenciado exclusivamente pelo sistema web. O Telegram não pode criar, editar ou excluir empréstimos.');
    }
  }

  /**
   * Calcula quantas parcelas mensais já venceram até a data de hoje.
   * Utilizado para inicializar e atualizar contratos que iniciaram no passado.
   */
  function calculatePastInstallmentsCount(dataInicialIso, diaVencimento, totalParcelas) {
    if (!dataInicialIso || !totalParcelas) return 0;
    var todayIso = SpreadsheetRepository.todayIso();
    var parts = dataInicialIso.split('-');
    var startYear = parseInt(parts[0], 10);
    var startMonth = parseInt(parts[1], 10);
    var targetDia = diaVencimento || parseInt(parts[2] || '1', 10);
    var count = 0;

    for (var i = 1; i <= totalParcelas; i++) {
      var d = new Date(Date.UTC(startYear, startMonth - 1 + (i - 1), 1));
      var ty = d.getUTCFullYear();
      var tm = d.getUTCMonth() + 1;
      var lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      var td = Math.min(targetDia, lastDay);
      var dueIso = ty + '-' + String(tm).padStart(2, '0') + '-' + String(td).padStart(2, '0');

      if (dueIso <= todayIso) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  function createLoan(user, payload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados do empréstimo não informados.');
    }
    var instituicao = ValidationService.sanitizeText(payload.instituicao, 120);
    var descricao = ValidationService.sanitizeText(payload.descricao || ('Empréstimo ' + instituicao), 200);
    if (!instituicao) {
      throw new Error('A instituição ou credor do empréstimo é obrigatória.');
    }
    var tipoEmprestimo = ValidationService.validateEnum(payload.tipo_emprestimo || 'PESSOAL', LOAN_TYPES, 'tipo_emprestimo');
    var valorContratado = ValidationService.validateCentavos(payload.valor_contratado_centavos, 'valor_contratado_centavos', false);
    var numeroParcelas = parseInt(payload.numero_parcelas, 10);
    if (isNaN(numeroParcelas) || numeroParcelas < 1 || numeroParcelas > 360) {
      throw new Error('O número de parcelas deve estar entre 1 e 360.');
    }
    var valorParcela = ValidationService.validateCentavos(payload.valor_parcela_centavos, 'valor_parcela_centavos', false);
    var dataInicial = ValidationService.validateIsoDate(
      payload.data_inicial || SpreadsheetRepository.todayIso(),
      'data_inicial',
      false
    );
    var diaVencimento = payload.dia_vencimento
      ? Math.max(1, Math.min(31, parseInt(payload.dia_vencimento, 10)))
      : parseInt(dataInicial.substring(8, 10), 10);
    var taxaJurosBps = payload.taxa_juros_mensal_bps !== undefined
      ? Math.max(0, Math.round(Number(payload.taxa_juros_mensal_bps) || 0))
      : 0;

    var descontoEmFolha = tipoEmprestimo === 'CONSIGNADO' || Boolean(payload.desconto_em_folha);
    var descontoJaDeduzidoSalario = descontoEmFolha && (
      payload.desconto_em_folha_ja_deduzido_salario !== undefined
        ? Boolean(payload.desconto_em_folha_ja_deduzido_salario)
        : true
    );

    var autoPastPagas = calculatePastInstallmentsCount(dataInicial, diaVencimento, numeroParcelas);
    var parcelasPagas = (payload.parcelas_pagas !== undefined && String(payload.parcelas_pagas).trim() !== '')
      ? Math.max(0, Math.min(numeroParcelas, parseInt(payload.parcelas_pagas, 10)))
      : ((tipoEmprestimo === 'CONSIGNADO' || descontoEmFolha) ? autoPastPagas : 0);

    var saldoDevedor = payload.saldo_devedor_centavos !== undefined
      ? ValidationService.validateCentavos(payload.saldo_devedor_centavos, 'saldo_devedor_centavos', true)
      : (valorParcela * Math.max(0, numeroParcelas - parcelasPagas));

    var initialSituacao = parcelasPagas >= numeroParcelas ? 'QUITADO' : 'ATIVO';

    var createdLoan = SpreadsheetRepository.insert('EMPRESTIMOS', {
      id: SpreadsheetRepository.generateId('emp'),
      grupo_id: user.grupo_id,
      instituicao: instituicao,
      descricao: descricao,
      tipo_emprestimo: tipoEmprestimo,
      valor_contratado_centavos: valorContratado,
      taxa_juros_mensal_bps: taxaJurosBps,
      numero_parcelas: numeroParcelas,
      valor_parcela_centavos: valorParcela,
      data_inicial: dataInicial,
      dia_vencimento: diaVencimento,
      saldo_devedor_centavos: saldoDevedor,
      desconto_em_folha: descontoEmFolha,
      desconto_em_folha_ja_deduzido_salario: descontoJaDeduzidoSalario,
      conta_bancaria_id: payload.conta_bancaria_id ? ValidationService.sanitizeText(payload.conta_bancaria_id, 64) : '',
      situacao: initialSituacao,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      criado_por: user.id
    });

    // Gera cronograma de parcelas em PARCELAS
    var parts = dataInicial.split('-');
    var startYear = parseInt(parts[0], 10);
    var startMonth = parseInt(parts[1], 10);
    var parcelasBatch = [];

    for (var i = 1; i <= numeroParcelas; i++) {
      var d = new Date(Date.UTC(startYear, startMonth - 1 + (i - 1), 1));
      var ty = d.getUTCFullYear();
      var tm = d.getUTCMonth() + 1;
      var lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      var td = Math.min(diaVencimento, lastDay);
      var dueIso = ty + '-' + String(tm).padStart(2, '0') + '-' + String(td).padStart(2, '0');

      var isPaga = i <= parcelasPagas;

      parcelasBatch.push({
        id: SpreadsheetRepository.generateId('par'),
        grupo_id: user.grupo_id,
        origem_tipo: 'EMPRESTIMO',
        origem_id: createdLoan.id,
        numero_parcela: i,
        total_parcelas: numeroParcelas,
        valor_centavos: valorParcela,
        data_vencimento: dueIso,
        data_pagamento: isPaga ? dueIso : '',
        situacao: isPaga ? 'PAGA' : 'PREVISTA',
        lancamento_id: '',
        observacoes: descricao + ' (' + i + '/' + numeroParcelas + ')'
      });
    }

    var insertedParcelas = SpreadsheetRepository.insertBatch('PARCELAS', parcelasBatch);

    if (!descontoEmFolha) {
      syncUserPaidLoanLaunches(user);
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'EMPRESTIMO_CADASTRADO',
      entidade: 'EMPRESTIMOS',
      entidade_id: createdLoan.id,
      origem: 'WEB',
      detalhes: {
        instituicao: instituicao,
        tipo_emprestimo: tipoEmprestimo,
        valor_contratado_centavos: valorContratado,
        numero_parcelas: numeroParcelas,
        desconto_em_folha_ja_deduzido_salario: descontoJaDeduzidoSalario
      }
    });

    return {
      emprestimo: createdLoan,
      parcelas: insertedParcelas
    };
  }

  /**
   * Registra pagamento de uma parcela de empréstimo.
   * Se o empréstimo for consignado com desconto_em_folha_ja_deduzido_salario = true,
   * baixa a parcela e reduz o saldo devedor SEM criar uma saída duplicada na conta bancária
   * (a menos que o usuário solicite explicitamente gerar lançamento bancário porque cadastrou salário bruto).
   */
  function payLoanInstallment(user, parcelaId, paymentPayload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    var parcela = SpreadsheetRepository.findById('PARCELAS', parcelaId, user.grupo_id);
    if (!parcela || parcela.origem_tipo !== 'EMPRESTIMO') {
      throw new Error('Parcela de empréstimo não encontrada.');
    }
    if (parcela.situacao === 'PAGA') {
      return parcela;
    }

    var loan = SpreadsheetRepository.findById('EMPRESTIMOS', parcela.origem_id, user.grupo_id);
    if (!loan) {
      throw new Error('Contrato de empréstimo não encontrado.');
    }

    var payDate = (paymentPayload && paymentPayload.data_pagamento)
      ? ValidationService.validateIsoDate(paymentPayload.data_pagamento, 'data_pagamento', false)
      : SpreadsheetRepository.todayIso();
    var paidVal = (paymentPayload && paymentPayload.valor_centavos !== undefined)
      ? ValidationService.validateCentavos(paymentPayload.valor_centavos, 'valor_centavos', false)
      : parcela.valor_centavos;

    var generatedLaunchId = '';
    var shouldCreateBankLaunch = !(loan.desconto_em_folha && loan.desconto_em_folha_ja_deduzido_salario);

    if (shouldCreateBankLaunch) {
      var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) { return a.situacao === 'ATIVA'; });
      var accountId = (paymentPayload && paymentPayload.conta_bancaria_id) ||
        loan.conta_bancaria_id ||
        user.conta_padrao_id ||
        (accounts[0] && accounts[0].id);
      if (!accountId) {
        throw new Error('Informe uma conta bancária para debitar a parcela do empréstimo.');
      }

      var existingLaunch = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
        return l.referencia_parcela_id === parcela.id ||
          (l.id_origem_externa && l.id_origem_externa === ('par_emp_' + parcela.id)) ||
          (parcela.lancamento_id && l.id === parcela.lancamento_id);
      }, user.grupo_id);

      if (existingLaunch) {
        var confirmed = FinanceService.confirmLaunch(user, existingLaunch.id, {
          data_pagamento: payDate,
          valor_centavos: paidVal,
          conta_bancaria_id: accountId
        });
        generatedLaunchId = confirmed.id;
      } else {
        var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
        var loanCat = cats[0];
        for (var c = 0; c < cats.length; c++) {
          if (cats[c].nome && cats[c].nome.toLowerCase().indexOf('compromisso') !== -1) {
            loanCat = cats[c];
            break;
          }
        }
        var launch = FinanceService.createLaunch(user, {
          tipo: 'SAIDA',
          descricao: 'Parcela Empréstimo ' + loan.instituicao + ' (' + parcela.numero_parcela + '/' + parcela.total_parcelas + ')',
          valor_centavos: paidVal,
          data_lancamento: parcela.data_vencimento,
          data_competencia: parcela.data_vencimento,
          data_pagamento: payDate,
          categoria_id: loanCat ? loanCat.id : '',
          conta_bancaria_id: accountId,
          forma_pagamento: loan.desconto_em_folha ? 'FOLHA' : 'DEBITO',
          situacao: 'CONFIRMADO',
          origem: 'EMPRESTIMO',
          referencia_parcela_id: parcela.id,
          id_origem_externa: 'par_emp_' + parcela.id,
          observacoes: 'Pagamento de parcela de empréstimo'
        }, 'WEB');
        generatedLaunchId = launch.id;
      }
    }

    var updatedParcela = SpreadsheetRepository.updateById('PARCELAS', parcela.id, {
      situacao: 'PAGA',
      data_pagamento: payDate,
      valor_centavos: paidVal,
      lancamento_id: generatedLaunchId
    }, user.grupo_id);

    var novoSaldoDevedor = Math.max(0, Number(loan.saldo_devedor_centavos || 0) - paidVal);
    var remaining = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'EMPRESTIMO' && p.origem_id === loan.id && p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
    });

    SpreadsheetRepository.updateById('EMPRESTIMOS', loan.id, {
      saldo_devedor_centavos: remaining.length === 0 ? 0 : novoSaldoDevedor,
      situacao: remaining.length === 0 ? 'QUITADO' : loan.situacao
    }, user.grupo_id);

    return updatedParcela;
  }

  /**
   * Sincroniza os lançamentos de empréstimos pagos pelo usuário (não consignados).
   * - Gera lançamentos PREVISTOS para parcelas futuras/em aberto.
   * - Marca lançamentos como CONFIRMADO para parcelas já pagas.
   * - Limpa/cancela automaticamente lançamentos duplicados.
   * - Se um empréstimo for consignado (desconto em folha/salário), cancela quaisquer
   *   lançamentos bancários indevidos vinculados a ele para proteger o saldo de caixa.
   */
  function syncUserPaidLoanLaunches(user) {
    if (!user || !user.grupo_id) return;

    var allLoans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id);
    if (allLoans.length === 0) return;

    var loanMap = {};
    var consignadoOrCanceledLoanIds = {};
    for (var i = 0; i < allLoans.length; i++) {
      var l = allLoans[i];
      if (!l.desconto_em_folha && l.situacao !== 'CANCELADO') {
        loanMap[l.id] = l;
      } else {
        consignadoOrCanceledLoanIds[l.id] = true;
      }
    }

    var allParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'EMPRESTIMO';
    });
    if (allParcelas.length === 0) return;

    var existingLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (lan) {
      return lan.origem === 'EMPRESTIMO' || (lan.id_origem_externa && String(lan.id_origem_externa).indexOf('par_emp_') === 0);
    });

    // Mapeia parcelas de empréstimos consignados ou cancelados
    var consignadoParcelaIds = {};
    for (var cp = 0; cp < allParcelas.length; cp++) {
      if (consignadoOrCanceledLoanIds[allParcelas[cp].origem_id] || allParcelas[cp].situacao === 'CANCELADA') {
        consignadoParcelaIds[allParcelas[cp].id] = true;
      }
    }

    // 1. Limpeza de lançamentos bancários indevidos pertencentes a empréstimos consignados (desconto em folha)
    var lancamentosToCancel = {};
    for (var elIdx = 0; elIdx < existingLaunches.length; elIdx++) {
      var lanItem = existingLaunches[elIdx];
      if (lanItem.situacao === 'CANCELADO') continue;

      var pId = lanItem.referencia_parcela_id;
      if (!pId && lanItem.id_origem_externa && String(lanItem.id_origem_externa).indexOf('par_emp_') === 0) {
        pId = String(lanItem.id_origem_externa).replace('par_emp_', '');
      }

      if (pId && consignadoParcelaIds[pId]) {
        lancamentosToCancel[lanItem.id] = { situacao: 'CANCELADO' };
      }
    }

    // 2. Mapeamento e Deduplicação estrita de lançamentos existentes para empréstimos pagos pelo usuário
    var launchByParcelaId = {};
    var launchByDescDate = {};

    for (var k = 0; k < existingLaunches.length; k++) {
      var it = existingLaunches[k];
      if (it.situacao === 'CANCELADO' || lancamentosToCancel[it.id]) continue;

      var pid = it.referencia_parcela_id;
      if (!pid && it.id_origem_externa && String(it.id_origem_externa).indexOf('par_emp_') === 0) {
        pid = String(it.id_origem_externa).replace('par_emp_', '');
      }

      var dKey = String(it.descricao || '').trim().toLowerCase() + '::' + String(it.data_lancamento || '').trim();

      // Se já existe um lançamento ativo para esta mesma parcela ou mesma descrição+data, marca os extras como duplicados e cancela
      if ((pid && launchByParcelaId[pid]) || (dKey && launchByDescDate[dKey])) {
        lancamentosToCancel[it.id] = { situacao: 'CANCELADO' };
      } else {
        if (pid) launchByParcelaId[pid] = it;
        if (dKey) launchByDescDate[dKey] = it;
      }
    }

    if (Object.keys(lancamentosToCancel).length > 0) {
      SpreadsheetRepository.updateBatch('LANCAMENTOS', lancamentosToCancel, user.grupo_id);
    }

    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) { return a.situacao === 'ATIVA'; });
    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var defaultCatId = cats[0] ? cats[0].id : '';
    for (var c = 0; c < cats.length; c++) {
      var cName = (cats[c].nome || '').toLowerCase();
      if (cName.indexOf('compromisso') !== -1 || cName.indexOf('empréstimo') !== -1 || cName.indexOf('emprestimo') !== -1) {
        defaultCatId = cats[c].id;
        break;
      }
    }

    var toInsert = [];
    var activeParcelas = allParcelas.filter(function (p) {
      return Boolean(loanMap[p.origem_id]) && p.situacao !== 'CANCELADA';
    });

    for (var pIdx = 0; pIdx < activeParcelas.length; pIdx++) {
      var par = activeParcelas[pIdx];
      var ln = loanMap[par.origem_id];
      if (!ln) continue;

      var descr = 'Parcela Empréstimo ' + ln.instituicao + ' (' + par.numero_parcela + '/' + par.total_parcelas + ')';
      var dKeyCheck = descr.toLowerCase() + '::' + par.data_vencimento;
      var existingLan = launchByParcelaId[par.id] || launchByDescDate[dKeyCheck];
      if (!existingLan) {
        var isPaga = par.situacao === 'PAGA';
        var lanId = SpreadsheetRepository.generateId('lan');
        var accId = ln.conta_bancaria_id || user.conta_padrao_id || (accounts[0] && accounts[0].id) || '';
        toInsert.push({
          id: lanId,
          grupo_id: user.grupo_id,
          tipo: 'SAIDA',
          natureza_operacao: 'DESPESA_FIXA',
          transferencia_id: '',
          descricao: descr,
          valor_centavos: par.valor_centavos,
          data_lancamento: par.data_vencimento,
          data_competencia: par.data_vencimento,
          data_pagamento: isPaga ? (par.data_pagamento || par.data_vencimento) : '',
          categoria_id: defaultCatId,
          subcategoria_id: '',
          conta_bancaria_id: accId,
          forma_pagamento: 'DEBITO',
          situacao: isPaga ? 'CONFIRMADO' : 'PREVISTO',
          origem: 'EMPRESTIMO',
          referencia_recorrencia_id: '',
          competencia_recorrencia: '',
          referencia_parcela_id: par.id,
          id_origem_externa: 'par_emp_' + par.id,
          observacoes: (ln.descricao || ln.instituicao) + ' - Parcela ' + par.numero_parcela + '/' + par.total_parcelas,
          criado_em: SpreadsheetRepository.nowIso(),
          atualizado_em: SpreadsheetRepository.nowIso(),
          usuario_responsavel_id: user.id
        });
        launchByParcelaId[par.id] = { id: lanId, situacao: isPaga ? 'CONFIRMADO' : 'PREVISTO' };
        launchByDescDate[dKeyCheck] = { id: lanId, situacao: isPaga ? 'CONFIRMADO' : 'PREVISTO' };
        if (par.lancamento_id !== lanId) {
          SpreadsheetRepository.updateById('PARCELAS', par.id, { lancamento_id: lanId }, user.grupo_id);
        }
      } else {
        if (par.situacao === 'PAGA' && existingLan.situacao !== 'CONFIRMADO') {
          SpreadsheetRepository.updateById('LANCAMENTOS', existingLan.id, {
            situacao: 'CONFIRMADO',
            data_pagamento: par.data_pagamento || SpreadsheetRepository.todayIso()
          }, user.grupo_id);
        } else if (par.situacao === 'PREVISTA' && existingLan.situacao === 'CONFIRMADO') {
          SpreadsheetRepository.updateById('PARCELAS', par.id, {
            situacao: 'PAGA',
            data_pagamento: existingLan.data_pagamento || SpreadsheetRepository.todayIso()
          }, user.grupo_id);
        }
      }
    }

    if (toInsert.length > 0) {
      SpreadsheetRepository.insertBatch('LANCAMENTOS', toInsert);
    }
  }

  function listLoans(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var loans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id);
    var allParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'EMPRESTIMO' && p.situacao !== 'CANCELADA';
    });
    var todayIso = SpreadsheetRepository.todayIso();

    return loans.map(function (l) {
      var isConsignado = l.tipo_emprestimo === 'CONSIGNADO' || Boolean(l.desconto_em_folha);
      var lParcelas = allParcelas.filter(function (p) { return p.origem_id === l.id; });
      lParcelas.sort(function (a, b) { return a.numero_parcela - b.numero_parcela; });
      var copy = {};
      for (var k in l) {
        if (Object.prototype.hasOwnProperty.call(l, k) && k !== '_rowIndex') copy[k] = l[k];
      }

      var pagasCount = 0;
      var remainingDevedor = 0;
      for (var i = 0; i < lParcelas.length; i++) {
        var p = lParcelas[i];
        var isPaga = p.situacao === 'PAGA' || (isConsignado && l.situacao === 'ATIVO' && p.data_vencimento && p.data_vencimento <= todayIso);
        if (isPaga) {
          pagasCount++;
        } else {
          remainingDevedor += Number(p.valor_centavos || 0);
        }
      }

      copy.parcelas = lParcelas;
      copy.parcelas_pagas = pagasCount;
      if (l.situacao === 'QUITADO' || l.situacao === 'CANCELADO') {
        copy.saldo_devedor_centavos = 0;
      } else if (pagasCount >= Number(l.numero_parcelas || 0)) {
        copy.saldo_devedor_centavos = 0;
      } else if (remainingDevedor > 0) {
        copy.saldo_devedor_centavos = remainingDevedor;
      }
      return copy;
    });
  }

  function updateLoan(user, loanId, patch, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    var loan = SpreadsheetRepository.findById('EMPRESTIMOS', loanId, user.grupo_id);
    if (!loan) {
      throw new Error('Empréstimo não encontrado.');
    }
    var updateData = {};
    if (patch.instituicao !== undefined) {
      updateData.instituicao = ValidationService.sanitizeText(patch.instituicao, 120);
    }
    if (patch.descricao !== undefined) {
      updateData.descricao = ValidationService.sanitizeText(patch.descricao, 200);
    }
    if (patch.situacao !== undefined) {
      updateData.situacao = ValidationService.validateEnum(patch.situacao, LOAN_STATUSES, 'situacao');
    }
    if (patch.observacoes !== undefined) {
      updateData.observacoes = ValidationService.sanitizeText(patch.observacoes, 400);
    }
    if (patch.conta_bancaria_id !== undefined) {
      updateData.conta_bancaria_id = patch.conta_bancaria_id ? ValidationService.sanitizeText(patch.conta_bancaria_id, 64) : '';
    }

    var tipoEmprestimo = patch.tipo_emprestimo !== undefined
      ? ValidationService.validateEnum(patch.tipo_emprestimo, LOAN_TYPES, 'tipo_emprestimo')
      : loan.tipo_emprestimo;
    if (patch.tipo_emprestimo !== undefined) {
      updateData.tipo_emprestimo = tipoEmprestimo;
    }

    var descontoEmFolha = patch.desconto_em_folha !== undefined
      ? Boolean(patch.desconto_em_folha)
      : (tipoEmprestimo === 'CONSIGNADO' || Boolean(loan.desconto_em_folha));
    if (patch.desconto_em_folha !== undefined || patch.tipo_emprestimo !== undefined) {
      updateData.desconto_em_folha = descontoEmFolha;
      updateData.desconto_em_folha_ja_deduzido_salario = descontoEmFolha;
    }

    if (patch.valor_contratado_centavos !== undefined) {
      updateData.valor_contratado_centavos = ValidationService.validateCentavos(patch.valor_contratado_centavos, 'valor_contratado_centavos', false);
    }

    if (patch.taxa_juros_mensal_bps !== undefined) {
      updateData.taxa_juros_mensal_bps = Math.max(0, Math.round(Number(patch.taxa_juros_mensal_bps) || 0));
    }

    var newNumeroParcelas = patch.numero_parcelas !== undefined ? parseInt(patch.numero_parcelas, 10) : Number(loan.numero_parcelas || 24);
    if (patch.numero_parcelas !== undefined) {
      if (isNaN(newNumeroParcelas) || newNumeroParcelas < 1 || newNumeroParcelas > 360) {
        throw new Error('O número de parcelas deve estar entre 1 e 360.');
      }
      updateData.numero_parcelas = newNumeroParcelas;
    }

    var newValorParcela = patch.valor_parcela_centavos !== undefined
      ? ValidationService.validateCentavos(patch.valor_parcela_centavos, 'valor_parcela_centavos', false)
      : Number(loan.valor_parcela_centavos || 0);
    if (patch.valor_parcela_centavos !== undefined) {
      updateData.valor_parcela_centavos = newValorParcela;
    }

    var newDataInicial = (patch.data_inicial !== undefined && String(patch.data_inicial).trim() !== '')
      ? ValidationService.validateIsoDate(patch.data_inicial, 'data_inicial', false)
      : loan.data_inicial;
    if (patch.data_inicial !== undefined && String(patch.data_inicial).trim() !== '') {
      updateData.data_inicial = newDataInicial;
    }

    var diaVencimento = patch.dia_vencimento !== undefined
      ? Math.max(1, Math.min(31, parseInt(patch.dia_vencimento, 10)))
      : (newDataInicial ? parseInt(newDataInicial.substring(8, 10), 10) : Number(loan.dia_vencimento || 10));
    if (patch.dia_vencimento !== undefined || patch.data_inicial !== undefined) {
      updateData.dia_vencimento = diaVencimento;
    }

    // Atualiza cronograma de parcelas vinculado
    var existingParcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
      return p.origem_tipo === 'EMPRESTIMO' && p.origem_id === loanId;
    });
    existingParcelas.sort(function (a, b) { return a.numero_parcela - b.numero_parcela; });

    var pagasCount = existingParcelas.filter(function (p) { return p.situacao === 'PAGA'; }).length;
    var autoPastPagas = calculatePastInstallmentsCount(newDataInicial, diaVencimento, newNumeroParcelas);
    var targetPagas = (patch.parcelas_pagas !== undefined && String(patch.parcelas_pagas).trim() !== '')
      ? Math.max(0, Math.min(newNumeroParcelas, parseInt(patch.parcelas_pagas, 10)))
      : ((tipoEmprestimo === 'CONSIGNADO' || descontoEmFolha) ? Math.max(pagasCount, autoPastPagas) : pagasCount);

    var parts = (newDataInicial || loan.data_inicial || SpreadsheetRepository.todayIso()).split('-');
    var startYear = parseInt(parts[0], 10);
    var startMonth = parseInt(parts[1], 10);
    var finalDescricao = updateData.descricao || loan.descricao || loan.instituicao;
    var finalInstituicao = updateData.instituicao || loan.instituicao;

    // Atualiza parcelas existentes em lote
    var parcelasUpdates = {};
    var lancamentosUpdates = {};

    for (var ep = 0; ep < existingParcelas.length; ep++) {
      var par = existingParcelas[ep];

      if (par.numero_parcela > newNumeroParcelas) {
        if (par.situacao !== 'PAGA') {
          parcelasUpdates[par.id] = { situacao: 'CANCELADA' };
          if (par.lancamento_id) {
            lancamentosUpdates[par.lancamento_id] = { situacao: 'CANCELADO' };
          }
        }
      } else {
        var d = new Date(Date.UTC(startYear, startMonth - 1 + (par.numero_parcela - 1), 1));
        var ty = d.getUTCFullYear();
        var tm = d.getUTCMonth() + 1;
        var lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
        var td = Math.min(diaVencimento, lastDay);
        var dueIso = ty + '-' + String(tm).padStart(2, '0') + '-' + String(td).padStart(2, '0');

        var isPaga = par.numero_parcela <= targetPagas;
        var parPatch = {
          total_parcelas: newNumeroParcelas,
          data_vencimento: dueIso,
          valor_centavos: newValorParcela,
          observacoes: finalDescricao + ' (' + par.numero_parcela + '/' + newNumeroParcelas + ')'
        };

        if (isPaga) {
          parPatch.situacao = 'PAGA';
          parPatch.data_pagamento = par.data_pagamento || dueIso;
        } else {
          parPatch.situacao = (updateData.situacao === 'CANCELADO' ? 'CANCELADA' : 'PREVISTA');
          parPatch.data_pagamento = '';
        }

        parcelasUpdates[par.id] = parPatch;

        if (par.lancamento_id) {
          lancamentosUpdates[par.lancamento_id] = {
            valor_centavos: newValorParcela,
            data_lancamento: dueIso,
            data_competencia: dueIso,
            descricao: 'Parcela Empréstimo ' + finalInstituicao + ' (' + par.numero_parcela + '/' + newNumeroParcelas + ')',
            conta_bancaria_id: updateData.conta_bancaria_id !== undefined ? updateData.conta_bancaria_id : loan.conta_bancaria_id,
            situacao: updateData.situacao === 'CANCELADO' ? 'CANCELADO' : (isPaga ? 'CONFIRMADO' : 'PREVISTO'),
            data_pagamento: isPaga ? (parPatch.data_pagamento || dueIso) : ''
          };
        }
      }
    }

    if (Object.keys(parcelasUpdates).length > 0) {
      SpreadsheetRepository.updateBatch('PARCELAS', parcelasUpdates, user.grupo_id);
    }
    if (Object.keys(lancamentosUpdates).length > 0) {
      SpreadsheetRepository.updateBatch('LANCAMENTOS', lancamentosUpdates, user.grupo_id);
    }

    // Se o número de parcelas aumentou, cria as novas parcelas
    var newBatch = [];
    var maxExistingNum = 0;
    for (var m = 0; m < existingParcelas.length; m++) {
      if (existingParcelas[m].numero_parcela > maxExistingNum) maxExistingNum = existingParcelas[m].numero_parcela;
    }
    for (var np = maxExistingNum + 1; np <= newNumeroParcelas; np++) {
      var dNew = new Date(Date.UTC(startYear, startMonth - 1 + (np - 1), 1));
      var tyNew = dNew.getUTCFullYear();
      var tmNew = dNew.getUTCMonth() + 1;
      var lastDayNew = new Date(Date.UTC(tyNew, tmNew, 0)).getUTCDate();
      var tdNew = Math.min(diaVencimento, lastDayNew);
      var dueIsoNew = tyNew + '-' + String(tmNew).padStart(2, '0') + '-' + String(tdNew).padStart(2, '0');

      var isNewPaga = np <= targetPagas;
      newBatch.push({
        id: SpreadsheetRepository.generateId('par'),
        grupo_id: user.grupo_id,
        origem_tipo: 'EMPRESTIMO',
        origem_id: loanId,
        numero_parcela: np,
        total_parcelas: newNumeroParcelas,
        valor_centavos: newValorParcela,
        data_vencimento: dueIsoNew,
        data_pagamento: isNewPaga ? dueIsoNew : '',
        situacao: isNewPaga ? 'PAGA' : 'PREVISTA',
        lancamento_id: '',
        observacoes: finalDescricao + ' (' + np + '/' + newNumeroParcelas + ')'
      });
    }
    if (newBatch.length > 0) {
      SpreadsheetRepository.insertBatch('PARCELAS', newBatch);
    }

    // Recalcula saldo devedor
    var remainingDevedor = Math.max(0, newNumeroParcelas - targetPagas) * newValorParcela;
    if (updateData.situacao === 'CANCELADO') {
      updateData.saldo_devedor_centavos = 0;
    } else if (targetPagas >= newNumeroParcelas) {
      updateData.situacao = 'QUITADO';
      updateData.saldo_devedor_centavos = 0;
    } else {
      if (updateData.situacao === 'QUITADO') {
        updateData.situacao = 'ATIVO';
      }
      updateData.saldo_devedor_centavos = remainingDevedor;
    }

    var updated = SpreadsheetRepository.updateById('EMPRESTIMOS', loanId, updateData, user.grupo_id);

    // Sincroniza lançamentos bancários conforme modalidade (cria se for pago pelo usuário, limpa/cancela se for consignado em folha)
    syncUserPaidLoanLaunches(user);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'EMPRESTIMO_ATUALIZADO',
      entidade: 'EMPRESTIMOS',
      entidade_id: loanId,
      origem: 'WEB',
      detalhes: updateData
    });
    return updated;
  }

  return {
    LOAN_TYPES: LOAN_TYPES,
    LOAN_STATUSES: LOAN_STATUSES,
    assertWebChannelOnly: assertWebChannelOnly,
    createLoan: createLoan,
    payLoanInstallment: payLoanInstallment,
    updateLoan: updateLoan,
    listLoans: listLoans,
    syncUserPaidLoanLaunches: syncUserPaidLoanLaunches
  };
})();

