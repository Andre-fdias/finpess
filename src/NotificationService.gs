/**
 * @file NotificationService.gs
 * @description Central Inteligente de Notificações, Alertas e Comunicação Multicanal
 * (Central no Header, Pop-up de Inicialização pós-login, Lembretes por E-mail MailApp,
 * Adiamento Inteligente/Snooze, Alertas de Investimentos com dados reais e Oráculo IA).
 */

var NotificationService = (function () {
  var MAX_ATTEMPTS = 3;

  var NOTIFICATION_TYPES = [
    'VENCIMENTO_PROXIMO',
    'CONTA_VENCIDA',
    'CONTA_PAGA',
    'RESUMO_MENSAL',
    'ORCAMENTO_PROXIMO_MES',
    'INVESTIMENTO_ALERTA',
    'DIVIDENDO_ANUNCIADO',
    'ORACULO_PARECER',
    'FALHA_SISTEMA',
    'ALERTA_SEGURANCA',
    'INCIDENTE'
  ];

  var PRIORITIES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'];

  var DEFAULT_PREFERENCES = {
    email_ativo: true,
    popup_ativo: true,
    central_ativo: true,
    antecedencia_dias: 3,
    alerta_atraso_dias: 1,
    investimentos_ativo: true,
    oraculo_ativo: true,
    horario_silencioso_inicio: '22:00',
    horario_silencioso_fim: '08:00'
  };

  /**
   * Obtém preferências de notificação do usuário persistidas em CONFIGURACOES.
   */
  function getUserPreferences(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var key = 'notif_prefs_' + user.id;
    var cfg = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.grupo_id === user.grupo_id && c.chave === key;
    });

    if (!cfg || !cfg.valor) {
      return Object.assign({}, DEFAULT_PREFERENCES);
    }

    try {
      var parsed = JSON.parse(cfg.valor);
      return Object.assign({}, DEFAULT_PREFERENCES, parsed);
    } catch (e) {
      return Object.assign({}, DEFAULT_PREFERENCES);
    }
  }

  /**
   * Salva preferências de notificação do usuário.
   */
  function saveUserPreferences(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};
    var current = getUserPreferences(user);

    var updated = {
      email_ativo: p.email_ativo !== undefined ? Boolean(p.email_ativo) : current.email_ativo,
      popup_ativo: p.popup_ativo !== undefined ? Boolean(p.popup_ativo) : current.popup_ativo,
      central_ativo: p.central_ativo !== undefined ? Boolean(p.central_ativo) : current.central_ativo,
      antecedencia_dias: p.antecedencia_dias !== undefined ? Math.max(1, Math.min(30, parseInt(p.antecedencia_dias, 10) || 3)) : current.antecedencia_dias,
      alerta_atraso_dias: p.alerta_atraso_dias !== undefined ? Math.max(1, Math.min(15, parseInt(p.alerta_atraso_dias, 10) || 1)) : current.alerta_atraso_dias,
      investimentos_ativo: p.investimentos_ativo !== undefined ? Boolean(p.investimentos_ativo) : current.investimentos_ativo,
      oraculo_ativo: p.oraculo_ativo !== undefined ? Boolean(p.oraculo_ativo) : current.oraculo_ativo,
      horario_silencioso_inicio: p.horario_silencioso_inicio || current.horario_silencioso_inicio,
      horario_silencioso_fim: p.horario_silencioso_fim || current.horario_silencioso_fim
    };

    var key = 'notif_prefs_' + user.id;
    var existing = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.grupo_id === user.grupo_id && c.chave === key;
    });

    if (existing) {
      SpreadsheetRepository.updateById('CONFIGURACOES', existing.id, {
        valor: JSON.stringify(updated),
        atualizado_por: user.id
      }, user.grupo_id);
    } else {
      SpreadsheetRepository.insert('CONFIGURACOES', {
        id: SpreadsheetRepository.generateId('cfg'),
        grupo_id: user.grupo_id,
        chave: key,
        valor: JSON.stringify(updated),
        descricao: 'Preferências de notificações de ' + user.email,
        atualizado_por: user.id
      });
    }

    return updated;
  }

  /**
   * Enfileira ou cadastra uma notificação de forma rigorosamente idempotente.
   */
  function enqueueNotification(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || (!payload.tipo_notificacao && !payload.tipo)) {
      throw new Error('Tipo de notificação é obrigatório.');
    }

    var tipoRaw = payload.tipo_notificacao || payload.tipo;
    var tipo = ValidationService.validateEnum(tipoRaw, NOTIFICATION_TYPES, 'tipo_notificacao');

    var titulo = ValidationService.sanitizeText(payload.titulo || payload.assunto || 'Alerta Finanças Inteligentes', 180);
    var mensagem = ValidationService.sanitizeText(payload.mensagem || payload.resumo_corpo || '', 1000);
    var prioridade = payload.prioridade ? ValidationService.validateEnum(payload.prioridade, PRIORITIES, 'prioridade') : 'MEDIA';
    var categoria = ValidationService.sanitizeText(payload.categoria || 'FINANCEIRO', 40);
    var canais = ValidationService.sanitizeText(payload.canais || 'CENTRAL,POPUP,EMAIL', 60);
    var refModulo = ValidationService.sanitizeText(payload.referencia_modulo || 'launches', 40);
    var refId = ValidationService.sanitizeText(payload.referencia_id || '', 80);

    var idempKey = ValidationService.sanitizeText(
      payload.idempotency_key || ('notif_' + tipo + '_' + (refId || '') + '_' + SpreadsheetRepository.todayIso()),
      150
    );

    // Idempotência: se já existir qualquer registro ativo, lido, adiado ou em fila com esta chave, não duplica
    var existing = SpreadsheetRepository.findOne('NOTIFICACOES', function (n) {
      return n.grupo_id === user.grupo_id && n.idempotency_key === idempKey && n.status !== 'CANCELADO' && n.status !== 'EXCLUIDO';
    });
    if (existing) {
      return existing;
    }

    var now = SpreadsheetRepository.nowIso();
    return SpreadsheetRepository.insert('NOTIFICACOES', {
      id: SpreadsheetRepository.generateId('not'),
      grupo_id: user.grupo_id,
      usuario_id: payload.usuario_id || user.id,
      destinatario_email: AuthService.normalizeEmail(payload.destinatario_email || user.email),
      tipo_notificacao: tipo,
      referencia_id: refId,
      referencia_modulo: refModulo,
      idempotency_key: idempKey,
      assunto: titulo,
      titulo: titulo,
      resumo_corpo: mensagem,
      mensagem: mensagem,
      prioridade: prioridade,
      categoria: categoria,
      canais: canais,
      status: payload.status || 'FILA',
      status_leitura: false,
      data_leitura: '',
      adiado_ate: '',
      contagem_adiamentos: 0,
      tentativas: 0,
      ultimo_erro: '',
      agendado_para: payload.agendado_para || SpreadsheetRepository.todayIso(),
      enviado_em: '',
      criado_em: now
    });
  }

  /**
   * Retorna resumo e lista de notificações para a Central de Notificações no Header.
   */
  function getCenterOverview(user, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var nowIso = SpreadsheetRepository.nowIso();

    var all = SpreadsheetRepository.findByGrupo('NOTIFICACOES', user.grupo_id, function (n) {
      return n.status !== 'CANCELADO' && n.status !== 'EXCLUIDO' && n.status !== 'ARQUIVADO';
    });

    var activeItems = [];
    var unreadCount = 0;
    var hasCritical = false;

    for (var i = 0; i < all.length; i++) {
      var item = all[i];

      // Adiamento inteligente: se estiver adiado para o futuro, oculta da lista ativa normal
      var isSnoozed = false;
      if (item.adiado_ate && item.adiado_ate > nowIso) {
        isSnoozed = true;
      } else if (item.status === 'ADIADO' && item.adiado_ate && item.adiado_ate <= nowIso) {
        // Despertou do adiamento: volta a ser ativo
        item.status = 'FILA';
        SpreadsheetRepository.updateById('NOTIFICACOES', item.id, { status: 'FILA' }, user.grupo_id);
      }

      if (isSnoozed && !opts.includeSnoozed) {
        continue;
      }

      var isUnread = !item.status_leitura;
      if (isUnread && !isSnoozed) {
        unreadCount++;
        if (item.prioridade === 'CRITICA') {
          hasCritical = true;
        }
      }

      // Filtro por categoria
      if (opts.categoria && opts.categoria !== 'TODAS') {
        var catUpper = String(opts.categoria).toUpperCase();
        var itemCat = String(item.categoria || '').toUpperCase();
        if (itemCat !== catUpper && String(item.tipo_notificacao || '').indexOf(catUpper) === -1) {
          continue;
        }
      }

      // Filtro por não lidas
      if (opts.unreadOnly && !isUnread) {
        continue;
      }

      activeItems.push({
        id: item.id,
        tipo: item.tipo_notificacao,
        titulo: item.titulo || item.assunto,
        mensagem: item.mensagem || item.resumo_corpo,
        prioridade: item.prioridade || 'MEDIA',
        categoria: item.categoria || 'FINANCEIRO',
        referencia_modulo: item.referencia_modulo || 'launches',
        referencia_id: item.referencia_id || '',
        status_leitura: Boolean(item.status_leitura),
        data_leitura: item.data_leitura || '',
        adiado_ate: item.adiado_ate || '',
        contagem_adiamentos: Number(item.contagem_adiamentos || 0),
        criado_em: item.criado_em || item.agendado_para,
        status: item.status
      });
    }

    // Ordenação: não lidas e prioridades mais altas primeiro, seguidas pelas mais recentes
    var priorityOrder = { 'CRITICA': 4, 'ALTA': 3, 'MEDIA': 2, 'BAIXA': 1 };
    activeItems.sort(function (a, b) {
      if (a.status_leitura !== b.status_leitura) {
        return a.status_leitura ? 1 : -1;
      }
      var pDiff = (priorityOrder[b.prioridade] || 0) - (priorityOrder[a.prioridade] || 0);
      if (pDiff !== 0) return pDiff;
      return String(b.criado_em).localeCompare(String(a.criado_em));
    });

    var badgeText = '';
    if (unreadCount > 99) {
      badgeText = '99+';
    } else if (unreadCount > 0) {
      badgeText = String(unreadCount);
    }

    return {
      total: activeItems.length,
      nao_lidas: unreadCount,
      unreadCount: unreadCount,
      badge: badgeText,
      badge_text: badgeText,
      hasCritical: hasCritical,
      has_critical: hasCritical,
      itens: activeItems
    };
  }

  /**
   * Retorna o resumo para o Pop-up inteligente de inicialização pós-autenticação.
   * Respeita sessionStorage e IDs já apresentados, permitindo apenas novas ou críticas.
   */
  function getInitialPopup(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = payload || {};
    var presentedIds = Array.isArray(p.presentedIds) ? p.presentedIds : [];

    // Executa varreduras de vencimentos e investimentos de forma silenciosa
    scanAndEnqueueDueAlerts(user);
    scanInvestmentAndOracleAlerts(user);

    var overview = getCenterOverview(user, { includeSnoozed: false });
    var popupItems = [];

    for (var i = 0; i < overview.itens.length; i++) {
      var item = overview.itens[i];
      // Só entra no pop-up itens não lidos e não adiados
      if (item.status_leitura) continue;

      var alreadyPresented = presentedIds.indexOf(item.id) !== -1;
      // Se já foi apresentado nesta sessão, só reapresenta se for CRÍTICA
      if (alreadyPresented && item.prioridade !== 'CRITICA') {
        continue;
      }

      popupItems.push(item);
    }

    // Agrupa por grupos relevantes para visualização clara no pop-up
    var vencidas = [];
    var vencemHoje = [];
    var venceramProximos = [];
    var mercadoOraculo = [];
    var outros = [];

    var today = SpreadsheetRepository.todayIso();

    for (var j = 0; j < popupItems.length; j++) {
      var it = popupItems[j];
      if (it.tipo === 'CONTA_VENCIDA') {
        vencidas.push(it);
      } else if (it.tipo === 'VENCIMENTO_PROXIMO') {
        if (it.mensagem.indexOf(ValidationService.formatDateBr(today)) !== -1 || it.titulo.indexOf('hoje') !== -1) {
          vencemHoje.push(it);
        } else {
          venceramProximos.push(it);
        }
      } else if (it.categoria === 'INVESTIMENTOS' || it.categoria === 'ORACULO') {
        mercadoOraculo.push(it);
      } else {
        outros.push(it);
      }
    }

    return {
      exibir: popupItems.length > 0,
      deve_exibir: popupItems.length > 0,
      total_relevantes: popupItems.length,
      total_pendentes: popupItems.length,
      grupos: {
        vencidas: vencidas,
        vencem_hoje: vencemHoje,
        proximos_dias: venceramProximos,
        mercado_oraculo: mercadoOraculo,
        outros: outros
      },
      vencidas: vencidas,
      vencem_hoje: vencemHoje,
      proximos_dias: venceramProximos,
      mercado_oraculo: mercadoOraculo,
      outros: outros,
      itens: popupItems,
      todos_itens: popupItems
    };
  }

  /**
   * Marca uma notificação individual como lida ou não lida.
   */
  function setReadStatus(user, notificationId, isRead) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var item = SpreadsheetRepository.findById('NOTIFICACOES', notificationId, user.grupo_id);
    if (!item) throw new Error('Notificação não encontrada.');

    var now = SpreadsheetRepository.nowIso();
    var patch = {
      status_leitura: Boolean(isRead),
      data_leitura: isRead ? now : '',
      status: isRead ? 'LIDO' : 'FILA'
    };

    var updated = SpreadsheetRepository.updateById('NOTIFICACOES', item.id, patch, user.grupo_id);
    return { ok: true, id: item.id, status_leitura: patch.status_leitura };
  }

  /**
   * Marca todas as notificações ativas do usuário como lidas.
   */
  function markAllAsRead(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var unread = SpreadsheetRepository.findByGrupo('NOTIFICACOES', user.grupo_id, function (n) {
      return !n.status_leitura && n.status !== 'CANCELADO' && n.status !== 'EXCLUIDO';
    });

    var now = SpreadsheetRepository.nowIso();
    for (var i = 0; i < unread.length; i++) {
      SpreadsheetRepository.updateById('NOTIFICACOES', unread[i].id, {
        status_leitura: true,
        data_leitura: now,
        status: 'LIDO'
      }, user.grupo_id);
    }

    return { ok: true, quantidade_atualizada: unread.length };
  }

  /**
   * Adia (snooze) uma notificação sem alterar o vencimento real do lançamento.
   */
  function snoozeNotification(user, notificationId, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var item = SpreadsheetRepository.findById('NOTIFICACOES', notificationId, user.grupo_id);
    if (!item) throw new Error('Notificação não encontrada.');

    // Notificações críticas de segurança ou falha sistêmica limitam adiamentos
    var contagem = Number(item.contagem_adiamentos || 0);
    if (item.prioridade === 'CRITICA' && contagem >= 3) {
      throw new Error('Notificações de segurança e alertas críticos não podem ser adiados mais de 3 vezes.');
    }

    var opts = options || {};
    var now = new Date();
    var targetDate = new Date();

    if (opts.hours) {
      targetDate = new Date(now.getTime() + (parseInt(opts.hours, 10) * 3600000));
    } else if (opts.days) {
      targetDate = new Date(now.getTime() + (parseInt(opts.days, 10) * 86400000));
    } else if (opts.customDate) {
      targetDate = new Date(opts.customDate);
      if (isNaN(targetDate.getTime()) || targetDate.getTime() <= now.getTime()) {
        throw new Error('Data de adiamento deve ser no futuro.');
      }
    } else {
      // Padrão: 1 dia (amanhã)
      targetDate = new Date(now.getTime() + 86400000);
    }

    var targetIso = targetDate.toISOString();
    var updated = SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
      status: 'ADIADO',
      adiado_ate: targetIso,
      contagem_adiamentos: contagem + 1
    }, user.grupo_id);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'NOTIFICACAO_ADIADA',
      entidade: 'NOTIFICACOES',
      entidade_id: item.id,
      origem: 'WEB',
      detalhes: { adiado_ate: targetIso, tipo: item.tipo_notificacao }
    });

    return { ok: true, id: item.id, adiado_ate: targetIso };
  }

  /**
   * Remove uma notificação individual da central.
   */
  function deleteNotification(user, notificationId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var item = SpreadsheetRepository.findById('NOTIFICACOES', notificationId, user.grupo_id);
    if (!item) throw new Error('Notificação não encontrada.');

    SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
      status: 'EXCLUIDO'
    }, user.grupo_id);

    return { ok: true, id: item.id };
  }

  /**
   * Limpa todas as notificações que já foram lidas (arquiva sem excluir dados financeiros).
   */
  function clearReadNotifications(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var readItems = SpreadsheetRepository.findByGrupo('NOTIFICACOES', user.grupo_id, function (n) {
      return Boolean(n.status_leitura) && n.status !== 'EXCLUIDO' && n.status !== 'CANCELADO';
    });

    for (var i = 0; i < readItems.length; i++) {
      SpreadsheetRepository.updateById('NOTIFICACOES', readItems[i].id, {
        status: 'EXCLUIDO'
      }, user.grupo_id);
    }

    return { ok: true, quantidade_limpa: readItems.length };
  }

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

  /**
   * Gera alertas automáticos de contas vencidas e próximas do vencimento.
   */
  function scanAndEnqueueDueAlerts(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var today = SpreadsheetRepository.todayIso();
    var prefs = getUserPreferences(user);
    var leadDays = prefs.antecedencia_dias || 3;

    var parts = today.split('-');
    var todayUtc = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    var limitUtc = new Date(todayUtc.getTime() + leadDays * 86400000);
    var limitIso = limitUtc.toISOString().substring(0, 10);

    var unpaidLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.tipo === 'SAIDA' && (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE');
    });

    var enqueued = [];
    for (var i = 0; i < unpaidLaunches.length; i++) {
      var l = unpaidLaunches[i];
      var valorFmt = formatCurrency(l.valor_centavos);
      var vencFmt = ValidationService.formatDateBr(l.data_lancamento);

      if (l.data_lancamento < today) {
        enqueued.push(
          enqueueNotification(user, {
            tipo_notificacao: 'CONTA_VENCIDA',
            destinatario_email: user.email,
            referencia_id: l.id,
            referencia_modulo: 'launches',
            prioridade: 'ALTA',
            categoria: 'VENCIMENTOS',
            idempotency_key: 'notif_vencida_' + l.id + '_' + today,
            assunto: '🔔 [Conta Vencida] ' + l.descricao + ' (' + valorFmt + ')',
            titulo: 'Conta Vencida: ' + l.descricao,
            resumo_corpo: 'O compromisso "' + l.descricao + '" no valor de ' + valorFmt + ' com vencimento em ' + vencFmt + ' encontra-se pendente de confirmação.',
            mensagem: 'O compromisso no valor de ' + valorFmt + ' venceu em ' + vencFmt + '. Clique para confirmar ou atualizar.'
          })
        );
      } else if (l.data_lancamento <= limitIso) {
        var isToday = (l.data_lancamento === today);
        var prio = isToday ? 'ALTA' : 'MEDIA';
        var txtVenc = isToday ? 'vence HOJE' : ('vence em ' + vencFmt);

        enqueued.push(
          enqueueNotification(user, {
            tipo_notificacao: 'VENCIMENTO_PROXIMO',
            destinatario_email: user.email,
            referencia_id: l.id,
            referencia_modulo: 'launches',
            prioridade: prio,
            categoria: 'VENCIMENTOS',
            idempotency_key: 'notif_proxima_' + l.id + '_' + l.data_lancamento,
            assunto: '🔔 [Vencimento] ' + l.descricao + ' ' + txtVenc + ' (' + valorFmt + ')',
            titulo: 'Conta a Vencer: ' + l.descricao,
            resumo_corpo: 'Lembrete de vencimento: O compromisso "' + l.descricao + '" (' + valorFmt + ') ' + txtVenc + '.',
            mensagem: 'O compromisso de ' + valorFmt + ' ' + txtVenc + '. Verifique a provisão de saldo na sua conta.'
          })
        );
      }
    }

    return {
      data_verificacao: today,
      antecedencia_dias: leadDays,
      notificacoes_enfileiradas: enqueued.length,
      itens: enqueued
    };
  }

  /**
   * Gera alertas de mercado, dividendos e investimentos baseados estritamente em dados reais.
   * Não inventa preços ou cotações. Utiliza InvestmentService e MarketDataService.
   */
  function scanInvestmentAndOracleAlerts(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var prefs = getUserPreferences(user);
    if (!prefs.investimentos_ativo) return [];

    var today = SpreadsheetRepository.todayIso();
    var enqueued = [];

    try {
      var summary = InvestmentService.getPortfolioSummary(user);
      var ativos = summary.ativos || [];

      // 1. Alertas de variação patrimonial relevante nos ativos da carteira (> 5% de valorização ou desvalorização)
      for (var i = 0; i < ativos.length; i++) {
        var a = ativos[i];
        if (a.variacao_percentual_bps && Math.abs(a.variacao_percentual_bps) >= 500) {
          var isPos = a.variacao_percentual_bps > 0;
          var varPctStr = (a.variacao_percentual_bps / 100).toFixed(2) + '%';
          var prio = isPos ? 'BAIXA' : 'MEDIA';
          var idemp = 'inv_var_' + a.id + '_' + today;

          enqueued.push(
            enqueueNotification(user, {
              tipo_notificacao: 'INVESTIMENTO_ALERTA',
              destinatario_email: user.email,
              referencia_id: a.id,
              referencia_modulo: 'investments',
              prioridade: prio,
              categoria: 'INVESTIMENTOS',
              idempotency_key: idemp,
              titulo: (isPos ? '📈 Ativo em Alta: ' : '📉 Ativo em Queda: ') + a.ticker,
              mensagem: 'O ativo ' + a.ticker + ' (' + a.nome + ') apresenta variação calculada de ' + (isPos ? '+' : '') + varPctStr + ' em relação ao custo de aquisição.',
              assunto: '[Investimentos] Variação relevante em ' + a.ticker
            })
          );
        }
      }

      // 2. Alertas de concentração de carteira (> 35% do patrimônio investido em um único ativo)
      var totalMercado = summary.total_valor_mercado_informado_centavos || 0;
      if (totalMercado > 0 && ativos.length > 1) {
        for (var j = 0; j < ativos.length; j++) {
          var atv = ativos[j];
          var pesoBps = Math.round(((atv.valor_mercado_informado_centavos || atv.total_aplicado_centavos || 0) / totalMercado) * 10000);
          if (pesoBps >= 3500) {
            var pesoPct = (pesoBps / 100).toFixed(1) + '%';
            var idempConc = 'inv_conc_' + atv.id + '_' + today.substring(0, 7); // 1 vez por mês
            enqueued.push(
              enqueueNotification(user, {
                tipo_notificacao: 'ORACULO_PARECER',
                destinatario_email: user.email,
                referencia_id: atv.id,
                referencia_modulo: 'investments',
                prioridade: 'MEDIA',
                categoria: 'ORACULO',
                idempotency_key: idempConc,
                titulo: '💡 Concentração Patrimonial em ' + atv.ticker,
                mensagem: 'O Oráculo IA identificou que o ativo ' + atv.ticker + ' representa ' + pesoPct + ' de todo o seu patrimônio investido. Considere avaliar diversificação.',
                assunto: '[Oráculo IA] Alerta de concentração patrimonial'
              })
            );
          }
        }
      }

      // 3. Proventos e Dividendos projetados
      var divProjs = InvestmentService.getDividendProjections(user);
      if (divProjs && divProjs.proximos_pagamentos && divProjs.proximos_pagamentos.length > 0) {
        var prox = divProjs.proximos_pagamentos[0];
        var idempDiv = 'inv_div_' + (prox.ticker || 'geral') + '_' + today.substring(0, 7);
        var valFmt = formatCurrency(prox.valor_estimado_centavos);
        enqueued.push(
          enqueueNotification(user, {
            tipo_notificacao: 'DIVIDENDO_ANUNCIADO',
            destinatario_email: user.email,
            referencia_id: prox.id || '',
            referencia_modulo: 'investments',
            prioridade: 'BAIXA',
            categoria: 'INVESTIMENTOS',
            idempotency_key: idempDiv,
            titulo: '💰 Dividendos Previstos: ' + (prox.ticker || 'Carteira'),
            mensagem: 'Estimativa de recebimento de proventos de ' + valFmt + ' com previsão de distribuição para o período atual.',
            assunto: '[Dividendos] Projeção de proventos a receber'
          })
        );
      }
    } catch (eInv) {
      // Falha graciosa sem interromper o fluxo
    }

    return enqueued;
  }

  /**
   * Processa a fila de e-mails pendentes respeitando quotas e cancelando contas já quitadas.
   */
  function processNotificationQueue(user, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var isDryRun = opts.dryRun !== undefined ? Boolean(opts.dryRun) : true;

    var remainingQuota = 100;
    if (!isDryRun && typeof MailApp !== 'undefined' && MailApp.getRemainingDailyQuota) {
      remainingQuota = MailApp.getRemainingDailyQuota();
    }

    var pending = SpreadsheetRepository.findByGrupo('NOTIFICACOES', user.grupo_id, function (n) {
      return (n.status === 'FILA' || n.status === 'ERRO') && Number(n.tentativas || 0) < MAX_ATTEMPTS;
    });

    var sentCount = 0;
    var failedCount = 0;
    var canceledCount = 0;

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var nextAttempt = Number(item.tentativas || 0) + 1;

      // Proteção obrigatória: se a notificação referencia um lançamento financeiro, verifica se já foi pago!
      if (item.referencia_id && item.referencia_modulo === 'launches') {
        var lan = SpreadsheetRepository.findById('LANCAMENTOS', item.referencia_id, user.grupo_id);
        if (!lan || lan.situacao === 'CONFIRMADO') {
          SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
            status: 'CANCELADO',
            ultimo_erro: 'CONTA_JA_PAGA: Lançamento já confirmado ou cancelado. Notificação descartada com segurança.'
          }, user.grupo_id);
          canceledCount++;
          continue;
        }
      }

      if (!isDryRun && remainingQuota <= 0) {
        SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
          status: 'ERRO',
          tentativas: nextAttempt,
          ultimo_erro: 'QUOTA_EXCEEDED: Limite diário de envio de e-mails do Google Apps Script atingido.'
        }, user.grupo_id);
        failedCount++;
        continue;
      }

      try {
        if (!isDryRun && typeof MailApp !== 'undefined') {
          var htmlBody = buildHtmlEmailTemplate(item);
          MailApp.sendEmail({
            to: item.destinatario_email,
            subject: item.assunto || item.titulo,
            body: item.mensagem || item.resumo_corpo,
            htmlBody: htmlBody
          });
          remainingQuota--;
        }

        SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
          status: 'ENVIADO',
          tentativas: nextAttempt,
          ultimo_erro: '',
          enviado_em: SpreadsheetRepository.nowIso()
        }, user.grupo_id);
        sentCount++;
      } catch (err) {
        var msg = ValidationService.sanitizeText(err && err.message ? err.message : String(err), 250);
        SpreadsheetRepository.updateById('NOTIFICACOES', item.id, {
          status: 'ERRO',
          tentativas: nextAttempt,
          ultimo_erro: msg
        }, user.grupo_id);
        failedCount++;
      }
    }

    return {
      dryRun: isDryRun,
      processados: pending.length,
      enviados: sentCount,
      cancelados_pagos: canceledCount,
      ignorados_ou_cancelados: canceledCount,
      falhas: failedCount,
      quota_restante_estimada: remainingQuota
    };
  }

  /**
   * Constrói template HTML responsivo corporativo para e-mails de lembrete individuais.
   */
  function buildHtmlEmailTemplate(item) {
    var tit = ValidationService.sanitizeText(item.titulo || item.assunto, 150);
    var msg = ValidationService.sanitizeText(item.mensagem || item.resumo_corpo, 1000);
    var dataStr = ValidationService.formatDateBr(item.criado_em ? item.criado_em.substring(0, 10) : SpreadsheetRepository.todayIso());
    var webAppUrl = getWebAppUrl();

    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<style>' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:#f1f5f9;margin:0;padding:20px;color:#1e293b;}' +
      '.card{max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);}' +
      '.header{background:linear-gradient(135deg,#0284c7,#2563eb);color:#ffffff;padding:24px;text-align:center;}' +
      '.content{padding:24px;line-height:1.6;font-size:15px;}' +
      '.btn{display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff!important;text-decoration:none;border-radius:8px;font-weight:600;margin-top:16px;}' +
      '.footer{padding:16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;}' +
      '</style></head><body>' +
      '<div class="card">' +
      '  <div class="header"><h2 style="margin:0;font-size:20px;">Finanças Inteligentes</h2><p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Alerta Financeiro Automático</p></div>' +
      '  <div class="content">' +
      '    <h3 style="margin-top:0;color:#0f172a;">' + tit + '</h3>' +
      '    <p style="color:#334155;">' + msg + '</p>' +
      '    <p style="font-size:13px;color:#64748b;margin-top:16px;">Data de referência: ' + dataStr + '</p>' +
      '    <div style="text-align:center;margin-top:20px;"><a href="' + webAppUrl + '" target="_blank" class="btn">Acessar Meu Painel Financeiro</a></div>' +
      '    <p style="font-size:11px;color:#64748b;text-align:center;margin-top:8px;">Link: ' + webAppUrl + '</p>' +
      '  </div>' +
      '  <div class="footer">Você está recebendo este lembrete conforme as regras do Finanças Inteligentes.</div>' +
      '</div></body></html>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Retorna a URL oficial e ativa do Web App.
   */
  function getWebAppUrl() {
    try {
      if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
        var serviceUrl = ScriptApp.getService().getUrl();
        if (serviceUrl && serviceUrl.indexOf('/exec') !== -1) {
          return serviceUrl;
        }
      }
      if (typeof PropertiesService !== 'undefined') {
        var props = PropertiesService.getScriptProperties();
        var savedUrl = props ? props.getProperty('WEB_APP_URL') : null;
        if (savedUrl && savedUrl.indexOf('/exec') !== -1) {
          return savedUrl;
        }
      }
    } catch (e) {}
    return 'https://script.google.com/macros/s/AKfycbyzjzX7GYRl-IGmJ0S8kgoCfA9i3G9zC2AuAzUgXFyEYEmrt_ivlaxE2gyul7TCcaAM7g/exec';
  }

  function getDayDifference(dateIso, todayIso) {
    if (!dateIso || !todayIso) return 0;
    var d1 = new Date(dateIso + 'T00:00:00Z');
    var d2 = new Date(todayIso + 'T00:00:00Z');
    return Math.round((d1.getTime() - d2.getTime()) / 86400000);
  }

  /**
   * Coleta e organiza todas as contas vencidas e a vencer nos próximos 3 dias,
   * unificando lançamentos e faturas de cartão de crédito para envio matinal único.
   */
  function collectMorningDigestData(user, forcedToday) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var today = forcedToday || SpreadsheetRepository.todayIso();

    var categories = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < categories.length; c++) catMap[categories[c].id] = categories[c].nome;

    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id);
    var accMap = {};
    for (var a = 0; a < accounts.length; a++) accMap[accounts[a].id] = accounts[a].nome_identificacao || accounts[a].instituicao;

    var unpaidLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.tipo === 'SAIDA' && l.situacao !== 'CONFIRMADO' && l.situacao !== 'CANCELADO';
    });

    var vencidas = [];
    var vencemHoje = [];
    var proximas = [];
    var totalVencidoCentavos = 0;
    var totalHojeCentavos = 0;
    var totalProximosCentavos = 0;

    for (var i = 0; i < unpaidLaunches.length; i++) {
      var lan = unpaidLaunches[i];
      var diff = getDayDifference(lan.data_lancamento, today);
      var val = Number(lan.valor_centavos) || 0;
      var itemObj = {
        id: lan.id,
        descricao: lan.descricao,
        categoria: catMap[lan.categoria_id] || 'Geral',
        conta: accMap[lan.conta_bancaria_id] || 'Conta Padrão',
        vencimento: lan.data_lancamento,
        vencimento_br: ValidationService.formatDateBr(lan.data_lancamento),
        valor_centavos: val,
        valor_formatado: formatCurrency(val),
        dias_diferenca: diff
      };

      if (diff < 0) {
        itemObj.dias_atraso = Math.abs(diff);
        vencidas.push(itemObj);
        totalVencidoCentavos += val;
      } else if (diff === 0) {
        vencemHoje.push(itemObj);
        totalHojeCentavos += val;
      } else if (diff <= 3) {
        itemObj.rotulo_dias = (diff === 1 ? 'Amanhã (1 dia)' : ('Em ' + diff + ' dias'));
        proximas.push(itemObj);
        totalProximosCentavos += val;
      }
    }

    vencidas.sort(function (x, y) { return String(x.vencimento).localeCompare(String(y.vencimento)); });
    proximas.sort(function (x, y) { return String(x.vencimento).localeCompare(String(y.vencimento)); });

    // Faturas de Cartão de Crédito
    var faturasVencidas = [];
    var faturasHoje = [];
    var faturasProximas = [];
    var cartoes = SpreadsheetRepository.findByGrupo('CARTOES_CREDITO', user.grupo_id);
    var cardMap = {};
    for (var k = 0; k < cartoes.length; k++) cardMap[cartoes[k].id] = cartoes[k];

    var unpaidInvoices = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id, function (f) {
      return f.situacao !== 'PAGA' && f.data_vencimento;
    });

    for (var j = 0; j < unpaidInvoices.length; j++) {
      var fat = unpaidInvoices[j];
      var card = cardMap[fat.cartao_id] || { nome: 'Cartão de Crédito', ultimos_digitos: '' };
      var diffFat = getDayDifference(fat.data_vencimento, today);
      var totalFat = Number(fat.valor_total_centavos) || 0;
      var pagoFat = Number(fat.valor_pago_centavos) || 0;
      var abertoFat = Math.max(0, totalFat - pagoFat);
      if (abertoFat <= 0) continue;

      var fatObj = {
        id: fat.id,
        cartao_nome: card.nome + (card.ultimos_digitos ? ' (•••• ' + card.ultimos_digitos + ')' : ''),
        mes_competencia: fat.mes_competencia,
        vencimento: fat.data_vencimento,
        vencimento_br: ValidationService.formatDateBr(fat.data_vencimento),
        valor_centavos: abertoFat,
        valor_formatado: formatCurrency(abertoFat),
        dias_diferenca: diffFat
      };

      if (diffFat < 0) {
        fatObj.dias_atraso = Math.abs(diffFat);
        faturasVencidas.push(fatObj);
        totalVencidoCentavos += abertoFat;
      } else if (diffFat === 0) {
        faturasHoje.push(fatObj);
        totalHojeCentavos += abertoFat;
      } else if (diffFat <= 3) {
        fatObj.rotulo_dias = (diffFat === 1 ? 'Amanhã (1 dia)' : ('Em ' + diffFat + ' dias'));
        faturasProximas.push(fatObj);
        totalProximosCentavos += abertoFat;
      }
    }

    var totalContas = vencidas.length + vencemHoje.length + proximas.length +
                      faturasVencidas.length + faturasHoje.length + faturasProximas.length;

    // Indicadores Gerais do Usuário (Saldo de Contas e Investimentos Ativos)
    var totalSaldoBancarioCentavos = 0;
    try {
      var activeAccounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
        return a.status !== 'INATIVO';
      });
      for (var sa = 0; sa < activeAccounts.length; sa++) {
        totalSaldoBancarioCentavos += Number(activeAccounts[sa].saldo_atual_centavos || 0);
      }
    } catch (eAcc) {}

    var totalInvestimentosCentavos = 0;
    try {
      var invs = SpreadsheetRepository.findByGrupo('INVESTIMENTOS', user.grupo_id, function (iv) {
        return iv.status !== 'INATIVO' && iv.status !== 'RESGATADO';
      });
      for (var si = 0; si < invs.length; si++) {
        totalInvestimentosCentavos += Number(invs[si].saldo_bruto_centavos || invs[si].valor_total_centavos || 0);
      }
    } catch (eInv) {}

    var nomeUsuario = user.nome ? user.nome.split(' ')[0] : 'Investidor';

    return {
      hoje: today,
      hoje_br: ValidationService.formatDateBr(today),
      nome_usuario: nomeUsuario,
      saldo_bancario_centavos: totalSaldoBancarioCentavos,
      saldo_bancario_formatado: formatCurrency(totalSaldoBancarioCentavos),
      investimentos_centavos: totalInvestimentosCentavos,
      investimentos_formatado: formatCurrency(totalInvestimentosCentavos),
      total_contas: totalContas,
      total_vencido_centavos: totalVencidoCentavos,
      total_vencido_formatado: formatCurrency(totalVencidoCentavos),
      total_hoje_centavos: totalHojeCentavos,
      total_hoje_formatado: formatCurrency(totalHojeCentavos),
      total_proximos_centavos: totalProximosCentavos,
      total_proximos_formatado: formatCurrency(totalProximosCentavos),
      total_geral_centavos: totalVencidoCentavos + totalHojeCentavos + totalProximosCentavos,
      total_geral_formatado: formatCurrency(totalVencidoCentavos + totalHojeCentavos + totalProximosCentavos),
      vencidas: vencidas,
      vencemHoje: vencemHoje,
      proximas: proximas,
      faturasVencidas: faturasVencidas,
      faturasHoje: faturasHoje,
      faturasProximas: faturasProximas
    };
  }

  /**
   * Constrói template HTML responsivo, moderno e corporativo para o resumo diário consolidado.
   */
  function buildMorningDigestHtmlEmail(data, webAppUrl) {
    var hojeBr = data.hoje_br || '';
    var safeUrl = webAppUrl || getWebAppUrl();

    var totalOverdue = data.vencidas.length + data.faturasVencidas.length;
    var totalHoje = data.vencemHoje.length + data.faturasHoje.length;
    var totalProximas = data.proximas.length + data.faturasProximas.length;

    var secVencidas = '';
    if (data.vencidas.length > 0) {
      secVencidas += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #ef4444; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#b91c1c; text-transform:uppercase; letter-spacing:0.5px;">🚨 Contas Vencidas — Requer Atenção Imediata</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#fef2f2; color:#991b1b; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Descrição</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Vencimento</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Atraso</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca; text-align:right;">Valor</th>' +
        '</tr></thead><tbody>';

      for (var v = 0; v < data.vencidas.length; v++) {
        var iv = data.vencidas[v];
        var bg = (v % 2 === 0) ? '#ffffff' : '#fdf2f2';
        secVencidas += '<tr style="background:' + bg + ';">' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2;">' +
          '<strong>' + escapeHtml(iv.descricao) + '</strong><br>' +
          '<span style="font-size:11px; color:#64748b;">' + escapeHtml(iv.categoria) + ' • ' + escapeHtml(iv.conta) + '</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2; color:#64748b;">' + escapeHtml(iv.vencimento_br) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2;">' +
          '<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;">' + iv.dias_atraso + ' dia(s)</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2; text-align:right; font-weight:700; color:#b91c1c;">' + iv.valor_formatado + '</td>' +
          '</tr>';
      }
      secVencidas += '</tbody></table></div>';
    }

    var secFatVencidas = '';
    if (data.faturasVencidas.length > 0) {
      secFatVencidas += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #ef4444; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#b91c1c; text-transform:uppercase; letter-spacing:0.5px;">💳 Faturas de Cartão Vencidas</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#fef2f2; color:#991b1b; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Cartão</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Vencimento</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca;">Atraso</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fecaca; text-align:right;">Saldo Aberto</th>' +
        '</tr></thead><tbody>';

      for (var fv = 0; fv < data.faturasVencidas.length; fv++) {
        var ifv = data.faturasVencidas[fv];
        var bgFv = (fv % 2 === 0) ? '#ffffff' : '#fdf2f2';
        secFatVencidas += '<tr style="background:' + bgFv + ';">' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2;"><strong>' + escapeHtml(ifv.cartao_nome) + '</strong> (' + escapeHtml(ifv.mes_competencia) + ')</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2; color:#64748b;">' + escapeHtml(ifv.vencimento_br) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2;">' +
          '<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;">' + ifv.dias_atraso + ' dia(s)</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #fee2e2; text-align:right; font-weight:700; color:#b91c1c;">' + ifv.valor_formatado + '</td>' +
          '</tr>';
      }
      secFatVencidas += '</tbody></table></div>';
    }

    var secHoje = '';
    if (data.vencemHoje.length > 0) {
      secHoje += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #f97316; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.5px;">🟠 Contas que Vencem Hoje (' + hojeBr + ')</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#fff7ed; color:#9a3412; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa;">Descrição</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa;">Categoria</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa; text-align:right;">Valor</th>' +
        '</tr></thead><tbody>';

      for (var h = 0; h < data.vencemHoje.length; h++) {
        var ih = data.vencemHoje[h];
        var bgH = (h % 2 === 0) ? '#ffffff' : '#fffaf5';
        secHoje += '<tr style="background:' + bgH + ';">' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5;">' +
          '<strong>' + escapeHtml(ih.descricao) + '</strong><br>' +
          '<span style="font-size:11px; color:#64748b;">' + escapeHtml(ih.conta) + '</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5; color:#64748b;">' + escapeHtml(ih.categoria) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5; text-align:right; font-weight:700; color:#c2410c;">' + ih.valor_formatado + '</td>' +
          '</tr>';
      }
      secHoje += '</tbody></table></div>';
    }

    var secFatHoje = '';
    if (data.faturasHoje.length > 0) {
      secFatHoje += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #f97316; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.5px;">💳 Faturas de Cartão Vencendo Hoje (' + hojeBr + ')</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#fff7ed; color:#9a3412; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa;">Cartão</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa;">Competência</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #fed7aa; text-align:right;">Valor</th>' +
        '</tr></thead><tbody>';

      for (var fh = 0; fh < data.faturasHoje.length; fh++) {
        var ifh = data.faturasHoje[fh];
        secFatHoje += '<tr style="background:#ffffff;">' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5;"><strong>' + escapeHtml(ifh.cartao_nome) + '</strong></td>' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5; color:#64748b;">' + escapeHtml(ifh.mes_competencia) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #ffedd5; text-align:right; font-weight:700; color:#c2410c;">' + ifh.valor_formatado + '</td>' +
          '</tr>';
      }
      secFatHoje += '</tbody></table></div>';
    }

    var secProximas = '';
    if (data.proximas.length > 0) {
      secProximas += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #3b82f6; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#1d4ed8; text-transform:uppercase; letter-spacing:0.5px;">🟡 Contas a Vencer nos Próximos 3 Dias</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#eff6ff; color:#1e40af; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Descrição</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Prazo</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Data</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe; text-align:right;">Valor</th>' +
        '</tr></thead><tbody>';

      for (var p = 0; p < data.proximas.length; p++) {
        var ip = data.proximas[p];
        var bgP = (p % 2 === 0) ? '#ffffff' : '#f8fafc';
        secProximas += '<tr style="background:' + bgP + ';">' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0;">' +
          '<strong>' + escapeHtml(ip.descricao) + '</strong><br>' +
          '<span style="font-size:11px; color:#64748b;">' + escapeHtml(ip.categoria) + ' • ' + escapeHtml(ip.conta) + '</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0;">' +
          '<span style="background:#dbeafe; color:#1e40af; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600;">' + escapeHtml(ip.rotulo_dias) + '</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0; color:#64748b;">' + escapeHtml(ip.vencimento_br) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:700; color:#1e293b;">' + ip.valor_formatado + '</td>' +
          '</tr>';
      }
      secProximas += '</tbody></table></div>';
    }

    var secFatProximas = '';
    if (data.faturasProximas.length > 0) {
      secFatProximas += '<div style="margin-bottom:24px;">' +
        '<div style="margin-bottom:8px; border-bottom:2px solid #3b82f6; padding-bottom:6px;">' +
        '<span style="font-size:14px; font-weight:700; color:#1d4ed8; text-transform:uppercase; letter-spacing:0.5px;">💳 Faturas de Cartão nos Próximos 3 Dias</span>' +
        '</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="background:#eff6ff; color:#1e40af; text-align:left;">' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Cartão</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Prazo</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe;">Vencimento</th>' +
        '<th style="padding:8px 10px; border-bottom:1px solid #bfdbfe; text-align:right;">Valor</th>' +
        '</tr></thead><tbody>';

      for (var fp = 0; fp < data.faturasProximas.length; fp++) {
        var ifp = data.faturasProximas[fp];
        secFatProximas += '<tr style="background:#ffffff;">' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0;"><strong>' + escapeHtml(ifp.cartao_nome) + '</strong> (' + escapeHtml(ifp.mes_competencia) + ')</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0;">' +
          '<span style="background:#dbeafe; color:#1e40af; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600;">' + escapeHtml(ifp.rotulo_dias) + '</span>' +
          '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0; color:#64748b;">' + escapeHtml(ifp.vencimento_br) + '</td>' +
          '<td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:700; color:#1e293b;">' + ifp.valor_formatado + '</td>' +
          '</tr>';
      }
      secFatProximas += '</tbody></table></div>';
    }

    return '<!DOCTYPE html>' +
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>Resumo Matinal — Finanças Inteligentes</title></head>' +
      '<body style="margin:0; padding:24px 12px; background-color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif; color:#0f172a;">' +
      '<div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 6px 20px rgba(0,0,0,0.07); border:1px solid #e2e8f0;">' +
      
      '<div style="background:linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding:28px 24px; text-align:center; color:#ffffff;">' +
      '  <div style="display:inline-block; padding:4px 12px; background:rgba(255,255,255,0.15); border-radius:20px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:8px;">' +
      '    ☕ Resumo Matinal Unificado' +
      '  </div>' +
      '  <h1 style="margin:0 0 6px 0; font-size:22px; font-weight:700; color:#ffffff; letter-spacing:-0.3px;">Finanças Inteligentes</h1>' +
      '  <p style="margin:0; font-size:14px; color:#cbd5e1;">Relatório diário de vencimentos — <strong>' + hojeBr + '</strong></p>' +
      '</div>' +

      '<div style="padding:24px;">' +

      '  <table style="width:100%; border-collapse:separate; border-spacing:8px 0; margin-bottom:24px;">' +
      '    <tr>' +
      '      <td style="width:33.33%; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:14px 10px; text-align:center; vertical-align:top;">' +
      '        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#991b1b; letter-spacing:0.5px; margin-bottom:4px;">🔴 Vencidas</div>' +
      '        <div style="font-size:17px; font-weight:800; color:#b91c1c;">' + data.total_vencido_formatado + '</div>' +
      '        <div style="font-size:12px; color:#7f1d1d; margin-top:2px;">' + totalOverdue + ' conta(s)</div>' +
      '      </td>' +
      '      <td style="width:33.33%; background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:14px 10px; text-align:center; vertical-align:top;">' +
      '        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#9a3412; letter-spacing:0.5px; margin-bottom:4px;">🟠 Vencem Hoje</div>' +
      '        <div style="font-size:17px; font-weight:800; color:#c2410c;">' + data.total_hoje_formatado + '</div>' +
      '        <div style="font-size:12px; color:#7c2d12; margin-top:2px;">' + totalHoje + ' conta(s)</div>' +
      '      </td>' +
      '      <td style="width:33.33%; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:14px 10px; text-align:center; vertical-align:top;">' +
      '        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#1e40af; letter-spacing:0.5px; margin-bottom:4px;">🟡 Próx. 3 Dias</div>' +
      '        <div style="font-size:17px; font-weight:800; color:#1d4ed8;">' + data.total_proximos_formatado + '</div>' +
      '        <div style="font-size:12px; color:#1e3a8a; margin-top:2px;">' + totalProximas + ' conta(s)</div>' +
      '      </td>' +
      '    </tr>' +
      '  </table>' +

      (data.total_contas === 0
        ? ('<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:22px 20px; margin-bottom:24px; text-align:center;">' +
             '<div style="font-size:32px; margin-bottom:8px;">🎉</div>' +
             '<h3 style="margin:0 0 6px 0; font-size:17px; color:#166534; font-weight:800;">Suas finanças estão 100% em dia!</h3>' +
             '<p style="margin:0; font-size:13px; color:#15803d; line-height:1.5;">' +
               'Você não possui nenhuma conta atrasada nem vencendo nos próximos 3 dias. Seu caixa operacional está equilibrado e seguro.' +
             '</p>' +
           '</div>')
        : '') +

      secVencidas +
      secFatVencidas +
      secHoje +
      secFatHoje +
      secProximas +
      secFatProximas +

      '  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin-bottom:24px;">' +
      '    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">' +
      '      <span style="font-size:18px;">✨</span>' +
      '      <h3 style="margin:0; font-size:14px; font-weight:700; color:#0f172a; text-transform:uppercase; letter-spacing:0.5px;">' +
      '        Novidades & Recursos da Plataforma' +
      '      </h3>' +
      '    </div>' +
      '    <table style="width:100%; border-collapse:collapse; font-size:13px; line-height:1.55; color:#334155;">' +
      '      <tr>' +
      '        <td style="padding:6px 0; vertical-align:top; width:26px;">💡</td>' +
      '        <td style="padding:6px 0;"><strong>Explicadores Interativos & Manuais:</strong> Popovers explicativos e botões de "Manual de Uso" integrados em todos os 12 módulos do sistema.</td>' +
      '      </tr>' +
      '      <tr>' +
      '        <td style="padding:6px 0; vertical-align:top; width:26px;">📈</td>' +
      '        <td style="padding:6px 0;"><strong>Central de Investimentos:</strong> Cotações online em tempo real, Radar rotativo de mercado, Suitability e comparador de ativos.</td>' +
      '      </tr>' +
      '      <tr>' +
      '        <td style="padding:6px 0; vertical-align:top; width:26px;">🤖</td>' +
      '        <td style="padding:6px 0;"><strong>Oráculo IA 2.0:</strong> Diagnóstico de saúde financeira (0-100), detector proativo de gargalos e simulações de cenários hipotéticos.</td>' +
      '      </tr>' +
      '      <tr>' +
      '        <td style="padding:6px 0; vertical-align:top; width:26px;">📅</td>' +
      '        <td style="padding:6px 0;"><strong>Planejamento 12M & Orçamentos:</strong> Projeção de fluxo de caixa futuro de 12 meses e limites por categoria com prevenção de déficits.</td>' +
      '      </tr>' +
      '    </table>' +
      '  </div>' +

      '  <div style="margin:28px 0 16px 0; text-align:center; background:#f8fafc; border-radius:12px; padding:24px 16px; border:1px solid #e2e8f0;">' +
      '    <h4 style="margin:0 0 6px 0; font-size:15px; color:#0f172a; font-weight:600;">Deseja registrar baixas ou conferir seu saldo?</h4>' +
      '    <p style="margin:0 0 16px 0; font-size:13px; color:#64748b;">Acesse seu painel com um clique para gerenciar seus pagamentos em tempo real.</p>' +
      '    <a href="' + safeUrl + '" target="_blank" style="display:inline-block; background:linear-gradient(135deg, #2563eb, #1d4ed8); color:#ffffff !important; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; box-shadow:0 4px 14px rgba(37,99,235,0.35);">' +
      '      👉 Acessar Finanças Inteligentes' +
      '    </a>' +
      '    <div style="margin-top:12px; font-size:11px; color:#64748b; word-break:break-all;">' +
      '      Link direto: <a href="' + safeUrl + '" target="_blank" style="color:#2563eb; text-decoration:underline;">' + safeUrl + '</a>' +
      '    </div>' +
      '  </div>' +

      '</div>' +

      '<div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 24px; font-size:12px; color:#64748b; text-align:center; line-height:1.5;">' +
      '  Você está recebendo este e-mail unificado conforme as configurações de alerta matinal do seu sistema.<br>' +
      '  Contas marcadas como pagas são retiradas automaticamente do próximo resumo.<br>' +
      '  <span style="display:inline-block; margin-top:4px; color:#94a3b8;">Gerado e enviado com segurança por Finanças Inteligentes.</span>' +
      '</div>' +

      '</div></body></html>';
  }

  /**
   * Envia o resumo matinal unificado por e-mail para um usuário específico,
   * garantindo que apenas 1 e-mail consolidado seja enviado por dia (idempotência).
   */
  function sendDailyMorningDigest(user, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var isDryRun = opts.dryRun !== undefined ? Boolean(opts.dryRun) : false;
    var force = Boolean(opts.force);
    var today = opts.hoje || SpreadsheetRepository.todayIso();

    var prefs = getUserPreferences(user);
    if (!prefs.email_ativo && !force) {
      return { ok: true, enviado: false, motivo: 'NOTIFICACOES_EMAIL_DESATIVADAS' };
    }

    var data = collectMorningDigestData(user, today);

    var recipientEmail = AuthService.normalizeEmail(opts.destinatario_email || user.email);
    if (!recipientEmail || recipientEmail.indexOf('@') === -1) {
      throw new Error('E-mail do destinatário inválido: ' + recipientEmail);
    }

    var idempKey = 'digest_matinal_' + user.grupo_id + '_' + recipientEmail + '_' + today;
    if (!force) {
      var alreadySent = SpreadsheetRepository.findOne('NOTIFICACOES', function (n) {
        return n.grupo_id === user.grupo_id && n.idempotency_key === idempKey && (n.status === 'ENVIADO' || n.status === 'FILA');
      });
      if (alreadySent) {
        return { ok: true, enviado: false, motivo: 'JA_ENVIADO_HOJE', notification_id: alreadySent.id, data: data };
      }
    }

    var webAppUrl = getWebAppUrl();
    var htmlContent = buildMorningDigestHtmlEmail(data, webAppUrl);

    var totalOverdue = data.vencidas.length + data.faturasVencidas.length;
    var totalUpcoming = data.vencemHoje.length + data.proximas.length + data.faturasHoje.length + data.faturasProximas.length;

    var subject = totalOverdue > 0
      ? '🚨 [Atenção] Resumo Matinal: ' + totalOverdue + ' conta(s) vencida(s) e ' + totalUpcoming + ' a vencer — Finanças Inteligentes'
      : (totalUpcoming > 0
        ? '📅 Resumo Matinal: ' + totalUpcoming + ' compromisso(s) a vencer nos próximos 3 dias — Finanças Inteligentes'
        : '☕ Resumo Matinal: Contas em Dia & Novidades do App — Finanças Inteligentes');

    var textSummary = 'Resumo Matinal Finanças Inteligentes (' + data.hoje_br + '):\n' +
      (data.total_contas === 0
        ? '🎉 Parabéns! Suas finanças estão 100% em dia. Nenhuma conta pendente hoje ou nos próximos 3 dias.\n'
        : 'Total Vencido: ' + data.total_vencido_formatado + ' (' + totalOverdue + ' contas)\n' +
          'Vencem Hoje: ' + data.total_hoje_formatado + '\n' +
          'Próximos 3 Dias: ' + data.total_proximos_formatado + '\n\n') +
      'Novidades do App: Popovers explicativos, Central de Investimentos com Cotações Online e Oráculo IA 2.0 ativos.\n\n' +
      'Acesse seu painel financeiro: ' + webAppUrl;
      'Próximos 3 Dias: ' + data.total_proximos_formatado + '\n\n' +
      'Acesse seu painel financeiro para dar baixa: ' + webAppUrl;

    if (!isDryRun && typeof MailApp !== 'undefined') {
      var remainingQuota = MailApp.getRemainingDailyQuota ? MailApp.getRemainingDailyQuota() : 100;
      if (remainingQuota <= 0) {
        throw new Error('QUOTA_EXCEEDED: Limite diário de envio de e-mails do Google Apps Script atingido.');
      }
      MailApp.sendEmail({
        to: recipientEmail,
        subject: subject,
        body: textSummary,
        htmlBody: htmlContent
      });
    }

    var notifRecord = SpreadsheetRepository.insert('NOTIFICACOES', {
      id: SpreadsheetRepository.generateId('not'),
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      destinatario_email: recipientEmail,
      tipo_notificacao: 'RESUMO_MENSAL',
      referencia_id: 'digest_' + today,
      referencia_modulo: 'launches',
      idempotency_key: idempKey,
      assunto: subject,
      titulo: subject,
      resumo_corpo: textSummary,
      mensagem: textSummary,
      prioridade: totalOverdue > 0 ? 'ALTA' : 'MEDIA',
      categoria: 'VENCIMENTOS',
      canais: 'EMAIL',
      status: isDryRun ? 'FILA' : 'ENVIADO',
      status_leitura: false,
      data_leitura: '',
      adiado_ate: '',
      contagem_adiamentos: 0,
      tentativas: 1,
      ultimo_erro: '',
      agendado_para: today,
      enviado_em: isDryRun ? '' : SpreadsheetRepository.nowIso(),
      criado_em: SpreadsheetRepository.nowIso()
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'RESUMO_MATINAL_ENVIADO',
      entidade: 'NOTIFICACOES',
      entidade_id: notifRecord.id,
      origem: 'SISTEMA',
      detalhes: {
        destinatario: recipientEmail,
        vencidas: totalOverdue,
        a_vencer: totalUpcoming,
        total_geral: data.total_geral_formatado,
        dryRun: isDryRun
      }
    });

    return {
      ok: true,
      enviado: !isDryRun,
      dryRun: isDryRun,
      destinatario: recipientEmail,
      assunto: subject,
      contas_total: data.total_contas,
      notification_id: notifRecord.id,
      data: data
    };
  }

  /**
   * Dispara o envio matinal consolidado para todos os usuários ativos do sistema.
   * Acionada diariamente entre 07:00 e 08:00 pelo gatilho automático temporal do Apps Script.
   */
  function sendAllDailyMorningDigests(options) {
    var opts = options || {};
    var today = SpreadsheetRepository.todayIso();
    var users = SpreadsheetRepository.readAll('USUARIOS', function (u) {
      return (u.status === 'ATIVO' || u.status === 'APROVADO') && u.email && u.email.indexOf('@') !== -1;
    });

    var results = [];
    var processedEmails = {};

    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var emailNorm = AuthService.normalizeEmail(u.email);
      var key = u.grupo_id + '_' + emailNorm;
      if (processedEmails[key]) continue;
      processedEmails[key] = true;

      try {
        var res = sendDailyMorningDigest(u, opts);
        results.push({ email: emailNorm, grupo_id: u.grupo_id, resultado: res });
      } catch (err) {
        results.push({
          email: emailNorm,
          grupo_id: u.grupo_id,
          erro: err && err.message ? err.message : String(err)
        });
      }
    }

    return {
      data_execucao: today,
      total_usuarios_processados: users.length,
      disparos: results
    };
  }

  /**
   * Garante a criação idempotente do gatilho automático diário matinal no Apps Script (às 07:00h).
   */
  function ensureDailyMorningTrigger() {
    if (typeof ScriptApp === 'undefined') {
      return { ok: false, motivo: 'SCRIPTAPP_UNAVAILABLE' };
    }
    var fnName = 'executarEnvioMatinalNotificacoes';
    try {
      var triggers = ScriptApp.getProjectTriggers();
      for (var i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === fnName) {
          return {
            ok: true,
            status: 'JA_CONFIGURADO',
            triggerId: triggers[i].getUniqueId(),
            mensagem: 'Gatilho matinal automático diário (07:00-08:00) já se encontra ativo.'
          };
        }
      }
      var newTrig = ScriptApp.newTrigger(fnName)
        .timeBased()
        .everyDays(1)
        .atHour(7)
        .create();

      return {
        ok: true,
        status: 'CRIADO',
        triggerId: newTrig.getUniqueId(),
        mensagem: 'Gatilho matinal automático diário configurado com sucesso para às 07:00h.'
      };
    } catch (err) {
      return {
        ok: false,
        status: 'ERRO_PERMISSAO',
        motivo: 'SCRIPTAPP_AUTH_REQUIRED',
        mensagem: 'Autorização necessária no Google Apps Script: ' + (err && err.message ? err.message : String(err))
      };
    }
  }

  function getTriggerStatus() {
    if (typeof ScriptApp === 'undefined') {
      return { configurado: false, detalhes: 'Ambiente sem ScriptApp' };
    }
    var fnName = 'executarEnvioMatinalNotificacoes';
    try {
      var triggers = ScriptApp.getProjectTriggers();
      for (var i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === fnName) {
          return {
            configurado: true,
            funcao: fnName,
            triggerId: triggers[i].getUniqueId(),
            tipo: 'TIME_DRIVEN_DAILY_07H'
          };
        }
      }
      return { configurado: false, funcao: fnName };
    } catch (err) {
      return {
        configurado: false,
        erro: 'PERMISSAO_NECESSARIA',
        detalhes: err && err.message ? err.message : String(err)
      };
    }
  }

  return {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    NOTIFICATION_TYPES: NOTIFICATION_TYPES,
    PRIORITIES: PRIORITIES,
    getWebAppUrl: getWebAppUrl,
    getUserPreferences: getUserPreferences,
    saveUserPreferences: saveUserPreferences,
    enqueueNotification: enqueueNotification,
    getCenterOverview: getCenterOverview,
    getInitialPopup: getInitialPopup,
    setReadStatus: setReadStatus,
    markAllAsRead: markAllAsRead,
    snoozeNotification: snoozeNotification,
    deleteNotification: deleteNotification,
    clearReadNotifications: clearReadNotifications,
    scanAndEnqueueDueAlerts: scanAndEnqueueDueAlerts,
    scanInvestmentAndOracleAlerts: scanInvestmentAndOracleAlerts,
    processNotificationQueue: processNotificationQueue,
    collectMorningDigestData: collectMorningDigestData,
    buildMorningDigestHtmlEmail: buildMorningDigestHtmlEmail,
    sendDailyMorningDigest: sendDailyMorningDigest,
    sendAllDailyMorningDigests: sendAllDailyMorningDigests,
    ensureDailyMorningTrigger: ensureDailyMorningTrigger,
    getTriggerStatus: getTriggerStatus
  };
})();
