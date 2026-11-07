/**
 * @file CreditCardService.gs
 * @description Subsistema completo de gestão de Cartões de Crédito, Faturas, Compras
 * Parceladas, Limites, Melhor Dia de Compra e Liquidação de Faturas com integração
 * contábil estrita ao saldo bancário e prevenção absoluta de duplicidade.
 */

var CreditCardService = (function () {
  var CARD_BRANDS = ['MASTERCARD', 'VISA', 'ELO', 'AMEX', 'HIPERCARD', 'DINERS', 'OUTRA'];
  var INVOICE_STATUSES = ['ABERTA', 'FECHADA', 'PAGA', 'PARCIAL'];
  var PURCHASE_STATUSES = ['ATIVA', 'CANCELADA', 'ESTORNADA'];
  var INSTALLMENT_STATUSES = ['PREVISTA', 'FATURADA', 'PAGA', 'CANCELADA'];
  var ADJUSTMENT_TYPES = ['ESTORNO', 'ANUIDADE', 'JUROS', 'MULTA', 'AJUSTE'];

  function normalizeBrand(raw) {
    var b = String(raw || '').toUpperCase().trim();
    return CARD_BRANDS.indexOf(b) !== -1 ? b : 'OUTRA';
  }

  function addMonthsToYm(ym, count) {
    var parts = ym.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1; // 0-indexed
    var d = new Date(Date.UTC(y, m + count, 1));
    var resY = d.getUTCFullYear();
    var resM = d.getUTCMonth() + 1;
    return resY + '-' + (resM < 10 ? '0' + resM : resM);
  }

  function getDaysInMonth(year, month1Indexed) {
    return new Date(Date.UTC(year, month1Indexed, 0)).getUTCDate();
  }

  /**
   * Calcula as datas exatas de fechamento e vencimento de uma fatura de competência YYYY-MM.
   */
  function computeClosingAndDueDates(mesCompetencia, diaFechamento, diaVencimento) {
    var parts = mesCompetencia.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);

    var maxDaysClosing = getDaysInMonth(y, m);
    var actualFechDay = Math.min(diaFechamento, maxDaysClosing);
    var fechIso = y + '-' + (m < 10 ? '0' + m : m) + '-' + (actualFechDay < 10 ? '0' + actualFechDay : actualFechDay);

    // Vencimento: no Brasil, se diaVencimento > diaFechamento, costuma ser no mesmo mês;
    // se diaVencimento <= diaFechamento, o vencimento é no mês seguinte.
    var dueY = y;
    var dueM = m;
    if (diaVencimento <= diaFechamento) {
      var nextYm = addMonthsToYm(mesCompetencia, 1);
      var nextParts = nextYm.split('-');
      dueY = parseInt(nextParts[0], 10);
      dueM = parseInt(nextParts[1], 10);
    }
    var maxDaysDue = getDaysInMonth(dueY, dueM);
    var actualDueDay = Math.min(diaVencimento, maxDaysDue);
    var dueIso = dueY + '-' + (dueM < 10 ? '0' + dueM : dueM) + '-' + (actualDueDay < 10 ? '0' + actualDueDay : actualDueDay);

    return {
      data_fechamento: fechIso,
      data_vencimento: dueIso
    };
  }

  /**
   * Determina a fatura inicial (YYYY-MM) onde uma compra realizada em certa data deve entrar.
   * Se a data da compra for maior que o dia de fechamento do cartão, entra na fatura do mês seguinte!
   */
  function computeInvoiceMonthForPurchase(purchaseDateIso, diaFechamento) {
    var cleanDate = String(purchaseDateIso || '').substring(0, 10);
    var parts = cleanDate.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);

    var ym = y + '-' + (m < 10 ? '0' + m : m);
    if (day > diaFechamento) {
      return addMonthsToYm(ym, 1);
    }
    return ym;
  }

  /**
   * Calcula o Melhor Dia de Compra de um cartão com base no fechamento.
   */
  function calculateBestPurchaseDay(diaFechamento, diaVencimento, refDateIso) {
    var now = refDateIso ? new Date(refDateIso) : new Date();
    var curDay = now.getUTCDate();
    var curMonth = now.getUTCMonth() + 1;
    var curYear = now.getUTCFullYear();

    var bestDay = diaFechamento + 1;
    var maxDays = getDaysInMonth(curYear, curMonth);
    if (bestDay > maxDays) bestDay = 1;

    // Diferença em dias estimada até o próximo pagamento
    var prazoDias = (diaVencimento > diaFechamento)
      ? (diaVencimento - diaFechamento + 30)
      : (30 - diaFechamento + diaVencimento + 30);
    if (prazoDias > 45) prazoDias = 40;

    return {
      dia: bestDay,
      descricao: 'Dia ' + bestDay + ' (logo após o fechamento da fatura)',
      prazo_estimado_dias: Math.min(45, Math.max(28, prazoDias))
    };
  }

  /**
   * Localiza ou cria a fatura mensal (FATURAS_CARTAO) para o cartão e mês informados.
   */
  function getOrCreateInvoice(user, cardId, mesCompetencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var card = SpreadsheetRepository.findById('CARTOES_CREDITO', cardId, user.grupo_id);
    if (!card) throw new Error('Cartão de crédito não encontrado.');

    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findOne('FATURAS_CARTAO', function (f) {
        return f.grupo_id === user.grupo_id && f.cartao_id === cardId && f.mes_competencia === mesCompetencia;
      });
      if (existing) return existing;

      var dates = computeClosingAndDueDates(mesCompetencia, card.dia_fechamento, card.dia_vencimento);
      var newInvoice = {
        id: SpreadsheetRepository.generateId('fat'),
        grupo_id: user.grupo_id,
        cartao_id: cardId,
        mes_competencia: mesCompetencia,
        data_fechamento: dates.data_fechamento,
        data_vencimento: dates.data_vencimento,
        situacao: 'ABERTA',
        valor_total_centavos: 0,
        valor_pago_centavos: 0,
        data_pagamento: '',
        lancamento_pagamento_id: '',
        observacoes: ''
      };
      return SpreadsheetRepository.insert('FATURAS_CARTAO', newInvoice);
    });
  }

  /**
   * Recalcula o valor total acumulado e a situação de uma fatura com base nas parcelas e ajustes.
   */
  function recalculateInvoiceTotals(grupoId, invoiceId) {
    var invoice = SpreadsheetRepository.findById('FATURAS_CARTAO', invoiceId, grupoId);
    if (!invoice) return null;

    var parcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', grupoId, function (p) {
      return p.fatura_id === invoiceId && p.situacao !== 'CANCELADA';
    });
    var ajustes = SpreadsheetRepository.findByGrupo('AJUSTES_CARTAO', grupoId, function (a) {
      return a.fatura_id === invoiceId;
    });

    var totalCentavos = 0;
    for (var i = 0; i < parcelas.length; i++) {
      totalCentavos += Number(parcelas[i].valor_centavos || 0);
    }
    for (var j = 0; j < ajustes.length; j++) {
      var val = Number(ajustes[j].valor_centavos || 0);
      if (ajustes[j].tipo === 'ESTORNO') {
        totalCentavos -= Math.abs(val);
      } else {
        totalCentavos += Math.abs(val);
      }
    }
    totalCentavos = Math.max(0, totalCentavos);

    var pago = Number(invoice.valor_pago_centavos || 0);
    var situacao = invoice.situacao;
    if (totalCentavos === 0 && pago === 0) {
      situacao = 'ABERTA';
    } else if (pago >= totalCentavos && totalCentavos > 0) {
      situacao = 'PAGA';
    } else if (pago > 0 && pago < totalCentavos) {
      situacao = 'PARCIAL';
    } else if (invoice.situacao === 'PAGA' && pago < totalCentavos) {
      situacao = 'ABERTA';
    }

    return SpreadsheetRepository.updateById('FATURAS_CARTAO', invoiceId, {
      valor_total_centavos: totalCentavos,
      situacao: situacao
    }, grupoId);
  }

  /**
   * Lista todos os cartões de crédito do grupo financeiro com limites e status em tempo real.
   */
  function listCards(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var cards = SpreadsheetRepository.findByGrupo('CARTOES_CREDITO', user.grupo_id, function (c) {
      return c.ativo !== false;
    });

    var allParcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (p) {
      return p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
    });
    var allInvoices = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id);
    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id);
    var accMap = {};
    for (var a = 0; a < accounts.length; a++) accMap[accounts[a].id] = accounts[a];

    var curYm = SpreadsheetRepository.todayIso().substring(0, 7);

    return cards.map(function (c) {
      var limitTotal = Number(c.limite_total_centavos || 0) + Number(c.limite_adicional_centavos || 0);

      // Limite comprometido: soma de parcelas ativas ainda não quitadas deste cartão
      var limitComprometido = 0;
      for (var p = 0; p < allParcelas.length; p++) {
        if (allParcelas[p].cartao_id === c.id) {
          limitComprometido += Number(allParcelas[p].valor_centavos || 0);
        }
      }
      var limitDisponivel = Math.max(0, limitTotal - limitComprometido);
      var pctComprometido = limitTotal > 0 ? Math.min(100, Math.round((limitComprometido / limitTotal) * 100)) : 0;

      // Fatura atual aberta
      var faturaAtual = null;
      for (var f = 0; f < allInvoices.length; f++) {
        if (allInvoices[f].cartao_id === c.id && allInvoices[f].mes_competencia === curYm) {
          faturaAtual = allInvoices[f];
          break;
        }
      }
      var faturaAtualCentavos = faturaAtual ? Math.max(0, Number(faturaAtual.valor_total_centavos || 0) - Number(faturaAtual.valor_pago_centavos || 0)) : 0;

      var bestDayInfo = calculateBestPurchaseDay(c.dia_fechamento, c.dia_vencimento);
      var dates = computeClosingAndDueDates(curYm, c.dia_fechamento, c.dia_vencimento);

      return {
        id: c.id,
        nome: c.nome,
        emissor: c.emissor,
        bandeira: c.bandeira,
        titular: c.titular || '',
        ultimos_digitos: c.ultimos_digitos || '',
        limite_total_centavos: limitTotal,
        limite_comprometido_centavos: limitComprometido,
        limite_disponivel_centavos: limitDisponivel,
        percentual_comprometido: pctComprometido,
        fatura_atual_centavos: faturaAtualCentavos,
        dia_fechamento: c.dia_fechamento,
        dia_vencimento: c.dia_vencimento,
        melhor_dia_compra: bestDayInfo.dia,
        melhor_dia_descricao: bestDayInfo.descricao,
        prazo_estimado_dias: bestDayInfo.prazo_estimado_dias,
        proximo_fechamento: dates.data_fechamento,
        proximo_vencimento: dates.data_vencimento,
        cor_cartao: c.cor_cartao || '#6366f1',
        conta_bancaria_id: c.conta_bancaria_id || '',
        conta_bancaria_nome: c.conta_bancaria_id && accMap[c.conta_bancaria_id] ? accMap[c.conta_bancaria_id].nome_identificacao : '',
        observacoes: c.observacoes || ''
      };
    });
  }

  /**
   * Cadastra um novo cartão de crédito no grupo financeiro.
   */
  function createCard(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    var nome = ValidationService.sanitizeText(p.nome, 100);
    if (!nome) throw new Error('Nome do cartão é obrigatório.');
    var emissor = ValidationService.sanitizeText(p.emissor, 100);
    if (!emissor) throw new Error('Instituição emissora do cartão é obrigatória.');
    var bandeira = normalizeBrand(p.bandeira);
    var titular = ValidationService.sanitizeText(p.titular || '', 100);
    var ultimosDigitos = String(p.ultimos_digitos || '').replace(/\D/g, '').substring(0, 4);

    var limiteTotal = ValidationService.validateCentavos(p.limite_total_centavos, 'limite_total_centavos', false);
    var limiteAdicional = p.limite_adicional_centavos !== undefined ? ValidationService.validateCentavos(p.limite_adicional_centavos, 'limite_adicional_centavos', false) : 0;

    var diaFech = parseInt(p.dia_fechamento, 10);
    if (isNaN(diaFech) || diaFech < 1 || diaFech > 31) throw new Error('Dia de fechamento deve ser entre 1 e 31.');
    var diaVenc = parseInt(p.dia_vencimento, 10);
    if (isNaN(diaVenc) || diaVenc < 1 || diaVenc > 31) throw new Error('Dia de vencimento deve ser entre 1 e 31.');

    var contaId = '';
    if (p.conta_bancaria_id) {
      var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', p.conta_bancaria_id, user.grupo_id);
      if (!acc) throw new Error('Conta bancária preferencial inválida.');
      contaId = acc.id;
    }

    var cor = (p.cor_cartao && /^#[0-9A-Fa-f]{6}$/.test(p.cor_cartao)) ? p.cor_cartao : '#6366f1';
    var obs = ValidationService.sanitizeText(p.observacoes || '', 500);

    return SpreadsheetRepository.withLock(function () {
      var cardRecord = {
        id: SpreadsheetRepository.generateId('crd'),
        grupo_id: user.grupo_id,
        nome: nome,
        emissor: emissor,
        bandeira: bandeira,
        titular: titular,
        ultimos_digitos: ultimosDigitos,
        limite_total_centavos: limiteTotal,
        limite_adicional_centavos: limiteAdicional,
        dia_fechamento: diaFech,
        dia_vencimento: diaVenc,
        conta_bancaria_id: contaId,
        cor_cartao: cor,
        ativo: true,
        observacoes: obs,
        criado_por: user.id
      };

      var inserted = SpreadsheetRepository.insert('CARTOES_CREDITO', cardRecord);

      // Assegura que a fatura do mês atual já é inicializada para este cartão
      var curYm = SpreadsheetRepository.todayIso().substring(0, 7);
      getOrCreateInvoice(user, inserted.id, curYm);

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'CARTAO_CREDITO_CRIADO',
        entidade: 'CARTOES_CREDITO',
        entidade_id: inserted.id,
        origem: 'WEB',
        detalhes: { nome: nome, emissor: emissor, limite_total_centavos: limiteTotal }
      });

      return inserted;
    });
  }

  /**
   * Atualiza dados cadastrais de um cartão de crédito.
   */
  function updateCard(user, cardId, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findById('CARTOES_CREDITO', cardId, user.grupo_id);
      if (!existing || existing.ativo === false) throw new Error('Cartão de crédito não encontrado.');

      var patch = {};
      if (p.nome !== undefined) {
        patch.nome = ValidationService.sanitizeText(p.nome, 100);
        if (!patch.nome) throw new Error('Nome do cartão não pode ficar vazio.');
      }
      if (p.emissor !== undefined) {
        patch.emissor = ValidationService.sanitizeText(p.emissor, 100);
        if (!patch.emissor) throw new Error('Emissor do cartão não pode ficar vazio.');
      }
      if (p.bandeira !== undefined) patch.bandeira = normalizeBrand(p.bandeira);
      if (p.titular !== undefined) patch.titular = ValidationService.sanitizeText(p.titular, 100);
      if (p.ultimos_digitos !== undefined) patch.ultimos_digitos = String(p.ultimos_digitos).replace(/\D/g, '').substring(0, 4);
      if (p.limite_total_centavos !== undefined) patch.limite_total_centavos = ValidationService.validateCentavos(p.limite_total_centavos, 'limite_total_centavos', false);
      if (p.limite_adicional_centavos !== undefined) patch.limite_adicional_centavos = ValidationService.validateCentavos(p.limite_adicional_centavos, 'limite_adicional_centavos', false);

      if (p.dia_fechamento !== undefined) {
        var df = parseInt(p.dia_fechamento, 10);
        if (isNaN(df) || df < 1 || df > 31) throw new Error('Dia de fechamento inválido.');
        patch.dia_fechamento = df;
      }
      if (p.dia_vencimento !== undefined) {
        var dv = parseInt(p.dia_vencimento, 10);
        if (isNaN(dv) || dv < 1 || dv > 31) throw new Error('Dia de vencimento inválido.');
        patch.dia_vencimento = dv;
      }
      if (p.conta_bancaria_id !== undefined) {
        if (p.conta_bancaria_id) {
          var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', p.conta_bancaria_id, user.grupo_id);
          if (!acc) throw new Error('Conta bancária inválida.');
          patch.conta_bancaria_id = acc.id;
        } else {
          patch.conta_bancaria_id = '';
        }
      }
      if (p.cor_cartao !== undefined && /^#[0-9A-Fa-f]{6}$/.test(p.cor_cartao)) patch.cor_cartao = p.cor_cartao;
      if (p.observacoes !== undefined) patch.observacoes = ValidationService.sanitizeText(p.observacoes, 500);

      var updated = SpreadsheetRepository.updateById('CARTOES_CREDITO', cardId, patch, user.grupo_id);

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'CARTAO_CREDITO_ATUALIZADO',
        entidade: 'CARTOES_CREDITO',
        entidade_id: cardId,
        origem: 'WEB',
        detalhes: patch
      });

      return updated;
    });
  }

  /**
   * Desativa (soft-delete) um cartão de crédito.
   */
  function deleteCard(user, cardId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findById('CARTOES_CREDITO', cardId, user.grupo_id);
      if (!existing || existing.ativo === false) throw new Error('Cartão de crédito não encontrado.');

      var updated = SpreadsheetRepository.updateById('CARTOES_CREDITO', cardId, { ativo: false }, user.grupo_id);

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'CARTAO_CREDITO_DESATIVADO',
        entidade: 'CARTOES_CREDITO',
        entidade_id: cardId,
        origem: 'WEB',
        detalhes: { nome: existing.nome }
      });

      return { ok: true, id: cardId };
    });
  }

  /**
   * Registra uma compra à vista ou parcelada (1x a 48x) no cartão de crédito.
   * Distribui matematicamente as parcelas pelas faturas futuras sem perda de centavos.
   */
  function createPurchase(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    var card = SpreadsheetRepository.findById('CARTOES_CREDITO', p.cartao_id, user.grupo_id);
    if (!card || card.ativo === false) throw new Error('Cartão de crédito inválido ou inativo.');

    var desc = ValidationService.sanitizeText(p.descricao, 150);
    if (!desc) throw new Error('Descrição da compra é obrigatória.');
    var valorTotal = ValidationService.validateCentavos(p.valor_total_centavos, 'valor_total_centavos', true);

    var parcelasTotal = parseInt(p.parcelas_total || 1, 10);
    if (isNaN(parcelasTotal) || parcelasTotal < 1 || parcelasTotal > 48) {
      throw new Error('Número de parcelas deve ser entre 1 e 48.');
    }

    var dataCompra = p.data_compra ? ValidationService.validateIsoDate(p.data_compra, 'data_compra', false) : SpreadsheetRepository.todayIso();

    var cat = SpreadsheetRepository.findById('CATEGORIAS', p.categoria_id, user.grupo_id);
    if (!cat) throw new Error('Categoria financeira inválida.');

    var subcatId = '';
    if (p.subcategoria_id) {
      var sub = SpreadsheetRepository.findById('SUBCATEGORIAS', p.subcategoria_id, user.grupo_id);
      if (sub && sub.categoria_id === cat.id) subcatId = sub.id;
    }

    var obs = ValidationService.sanitizeText(p.observacoes || '', 500);

    return SpreadsheetRepository.withLock(function () {
      // 1. Determina a fatura inicial da compra com base no dia de fechamento
      var startYm = computeInvoiceMonthForPurchase(dataCompra, card.dia_fechamento);
      var initialInvoice = getOrCreateInvoice(user, card.id, startYm);

      // 2. Insere a compra consolidada
      var purchaseId = SpreadsheetRepository.generateId('cmp');
      var purchaseRecord = {
        id: purchaseId,
        grupo_id: user.grupo_id,
        cartao_id: card.id,
        fatura_inicial_id: initialInvoice.id,
        data_compra: dataCompra,
        descricao: desc,
        categoria_id: cat.id,
        subcategoria_id: subcatId,
        valor_total_centavos: valorTotal,
        parcelas_total: parcelasTotal,
        situacao: 'ATIVA',
        observacoes: obs,
        criado_por: user.id
      };
      var insertedPurchase = SpreadsheetRepository.insert('COMPRAS_CARTAO', purchaseRecord);

      // 3. Distribuição exata das parcelas (centavos inteiros)
      var baseParcela = Math.floor(valorTotal / parcelasTotal);
      var resto = valorTotal % parcelasTotal;

      var touchedInvoiceIds = {};

      for (var i = 1; i <= parcelasTotal; i++) {
        var parcelaVal = (i === 1) ? (baseParcela + resto) : baseParcela;
        var parcelaYm = addMonthsToYm(startYm, i - 1);
        var targetInvoice = getOrCreateInvoice(user, card.id, parcelaYm);
        touchedInvoiceIds[targetInvoice.id] = true;

        var parcelaRecord = {
          id: SpreadsheetRepository.generateId('pcl'),
          grupo_id: user.grupo_id,
          compra_id: purchaseId,
          cartao_id: card.id,
          fatura_id: targetInvoice.id,
          numero_parcela: i,
          total_parcelas: parcelasTotal,
          valor_centavos: parcelaVal,
          mes_competencia: parcelaYm,
          situacao: 'PREVISTA',
          observacoes: ''
        };
        SpreadsheetRepository.insert('PARCELAS_CARTAO', parcelaRecord);
      }

      // 4. Recalcula os totais de cada fatura impactada
      for (var fId in touchedInvoiceIds) {
        if (Object.prototype.hasOwnProperty.call(touchedInvoiceIds, fId)) {
          recalculateInvoiceTotals(user.grupo_id, fId);
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'COMPRA_CARTAO_CRIADA',
        entidade: 'COMPRAS_CARTAO',
        entidade_id: purchaseId,
        origem: 'WEB',
        detalhes: {
          cartao: card.nome,
          descricao: desc,
          valor_total_centavos: valorTotal,
          parcelas_total: parcelasTotal,
          primeira_fatura: startYm
        }
      });

      return insertedPurchase;
    });
  }

  /**
   * Cancela uma compra no cartão e estorna todas as suas parcelas não pagas.
   */
  function cancelPurchase(user, purchaseId, motivo) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var purchase = SpreadsheetRepository.findById('COMPRAS_CARTAO', purchaseId, user.grupo_id);
      if (!purchase) throw new Error('Compra no cartão não encontrada.');
      if (purchase.situacao === 'CANCELADA') return purchase;

      var reason = ValidationService.sanitizeText(motivo || 'Cancelamento solicitado pelo usuário', 250);

      SpreadsheetRepository.updateById('COMPRAS_CARTAO', purchaseId, {
        situacao: 'CANCELADA',
        observacoes: (purchase.observacoes ? purchase.observacoes + ' | ' : '') + 'Cancelado: ' + reason
      }, user.grupo_id);

      var parcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (p) {
        return p.compra_id === purchaseId;
      });

      var touchedInvoices = {};
      for (var i = 0; i < parcelas.length; i++) {
        var p = parcelas[i];
        if (p.situacao !== 'PAGA') {
          SpreadsheetRepository.updateById('PARCELAS_CARTAO', p.id, { situacao: 'CANCELADA' }, user.grupo_id);
          touchedInvoices[p.fatura_id] = true;
        }
      }

      for (var invId in touchedInvoices) {
        if (Object.prototype.hasOwnProperty.call(touchedInvoices, invId)) {
          recalculateInvoiceTotals(user.grupo_id, invId);
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'COMPRA_CARTAO_CANCELADA',
        entidade: 'COMPRAS_CARTAO',
        entidade_id: purchaseId,
        origem: 'WEB',
        detalhes: { motivo: reason, descricao: purchase.descricao }
      });

      return { ok: true, id: purchaseId };
    });
  }

  /**
   * Lista as faturas de um cartão com histórico e projeções futuras.
   */
  function listInvoices(user, cardId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var invoices = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id, function (f) {
      return f.cartao_id === cardId;
    });

    invoices.sort(function (a, b) {
      return String(b.mes_competencia).localeCompare(String(a.mes_competencia));
    });

    var curYm = SpreadsheetRepository.todayIso().substring(0, 7);

    return invoices.map(function (inv) {
      var total = Number(inv.valor_total_centavos || 0);
      var pago = Number(inv.valor_pago_centavos || 0);
      var pendente = Math.max(0, total - pago);

      return {
        id: inv.id,
        cartao_id: inv.cartao_id,
        mes_competencia: inv.mes_competencia,
        data_fechamento: inv.data_fechamento,
        data_vencimento: inv.data_vencimento,
        situacao: inv.situacao,
        valor_total_centavos: total,
        valor_pago_centavos: pago,
        valor_pendente_centavos: pendente,
        is_atual: inv.mes_competencia === curYm,
        is_futura: inv.mes_competencia > curYm
      };
    });
  }

  /**
   * Retorna os detalhes completos de uma fatura específica (compras, parcelas, pagamentos e ajustes).
   */
  function getInvoiceDetails(user, invoiceId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var invoice = SpreadsheetRepository.findById('FATURAS_CARTAO', invoiceId, user.grupo_id);
    if (!invoice) throw new Error('Fatura não encontrada.');

    var card = SpreadsheetRepository.findById('CARTOES_CREDITO', invoice.cartao_id, user.grupo_id);
    var parcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (p) {
      return p.fatura_id === invoiceId && p.situacao !== 'CANCELADA';
    });

    var compras = SpreadsheetRepository.findByGrupo('COMPRAS_CARTAO', user.grupo_id);
    var cmpMap = {};
    for (var c = 0; c < compras.length; c++) cmpMap[compras[c].id] = compras[c];

    var categorias = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var k = 0; k < categorias.length; k++) catMap[categorias[k].id] = categorias[k];

    var itens = parcelas.map(function (par) {
      var cmp = cmpMap[par.compra_id];
      var cat = cmp ? catMap[cmp.categoria_id] : null;
      return {
        id: par.id,
        compra_id: par.compra_id,
        descricao: cmp ? cmp.descricao : 'Compra no cartão',
        categoria_nome: cat ? cat.nome : 'Geral',
        categoria_cor: cat ? cat.cor : '#6366f1',
        numero_parcela: par.numero_parcela,
        total_parcelas: par.total_parcelas,
        valor_centavos: par.valor_centavos,
        data_compra: cmp ? cmp.data_compra : '',
        situacao: par.situacao
      };
    });

    var pagamentos = SpreadsheetRepository.findByGrupo('PAGAMENTOS_FATURA', user.grupo_id, function (pg) {
      return pg.fatura_id === invoiceId;
    });

    var ajustes = SpreadsheetRepository.findByGrupo('AJUSTES_CARTAO', user.grupo_id, function (aj) {
      return aj.fatura_id === invoiceId;
    });

    var total = Number(invoice.valor_total_centavos || 0);
    var pago = Number(invoice.valor_pago_centavos || 0);

    return {
      invoice: {
        id: invoice.id,
        cartao_id: invoice.cartao_id,
        cartao_nome: card ? card.nome : 'Cartão',
        mes_competencia: invoice.mes_competencia,
        data_fechamento: invoice.data_fechamento,
        data_vencimento: invoice.data_vencimento,
        situacao: invoice.situacao,
        valor_total_centavos: total,
        valor_pago_centavos: pago,
        valor_pendente_centavos: Math.max(0, total - pago)
      },
      itens: itens,
      pagamentos: pagamentos,
      ajustes: ajustes
    };
  }

  /**
   * Quita total ou parcialmente uma fatura do cartão debitando uma única vez da conta bancária.
   * Cria o registro em LANCAMENTOS com natureza PAGAMENTO_FATURA, sem duplicar despesas.
   */
  function payInvoice(user, invoiceId, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    return SpreadsheetRepository.withLock(function () {
      var invoice = SpreadsheetRepository.findById('FATURAS_CARTAO', invoiceId, user.grupo_id);
      if (!invoice) throw new Error('Fatura não encontrada.');
      if (invoice.situacao === 'PAGA') throw new Error('Esta fatura já foi totalmente quitada.');

      var card = SpreadsheetRepository.findById('CARTOES_CREDITO', invoice.cartao_id, user.grupo_id);
      if (!card) throw new Error('Cartão de crédito vinculado não encontrado.');

      var contaId = p.conta_bancaria_id || card.conta_bancaria_id;
      if (!contaId) throw new Error('Informe a conta bancária para debitar o pagamento da fatura.');
      var bankAcc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', contaId, user.grupo_id);
      if (!bankAcc) throw new Error('Conta bancária selecionada não encontrada.');

      var totalFatura = Number(invoice.valor_total_centavos || 0);
      var pagoAnterior = Number(invoice.valor_pago_centavos || 0);
      var pendente = Math.max(0, totalFatura - pagoAnterior);

      var valorPagamento = p.valor_pago_centavos !== undefined
        ? ValidationService.validateCentavos(p.valor_pago_centavos, 'valor_pago_centavos', true)
        : pendente;

      if (valorPagamento <= 0) throw new Error('O valor de pagamento da fatura deve ser maior que zero.');

      var dataPagamento = p.data_pagamento
        ? ValidationService.validateIsoDate(p.data_pagamento, 'data_pagamento', false)
        : SpreadsheetRepository.todayIso();

      var obs = ValidationService.sanitizeText(p.observacoes || '', 250);

      // Localiza ou usa categoria padrão para pagamento de fatura
      var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
      var catPagamento = null;
      for (var c = 0; c < cats.length; c++) {
        var cNome = String(cats[c].nome || '').toLowerCase();
        if (cNome.indexOf('fatura') !== -1 || cNome.indexOf('cart') !== -1 || cNome.indexOf('financeir') !== -1) {
          catPagamento = cats[c];
          break;
        }
      }
      var catId = catPagamento ? catPagamento.id : (cats.length > 0 ? cats[0].id : '');

      // 1. Cria a saída de caixa efetiva em LANCAMENTOS (debita do saldo bancário uma única vez)
      var launchDesc = 'Pagamento de Fatura - ' + card.nome + ' (' + invoice.mes_competencia + ')';
      var launchRecord = {
        id: SpreadsheetRepository.generateId('lan'),
        grupo_id: user.grupo_id,
        tipo: 'SAIDA',
        natureza_operacao: 'PAGAMENTO_FATURA',
        descricao: launchDesc,
        valor_centavos: valorPagamento,
        data_lancamento: dataPagamento,
        data_competencia: dataPagamento,
        data_pagamento: dataPagamento,
        conta_bancaria_id: bankAcc.id,
        categoria_id: catId,
        forma_pagamento: 'OUTRO',
        situacao: 'CONFIRMADO',
        origem: 'MANUAL',
        observacoes: 'Quitação de fatura do cartão ' + card.nome + (obs ? ' | ' + obs : ''),
        usuario_responsavel_id: user.id
      };
      var insertedLaunch = SpreadsheetRepository.insert('LANCAMENTOS', launchRecord);

      // 2. Registra o pagamento na tabela PAGAMENTOS_FATURA
      var paymentId = SpreadsheetRepository.generateId('pgf');
      var paymentRecord = {
        id: paymentId,
        grupo_id: user.grupo_id,
        fatura_id: invoiceId,
        cartao_id: card.id,
        conta_bancaria_id: bankAcc.id,
        lancamento_id: insertedLaunch.id,
        data_pagamento: dataPagamento,
        valor_pago_centavos: valorPagamento,
        comprovante_url: '',
        observacoes: obs,
        criado_por: user.id
      };
      SpreadsheetRepository.insert('PAGAMENTOS_FATURA', paymentRecord);

      // 3. Atualiza a fatura
      var novoPagoTotal = pagoAnterior + valorPagamento;
      var novaSituacao = (novoPagoTotal >= totalFatura) ? 'PAGA' : 'PARCIAL';

      SpreadsheetRepository.updateById('FATURAS_CARTAO', invoiceId, {
        valor_pago_centavos: novoPagoTotal,
        situacao: novaSituacao,
        data_pagamento: dataPagamento,
        lancamento_pagamento_id: insertedLaunch.id
      }, user.grupo_id);

      // 4. Se a fatura foi totalmente paga, marca as parcelas como PAGA
      if (novaSituacao === 'PAGA') {
        var parcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (par) {
          return par.fatura_id === invoiceId && par.situacao !== 'CANCELADA';
        });
        for (var i = 0; i < parcelas.length; i++) {
          SpreadsheetRepository.updateById('PARCELAS_CARTAO', parcelas[i].id, {
            situacao: 'PAGA'
          }, user.grupo_id);
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'FATURA_CARTAO_PAGA',
        entidade: 'FATURAS_CARTAO',
        entidade_id: invoiceId,
        origem: 'WEB',
        detalhes: {
          cartao: card.nome,
          valor_pago_centavos: valorPagamento,
          conta_bancaria: bankAcc.nome_identificacao,
          lancamento_id: insertedLaunch.id,
          situacao_final: novaSituacao
        }
      });

      return {
        ok: true,
        fatura_id: invoiceId,
        valor_pago_centavos: valorPagamento,
        situacao: novaSituacao,
        lancamento_id: insertedLaunch.id
      };
    });
  }

  /**
   * Adiciona um ajuste à fatura (estorno, anuidade, juros, multa).
   */
  function addAdjustment(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    var invoice = SpreadsheetRepository.findById('FATURAS_CARTAO', p.fatura_id, user.grupo_id);
    if (!invoice) throw new Error('Fatura não encontrada.');

    var tipo = String(p.tipo || 'AJUSTE').toUpperCase().trim();
    if (ADJUSTMENT_TYPES.indexOf(tipo) === -1) throw new Error('Tipo de ajuste inválido.');

    var desc = ValidationService.sanitizeText(p.descricao, 150);
    if (!desc) throw new Error('Descrição do ajuste é obrigatória.');
    var val = ValidationService.validateCentavos(p.valor_centavos, 'valor_centavos', true);
    var dataAjuste = p.data_ajuste ? ValidationService.validateIsoDate(p.data_ajuste, 'data_ajuste', false) : SpreadsheetRepository.todayIso();

    return SpreadsheetRepository.withLock(function () {
      var adjRecord = {
        id: SpreadsheetRepository.generateId('adj'),
        grupo_id: user.grupo_id,
        fatura_id: invoice.id,
        cartao_id: invoice.cartao_id,
        tipo: tipo,
        descricao: desc,
        valor_centavos: val,
        data_ajuste: dataAjuste,
        observacoes: ValidationService.sanitizeText(p.observacoes || '', 250),
        criado_por: user.id
      };
      var inserted = SpreadsheetRepository.insert('AJUSTES_CARTAO', adjRecord);

      recalculateInvoiceTotals(user.grupo_id, invoice.id);

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'AJUSTE_CARTAO_ADICIONADO',
        entidade: 'AJUSTES_CARTAO',
        entidade_id: inserted.id,
        origem: 'WEB',
        detalhes: { tipo: tipo, valor_centavos: val, descricao: desc }
      });

      return inserted;
    });
  }

  /**
   * Simulador de compras no cartão de crédito:
   * Calcula o valor de cada parcela, meses impactados, novo comprometimento de limite
   * e sustentabilidade orçamentária antes de efetuar a compra.
   */
  function simulatePurchase(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};

    var card = SpreadsheetRepository.findById('CARTOES_CREDITO', p.cartao_id, user.grupo_id);
    if (!card || card.ativo === false) throw new Error('Cartão de crédito não encontrado.');

    var valorTotal = ValidationService.validateCentavos(p.valor_total_centavos, 'valor_total_centavos', true);
    var parcelasTotal = Math.min(48, Math.max(1, parseInt(p.parcelas_total || 1, 10)));
    var dataCompra = p.data_compra ? ValidationService.validateIsoDate(p.data_compra, 'data_compra', false) : SpreadsheetRepository.todayIso();

    var startYm = computeInvoiceMonthForPurchase(dataCompra, card.dia_fechamento);
    var baseParcela = Math.floor(valorTotal / parcelasTotal);
    var resto = valorTotal % parcelasTotal;

    var schedule = [];
    for (var i = 1; i <= parcelasTotal; i++) {
      var parVal = (i === 1) ? (baseParcela + resto) : baseParcela;
      var parYm = addMonthsToYm(startYm, i - 1);
      var dates = computeClosingAndDueDates(parYm, card.dia_fechamento, card.dia_vencimento);
      schedule.push({
        numero_parcela: i,
        mes_competencia: parYm,
        valor_centavos: parVal,
        data_vencimento: dates.data_vencimento
      });
    }

    var limitTotal = Number(card.limite_total_centavos || 0) + Number(card.limite_adicional_centavos || 0);
    var allParcelas = SpreadsheetRepository.findByGrupo('PARCELAS_CARTAO', user.grupo_id, function (par) {
      return par.cartao_id === card.id && par.situacao !== 'PAGA' && par.situacao !== 'CANCELADA';
    });
    var limitComprometidoAtual = 0;
    for (var j = 0; j < allParcelas.length; j++) {
      limitComprometidoAtual += Number(allParcelas[j].valor_centavos || 0);
    }
    var limitDisponivelAtual = Math.max(0, limitTotal - limitComprometidoAtual);
    var cabeNoLimite = (limitDisponivelAtual >= valorTotal);

    var bestDayInfo = calculateBestPurchaseDay(card.dia_fechamento, card.dia_vencimento, dataCompra);

    return {
      cartao_nome: card.nome,
      valor_total_centavos: valorTotal,
      parcelas_total: parcelasTotal,
      valor_parcela_base_centavos: baseParcela,
      primeira_fatura_mes: startYm,
      ultima_fatura_mes: schedule[schedule.length - 1].mes_competencia,
      limite_total_centavos: limitTotal,
      limite_disponivel_atual_centavos: limitDisponivelAtual,
      limite_disponivel_pos_compra_centavos: Math.max(0, limitDisponivelAtual - valorTotal),
      cabe_no_limite: cabeNoLimite,
      melhor_dia_compra: bestDayInfo.dia,
      melhor_dia_descricao: bestDayInfo.descricao,
      cronograma: schedule
    };
  }

  return {
    CARD_BRANDS: CARD_BRANDS,
    computeClosingAndDueDates: computeClosingAndDueDates,
    computeInvoiceMonthForPurchase: computeInvoiceMonthForPurchase,
    calculateBestPurchaseDay: calculateBestPurchaseDay,
    getOrCreateInvoice: getOrCreateInvoice,
    recalculateInvoiceTotals: recalculateInvoiceTotals,
    listCards: listCards,
    createCard: createCard,
    updateCard: updateCard,
    deleteCard: deleteCard,
    createPurchase: createPurchase,
    cancelPurchase: cancelPurchase,
    listInvoices: listInvoices,
    getInvoiceDetails: getInvoiceDetails,
    payInvoice: payInvoice,
    addAdjustment: addAdjustment,
    simulatePurchase: simulatePurchase
  };
})();
