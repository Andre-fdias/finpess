/**
 * @file TelegramWebhookService.gs
 * @description Orquestrador do Webhook do Bot do Telegram. Valida segredo do webhook,
 * processa comandos (/start, /ajuda, /status, /cancelar, /vincular, /desvincular),
 * mensagens de texto, áudios e callbacks de confirmação/edição.
 */

var TelegramWebhookService = (function () {
  function buildInlineKeyboardForProposal(user, proc, extractedData) {
    var buttons = [];
    var hasPending = extractedData.campos_pendentes && extractedData.campos_pendentes.length > 0;

    if (!hasPending) {
      buttons.push([
        {
          text: '✅ Confirmar lançamento',
          callback_data: 'CONFIRM:' + proc.id + ':' + proc.preview_hash
        }
      ]);
    } else if (extractedData.campos_pendentes.indexOf('conta_bancaria') !== -1) {
      var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
        return a.situacao === 'ATIVA';
      });
      var accRow = [];
      for (var i = 0; i < Math.min(accounts.length, 3); i++) {
        accRow.push({
          text: '🏦 ' + accounts[i].nome_identificacao,
          callback_data: 'SETACC:' + proc.id + ':' + accounts[i].id
        });
      }
      if (accRow.length > 0) {
        buttons.push(accRow);
      }
    }

    buttons.push([
      {
        text: '✏️ Editar informações',
        callback_data: 'EDITMENU:' + proc.id
      },
      {
        text: '❌ Cancelar',
        callback_data: 'CANCEL:' + proc.id
      }
    ]);

    return { inline_keyboard: buttons };
  }

  function sendTelegramReply(chatId, text, replyMarkup, options) {
    var opts = options || {};
    var messagePayload = {
      chat_id: String(chatId),
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      messagePayload.reply_markup = replyMarkup;
    }

    if (opts.sendRealTelegramMessages) {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
      if (botToken && typeof UrlFetchApp !== 'undefined') {
        try {
          UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(messagePayload),
            muteHttpExceptions: true
          });
        } catch (sendErr) {
          try {
            delete messagePayload.parse_mode;
            UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
              method: 'post',
              contentType: 'application/json',
              payload: JSON.stringify(messagePayload),
              muteHttpExceptions: true
            });
          } catch (fallbackErr) {}
        }
      }
    }

    return messagePayload;
  }

  function answerCallbackQuery(callbackQueryId, text, showAlert, options) {
    var opts = options || {};
    if (!callbackQueryId) return;
    if (opts.sendRealTelegramMessages) {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
      if (botToken && typeof UrlFetchApp !== 'undefined') {
        try {
          UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/answerCallbackQuery', {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
              callback_query_id: String(callbackQueryId),
              text: text || '',
              show_alert: Boolean(showAlert)
            }),
            muteHttpExceptions: true
          });
        } catch (e) {}
      }
    }
  }

  function editTelegramMessage(chatId, messageId, text, replyMarkup, options) {
    var opts = options || {};
    if (!chatId || !messageId) return null;
    var payload = {
      chat_id: String(chatId),
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (opts.sendRealTelegramMessages) {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
      if (botToken && typeof UrlFetchApp !== 'undefined') {
        try {
          UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/editMessageText', {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          });
        } catch (e) {
          try {
            delete payload.parse_mode;
            UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/editMessageText', {
              method: 'post',
              contentType: 'application/json',
              payload: JSON.stringify(payload),
              muteHttpExceptions: true
            });
          } catch (e2) {}
        }
      }
    }
    return payload;
  }

  function sendChatAction(chatId, action, options) {
    var opts = options || {};
    if (!chatId) return;
    if (opts.sendRealTelegramMessages) {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
      if (botToken && typeof UrlFetchApp !== 'undefined') {
        try {
          UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/sendChatAction', {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
              chat_id: String(chatId),
              action: action || 'typing'
            }),
            muteHttpExceptions: true
          });
        } catch (e) {}
      }
    }
  }

  function formatMonthRef(isoYm) {
    if (!isoYm) return '';
    var parts = isoYm.split('-');
    var months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var mIdx = parseInt(parts[1], 10) - 1;
    return (months[mIdx] || '') + ' de ' + parts[0];
  }

  function buildMainMenuKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '💰 Saldo em Contas', callback_data: 'MENU_SALDO' },
          { text: '💳 Cartões & Faturas', callback_data: 'MENU_FATURAS' }
        ],
        [
          { text: '📅 Contas a Vencer', callback_data: 'MENU_CONTAS' },
          { text: '📊 Balanço do Mês', callback_data: 'MENU_RESUMO' }
        ],
        [
          { text: '🎯 Metas & Reserva', callback_data: 'MENU_METAS' },
          { text: '📉 Dívidas & Empréstimos', callback_data: 'MENU_DIVIDAS' }
        ],
        [
          { text: '📈 Investimentos', callback_data: 'MENU_INVEST' },
          { text: '📋 Últimos Lançamentos', callback_data: 'MENU_EXTRATO' }
        ],
        [
          { text: '🔮 Oráculo IA', callback_data: 'MENU_ORACULO' },
          { text: '❓ Central de Ajuda', callback_data: 'MENU_AJUDA' }
        ]
      ]
    };
  }

  function formatMainMenu(user) {
    var firstName = (user.nome || 'Usuário').split(' ')[0];
    return [
      '👋 *Olá, ' + firstName + '!*',
      'Seja bem-vindo ao seu *Assistente Financeiro Inteligente*.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Aqui você pode consultar seus saldos, faturas, metas, investimentos e obter análises do Oráculo IA.',
      '',
      '💡 *O que deseja consultar agora?*',
      'Toque em um dos botões abaixo ou envie mensagens como:',
      '• _"Almoço 38,50 no débito"_ (para registrar)',
      '• _"Qual o meu saldo?"_ ou _"/saldo"_',
      '• _"Quais contas vencem essa semana?"_'
    ].join('\n');
  }

  function formatSaldosResponse(user) {
    var accounts = BankAccountService.listBankAccountsWithBalances(user, false);
    var totalConfirmado = 0;
    var totalProjetado = 0;
    var lines = [
      '🏦 *SALDO DAS CONTAS BANCÁRIAS*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];
    if (!accounts || accounts.length === 0) {
      lines.push('Nenhuma conta bancária ativa cadastrada.');
    } else {
      for (var i = 0; i < accounts.length; i++) {
        var a = accounts[i];
        var sConf = Number(a.saldo_confirmado_centavos || 0);
        var sProj = Number(a.saldo_projetado_centavos || 0);
        totalConfirmado += sConf;
        totalProjetado += sProj;
        var icon = sConf >= 0 ? '🟢' : '🔴';
        lines.push(icon + ' *' + a.nome_identificacao + '* (' + (a.instituicao || 'Banco') + ')');
        lines.push('   • Confirmado: `' + ValidationService.formatCentavosToBrl(sConf) + '`');
        if (sProj !== sConf) {
          lines.push('   • Projetado: `' + ValidationService.formatCentavosToBrl(sProj) + '`');
        }
      }
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('💵 *TOTAL CONSOLIDADO REALIZADO:* `' + ValidationService.formatCentavosToBrl(totalConfirmado) + '`');
    if (totalProjetado !== totalConfirmado) {
      lines.push('⏳ *Total Projetado:* `' + ValidationService.formatCentavosToBrl(totalProjetado) + '`');
    }
    return lines.join('\n');
  }

  function formatFaturasResponse(user) {
    var cards = CreditCardService.listCards(user);
    var lines = [
      '💳 *CARTÕES DE CRÉDITO & FATURAS*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];
    if (!cards || cards.length === 0) {
      lines.push('Nenhum cartão de crédito cadastrado.');
    } else {
      var totalComprometido = 0;
      var totalLimite = 0;
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var limTotal = Number(c.limite_total_centavos || 0) + Number(c.limite_adicional_centavos || 0);
        var limComp = Number(c.limite_comprometido_centavos || 0);
        var limDisp = Math.max(0, limTotal - limComp);
        totalLimite += limTotal;
        totalComprometido += limComp;
        lines.push('💳 *' + c.nome + '* (' + (c.bandeira || 'Cartão') + ')');
        lines.push('   • Limite Disponível: `' + ValidationService.formatCentavosToBrl(limDisp) + '` de `' + ValidationService.formatCentavosToBrl(limTotal) + '`');
        lines.push('   • Fatura Atual: `' + ValidationService.formatCentavosToBrl(c.fatura_atual_centavos || 0) + '`');
        lines.push('   • Melhor dia de compra: *Dia ' + (c.melhor_dia_compra || c.dia_fechamento || '-') + '* (Vence dia ' + (c.dia_vencimento || '-') + ')');
        lines.push('');
      }
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('📊 *Comprometimento Geral:* `' + ValidationService.formatCentavosToBrl(totalComprometido) + '` / `' + ValidationService.formatCentavosToBrl(totalLimite) + '`');
    }
    return lines.join('\n');
  }

  function formatContasResponse(user) {
    var today = SpreadsheetRepository.todayIso();
    var allLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.tipo === 'SAIDA' && (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE');
    });
    allLaunches.sort(function (a, b) {
      return (a.data_lancamento || '').localeCompare(b.data_lancamento || '');
    });
    var vencidas = [];
    var proximas7Dias = [];
    var outras = [];

    var dToday = new Date(today + 'T12:00:00Z');
    var d7 = new Date(dToday.getTime() + 7 * 86400000);
    var date7Iso = d7.toISOString().substring(0, 10);

    for (var i = 0; i < allLaunches.length; i++) {
      var l = allLaunches[i];
      if (l.data_lancamento < today) {
        vencidas.push(l);
      } else if (l.data_lancamento <= date7Iso) {
        proximas7Dias.push(l);
      } else {
        outras.push(l);
      }
    }

    var lines = [
      '📅 *COMPROMISSOS & CONTAS A VENCER*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (vencidas.length > 0) {
      lines.push('⚠️ *ATENÇÃO: CONTAS ATRASADAS (' + vencidas.length + '):*');
      for (var v = 0; v < Math.min(vencidas.length, 5); v++) {
        var cv = vencidas[v];
        lines.push('🔴 *' + cv.descricao + '* - `' + ValidationService.formatCentavosToBrl(cv.valor_centavos) + '` (Venceu em ' + ValidationService.formatDateBr(cv.data_lancamento) + ')');
      }
      lines.push('');
    }

    if (proximas7Dias.length > 0) {
      lines.push('⏳ *PRÓXIMOS 7 DIAS (' + proximas7Dias.length + '):*');
      var total7 = 0;
      for (var p = 0; p < proximas7Dias.length; p++) {
        var cp = proximas7Dias[p];
        total7 += Number(cp.valor_centavos || 0);
        lines.push('• *' + cp.descricao + '*: `' + ValidationService.formatCentavosToBrl(cp.valor_centavos) + '` (' + ValidationService.formatDateBr(cp.data_lancamento) + ')');
      }
      lines.push('👉 *Subtotal 7 dias:* `' + ValidationService.formatCentavosToBrl(total7) + '`');
      lines.push('');
    } else {
      lines.push('✅ Nenhuma conta a vencer nos próximos 7 dias.');
      lines.push('');
    }

    if (outras.length > 0) {
      lines.push('📋 *Mais adiante no mês:* ' + outras.length + ' conta(s) prevista(s).');
    }

    return lines.join('\n');
  }

  function formatResumoResponse(user) {
    var today = SpreadsheetRepository.todayIso();
    var curMonth = today.substring(0, 7);
    var dash = FinanceService.getDashboardData(user, curMonth);
    var mesExtenso = formatMonthRef(curMonth);

    var recConf = dash.confirmados.receitas_realizadas_mes_centavos;
    var despConf = dash.confirmados.despesas_pagas_mes_centavos;
    var resReal = dash.confirmados.resultado_mensal_realizado_centavos;
    var despPrev = dash.previstos.despesas_previstas_mes_centavos + dash.pendentes.despesas_pendentes_mes_centavos;

    var iconRes = resReal >= 0 ? '🟢' : '🔴';

    var lines = [
      '📊 *BALANÇO FINANCEIRO DE ' + mesExtenso.toUpperCase() + '*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🟢 *Receitas Realizadas:* `' + ValidationService.formatCentavosToBrl(recConf) + '`',
      '🔴 *Despesas Pagas:* `' + ValidationService.formatCentavosToBrl(despConf) + '`',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      iconRes + ' *Resultado Caixa (Realizado):* `' + ValidationService.formatCentavosToBrl(resReal) + '`',
      '⏳ *Despesas Previstas/Pendentes:* `' + ValidationService.formatCentavosToBrl(despPrev) + '`',
      '🔮 *Saldo Projetado no Fim do Mês:* `' + ValidationService.formatCentavosToBrl(dash.estimados.saldo_final_mes_projetado_centavos) + '`',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (dash.scoreSaude) {
      lines.push('🎯 *Saúde Financeira:* Nota ' + dash.scoreSaude.nota + '/100 (' + dash.scoreSaude.faixa_rotulo + ')');
    }

    return lines.join('\n');
  }

  function formatMetasResponse(user) {
    var goals = GoalService.listGoals(user);
    var lines = [
      '🎯 *METAS FINANCEIRAS & RESERVA*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];
    if (!goals || goals.length === 0) {
      lines.push('Nenhuma meta cadastrada no momento.');
      lines.push('Crie metas pelo painel web para acompanhar o progresso aqui!');
    } else {
      for (var i = 0; i < goals.length; i++) {
        var g = goals[i];
        var pct = Math.round(Number(g.percentual_atingido || 0));
        var barra = '';
        var slots = Math.min(10, Math.floor(pct / 10));
        for (var b = 0; b < slots; b++) barra += '🟩';
        for (var e = slots; e < 10; e++) barra += '⬜';
        lines.push('🎯 *' + g.nome + '*');
        lines.push(barra + ' ' + pct + '%');
        lines.push('   • Acumulado: `' + ValidationService.formatCentavosToBrl(g.valor_acumulado_centavos) + '` / `' + ValidationService.formatCentavosToBrl(g.valor_alvo_centavos) + '`');
        if (g.data_limite) {
          lines.push('   • Prazo: ' + ValidationService.formatDateBr(g.data_limite) + ' (' + (g.dias_restantes > 0 ? g.dias_restantes + ' dias restantes' : 'Concluído') + ')');
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  function formatDividasResponse(user) {
    var debts = DebtService.listDebts(user);
    var loans = LoanService.listLoans(user);

    var lines = [
      '📉 *DÍVIDAS, ACORDOS & EMPRÉSTIMOS*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    var totalDevedor = 0;

    if (debts && debts.length > 0) {
      lines.push('🏷️ *Dívidas e Renegociações:*');
      for (var d = 0; d < debts.length; d++) {
        var db = debts[d];
        if (db.situacao !== 'QUITADA' && db.situacao !== 'CANCELADA') {
          var saldoDev = Number(db.saldo_devedor_centavos || 0);
          totalDevedor += saldoDev;
          lines.push('• *' + db.descricao + '* (' + (db.credor || 'Credor') + ')');
          lines.push('  Saldo Devedor: `' + ValidationService.formatCentavosToBrl(saldoDev) + '` (' + (db.parcelas_pagas || 0) + '/' + (db.parcelas_total || 0) + ' pagas)');
        }
      }
      lines.push('');
    }

    if (loans && loans.length > 0) {
      lines.push('🏦 *Empréstimos Ativos:*');
      for (var l = 0; l < loans.length; l++) {
        var ln = loans[l];
        if (ln.situacao === 'ATIVO') {
          var sDevLoan = Number(ln.saldo_devedor_centavos || 0);
          totalDevedor += sDevLoan;
          lines.push('• *' + ln.descricao + '* (' + (ln.instituicao || 'Banco') + ')');
          lines.push('  Saldo Devedor: `' + ValidationService.formatCentavosToBrl(sDevLoan) + '` | Parcela: `' + ValidationService.formatCentavosToBrl(ln.valor_parcela_centavos) + '`');
        }
      }
      lines.push('');
    }

    if (totalDevedor === 0) {
      lines.push('🎉 *Parabéns! Não há dívidas ou empréstimos ativos pendentes.*');
    } else {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('⚠️ *Saldo Devedor Consolidado:* `' + ValidationService.formatCentavosToBrl(totalDevedor) + '`');
    }

    return lines.join('\n');
  }

  function formatInvestimentosResponse(user) {
    var port = InvestmentService.getPortfolioSummary(user);
    var lines = [
      '📈 *PATRIMÔNIO & INVESTIMENTOS*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (!port || !port.posicoes || port.posicoes.length === 0) {
      lines.push('Nenhum ativo ou investimento cadastrado.');
      lines.push('Cadastre seus ativos pelo painel web no módulo Investimentos!');
    } else {
      var totalAtual = Number(port.total_mercado_centavos || port.total_aplicado_centavos || 0);
      var totalAplicado = Number(port.total_aplicado_centavos || 0);
      var rentCent = totalAtual - totalAplicado;
      var rentPct = totalAplicado > 0 ? ((rentCent / totalAplicado) * 100).toFixed(2) : '0.00';
      var rentIcon = rentCent >= 0 ? '🟢 +' : '🔴 ';

      lines.push('💰 *Patrimônio Total:* `' + ValidationService.formatCentavosToBrl(totalAtual) + '`');
      lines.push('📥 *Total Aplicado:* `' + ValidationService.formatCentavosToBrl(totalAplicado) + '`');
      lines.push('📊 *Rentabilidade Histórica:* ' + rentIcon + rentPct + '% (`' + ValidationService.formatCentavosToBrl(rentCent) + '`)');
      lines.push('');
      lines.push('🏆 *Principais Posições:*');
      for (var i = 0; i < Math.min(port.posicoes.length, 5); i++) {
        var pos = port.posicoes[i];
        lines.push('• *' + pos.codigo + '* (' + (pos.classe || 'Ativo') + '): `' + ValidationService.formatCentavosToBrl(pos.valor_mercado_centavos || pos.valor_total_aplicado_centavos) + '`');
      }
    }

    return lines.join('\n');
  }

  function formatExtratoResponse(user) {
    var today = SpreadsheetRepository.todayIso();
    var curMonth = today.substring(0, 7);
    var launches = FinanceService.listLaunches(user, { pageSize: 6, mesCompetencia: curMonth });
    var items = (launches && launches.items) ? launches.items : [];

    var lines = [
      '📋 *ÚLTIMOS LANÇAMENTOS DO MÊS*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (items.length === 0) {
      lines.push('Nenhum lançamento registrado neste mês.');
    } else {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var icon = it.tipo === 'ENTRADA' ? '🟢 +' : '🔴 -';
        var sit = (it.situacao === 'PREVISTO' || it.situacao === 'PENDENTE') ? '⏳' : '✅';
        lines.push(icon + ' `' + ValidationService.formatCentavosToBrl(it.valor_centavos) + '` ' + sit + ' *' + it.descricao + '*');
        lines.push('   ' + ValidationService.formatDateBr(it.data_lancamento) + ' • ' + (it.categoria_nome || 'Geral') + ' • ' + (it.conta_bancaria_nome || 'Banco'));
      }
    }

    return lines.join('\n');
  }

  function formatOraculoResponse(user, queryText) {
    var prompt = queryText ? String(queryText).replace(/^\/oraculo\s*/i, '').trim() : '';
    if (!prompt) {
      prompt = 'Faça um resumo executivo da minha situação financeira este mês, apontando saúde, saldo e onde posso economizar.';
    }
    var today = SpreadsheetRepository.todayIso();
    var curMonth = today.substring(0, 7);
    var oracleRes = GeminiService.askOracle(user, prompt, curMonth);
    var resposta = oracleRes && oracleRes.resposta ? oracleRes.resposta : 'Não foi possível obter resposta do Oráculo.';

    var lines = [
      '🔮 *ORÁCULO FINANCEIRO IA*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '💬 *Consulta:* _"' + prompt + '"_',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      resposta
    ];

    return lines.join('\n');
  }

  function extractLinkingToken(input) {
    if (!input) return '';
    var str = String(input).trim();
    var m = str.match(/FIN[\s\-_–—]*([A-Za-z0-9]{6,12})/i);
    if (m) {
      return 'FIN-' + m[1].toUpperCase();
    }
    return '';
  }

  function handleCommand(commandText, telegramUserId, telegramChatId, options) {
    var trimmed = String(commandText || '').trim();
    var parts = trimmed.split(/\s+/);
    var cmd = parts[0].toLowerCase().split('@')[0];
    var token = extractLinkingToken(trimmed);

    // 1. Se qualquer token de vinculação (FIN-XXXXXX) for detectado no comando ou texto
    if (token) {
      try {
        var autoLink = TelegramAuthService.consumeLinkingCode(token, telegramUserId, telegramChatId);
        return sendTelegramReply(
          telegramChatId,
          '✅ Vínculo automático concluído com sucesso para ' + autoLink.usuario.nome + ' (Vínculo estabelecido com sucesso)!\n\n' +
          'Agora você já pode enviar mensagens de texto ou áudios de Entradas e Saídas.\n' +
          'Exemplo: "Gastei 45,90 no mercado hoje no Pix"',
          null,
          options
        );
      } catch (linkErr) {
        var cleanErr = linkErr && linkErr.message ? linkErr.message.replace(/^[A-Z_]+:\s*/, '') : String(linkErr);
        return sendTelegramReply(
          telegramChatId,
          '⚠️ Não foi possível vincular com o código ' + token + ':\n' + cleanErr +
          '\n\n👉 Acesse o sistema web e clique em "Apenas Gerar Novo Código" para obter um código válido.',
          null,
          options
        );
      }
    }

    if (cmd === '/start' || cmd === '/vincular') {
      // Verifica se este Telegram já está vinculado com sucesso
      try {
        var existingAuth = TelegramAuthService.getAuthorizedUserByTelegramId(telegramUserId);
        if (existingAuth && existingAuth.usuario) {
          return sendTelegramReply(
            telegramChatId,
            '✅ Seu Telegram já está conectado e vinculado com sucesso à conta de ' + existingAuth.usuario.nome + '!\n\n' +
            'Você já pode enviar lançamentos diretamente por texto ou áudio. Experimente enviar:\n' +
            '• "Almoço 38,50 no débito"\n' +
            '• "Mercado 120 no Pix"',
            null,
            options
          );
        }
      } catch (eNotLinkedYet) {}

      return sendTelegramReply(
        telegramChatId,
        'Olá! Sou o assistente de captura do Finanças Inteligentes.\n\n' +
        'Para enviar lançamentos de entradas e saídas por texto ou áudio, sua conta precisa estar vinculada.\n' +
        'Envie o código gerado no sistema web (exemplo: /start FIN-XXXXXX ou apenas o código) para vincular.',
        null,
        options
      );
    }

    if (cmd === '/status') {
      try {
        var authStatus = TelegramAuthService.getAuthorizedUserByTelegramId(telegramUserId);
        return sendTelegramReply(
          telegramChatId,
          '✅ Status do vínculo: ATIVO\nUsuário vinculado: ' + authStatus.usuario.nome + '\nSituação da conta: ' + authStatus.usuario.status +
          '\n\nVocê já pode enviar mensagens de texto ou áudio (ex: "Almoço 35,00 no débito").',
          null,
          options
        );
      } catch (eNotAuth) {
        return sendTelegramReply(
          telegramChatId,
          '⚪ Status do vínculo: PENDENTE (Nenhum usuário vinculado a este Telegram).\n' +
          'Para conectar sua conta, envie o código gerado no sistema web (exemplo: /start FIN-XXXXXX).',
          null,
          options
        );
      }
    }

    if (cmd === '/ajuda') {
      var ajudaLines = [
        '✨ *CENTRAL DE AJUDA — FINANÇAS INTELIGENTES*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Seu assistente financeiro pessoal integrado a todos os módulos do sistema.',
        '',
        '📱 *Comandos de Consulta:*',
        '• /menu - Painel com botões interativos',
        '• /saldo - Saldos consolidados e por conta bancária',
        '• /faturas - Faturas de cartões, limites e melhor dia de compra',
        '• /contas - Contas a vencer nos próximos 7 dias e vencidas',
        '• /resumo - Balanço de receitas vs. despesas pagas do mês',
        '• /metas - Progresso de metas e reserva de emergência',
        '• /dividas - Resumo de dívidas, acordos e empréstimos',
        '• /investimentos - Patrimônio investido e rentabilidade',
        '• /extrato - Últimos lançamentos registrados no mês',
        '• /oraculo [pergunta] - Consultoria e diagnóstico financeiro IA',
        '• /status - Situação do vínculo e usuário conectado',
        '• /cancelar - Cancelar proposta de lançamento pendente',
        '• /desvincular - Revogar conexão deste Telegram',
        '',
        '✍️ *Como Lançar Despesas e Entradas:*',
        'Envie uma mensagem em linguagem natural:',
        '• _"Almoço 38,50 no débito"_',
        '• _"Mercado 154,20 no Pix Santander"_',
        '• _"Recebi 3500 de salário no Itaú"_',
        '• _"Conta de luz 180 vencendo dia 25"_',
        '',
        '🎙️ *Mensagens de Áudio:*',
        'Envie um áudio como _"Gastei 45 reais na farmácia no Pix"_ e a IA transcreve e categoriza.',
        '',
        '📸 *Foto de Cupom ou Comprovante:*',
        'Envie a foto de um cupom fiscal ou nota para leitura óptica com OCR inteligente.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ];
      return sendTelegramReply(
        telegramChatId,
        ajudaLines.join('\n'),
        { inline_keyboard: [[{ text: '« Abrir Menu Principal', callback_data: 'MENU_MAIN' }]] },
        options
      );
    }

    // Comandos que exigem usuário já autenticado e vinculado
    var authInfo = null;
    try {
      authInfo = TelegramAuthService.getAuthorizedUserByTelegramId(telegramUserId);
    } catch (eAuth) {
      return sendTelegramReply(
        telegramChatId,
        '⚠️ Seu Telegram ainda não está vinculado ao Finanças Inteligentes.\n\n' +
        'Acesse o sistema web, gere seu código temporário e envie aqui (exemplo: /start FIN-XXXXXX).',
        null,
        options
      );
    }
    var user = authInfo.usuario;

    if (cmd === '/menu') {
      return sendTelegramReply(telegramChatId, formatMainMenu(user), buildMainMenuKeyboard(), options);
    }

    if (cmd === '/saldo') {
      return sendTelegramReply(telegramChatId, formatSaldosResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/faturas' || cmd === '/cartoes' || cmd === '/cartao') {
      return sendTelegramReply(telegramChatId, formatFaturasResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/contas' || cmd === '/vencimentos') {
      return sendTelegramReply(telegramChatId, formatContasResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/resumo' || cmd === '/mes') {
      return sendTelegramReply(telegramChatId, formatResumoResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/metas' || cmd === '/reserva') {
      return sendTelegramReply(telegramChatId, formatMetasResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/dividas' || cmd === '/emprestimos') {
      return sendTelegramReply(telegramChatId, formatDividasResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/investimentos' || cmd === '/carteira') {
      return sendTelegramReply(telegramChatId, formatInvestimentosResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/extrato' || cmd === '/lancamentos') {
      return sendTelegramReply(telegramChatId, formatExtratoResponse(user), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/oraculo') {
      sendChatAction(telegramChatId, 'typing', options);
      var queryPrompt = trimmed.replace(/^\/oraculo(@\w+)?\s*/i, '').trim();
      return sendTelegramReply(telegramChatId, formatOraculoResponse(user, queryPrompt), { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] }, options);
    }

    if (cmd === '/desvincular') {
      TelegramAuthService.revokeTelegramLink(user);
      return sendTelegramReply(
        telegramChatId,
        'Seu vínculo com o Telegram foi revogado com segurança. Para vincular novamente, gere um novo código no sistema web.',
        null,
        options
      );
    }

    if (cmd === '/cancelar') {
      var activeProcs = SpreadsheetRepository.findByGrupo('TELEGRAM_PROCESSAMENTOS', user.grupo_id, function (p) {
        return (
          p.usuario_id === user.id &&
          (p.estado === 'AGUARDANDO_CONFIRMACAO' || p.estado === 'PENDENTE_DE_INFORMACAO')
        );
      });
      for (var i = 0; i < activeProcs.length; i++) {
        TelegramLaunchService.cancelProposal(user, activeProcs[i].id);
      }
      return sendTelegramReply(
        telegramChatId,
        activeProcs.length > 0
          ? 'Proposta(s) em andamento cancelada(s) com sucesso.'
          : 'Não há nenhuma proposta pendente para cancelar.',
        null,
        options
      );
    }

    return sendTelegramReply(
      telegramChatId,
      'Comando não reconhecido. Use /ajuda para consultar os comandos permitidos.',
      null,
      options
    );
  }

  function handleCallbackQuery(callbackQuery, updateId, options) {
    var fromId = callbackQuery.from && callbackQuery.from.id;
    var chatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
    var messageId = callbackQuery.message && callbackQuery.message.message_id;
    var queryId = callbackQuery.id;
    var data = String(callbackQuery.data || '');

    var authInfo = null;
    try {
      authInfo = TelegramAuthService.getAuthorizedUserByTelegramId(fromId);
    } catch (eAuth) {
      if (chatId) {
        try {
          authInfo = TelegramAuthService.getAuthorizedUserByTelegramId(chatId);
        } catch (e2) {}
      }
    }

    if (!authInfo || !authInfo.usuario) {
      if (queryId) {
        answerCallbackQuery(queryId, '⚠️ Usuário não vinculado ao sistema.', true, options);
      }
      return {
        status: 'RECUSADO',
        resposta_bot: sendTelegramReply(chatId, '⚠️ Sua conta do Telegram não está vinculada a um administrador autorizado.', null, options)
      };
    }

    var user = authInfo.usuario;
    var parts = data.split(':');
    var action = parts[0];
    var procId = parts[1];
    var extraParam = parts[2];

    if (action === 'APPROVE_USR') {
      if (!user || (user.papel !== 'OWNER' && user.papel !== 'ADMIN')) {
        if (queryId) {
          answerCallbackQuery(queryId, 'Apenas administradores podem aprovar usuários.', true, options);
        }
        return {
          status: 'RECUSADO',
          resposta_bot: sendTelegramReply(chatId, '⚠️ Apenas administradores podem aprovar novos usuários.', null, options)
        };
      }
      var targetUser = SpreadsheetRepository.findById('USUARIOS', procId);
      if (!targetUser) {
        if (queryId) {
          answerCallbackQuery(queryId, 'Usuário não encontrado.', true, options);
        }
        return {
          status: 'ERRO',
          resposta_bot: sendTelegramReply(chatId, '⚠️ Usuário não encontrado na base de dados.', null, options)
        };
      }

      // Executa a aprovação completa com vinculação ao grupo do administrador e disparo de e-mail
      UserService.changeUserAuthorization(user, targetUser.id, 'APROVADO', 'MEMBRO', user.grupo_id);

      if (queryId) {
        answerCallbackQuery(queryId, '✅ Acesso liberado para ' + (targetUser.nome || targetUser.email) + '!', false, options);
      }

      if (messageId && chatId) {
        editTelegramMessage(
          chatId,
          messageId,
          '✅ *CADASTRO APROVADO COM SUCESSO*\n\n' +
          '• *Nome:* ' + targetUser.nome + '\n' +
          '• *E-mail:* `' + targetUser.email + '`\n' +
          '• *Status:* 🟢 APROVADO por ' + (user.nome || 'Proprietário') + '\n\n' +
          'O acesso ao painel financeiro já está liberado!',
          null,
          options
        );
      } else {
        sendTelegramReply(
          chatId,
          '✅ *Usuário Aprovado com Sucesso!*\n\n' +
          '• *Nome:* ' + targetUser.nome + '\n' +
          '• *E-mail:* `' + targetUser.email + '`\n\n' +
          'O acesso ao painel web já está liberado.',
          null,
          options
        );
      }

      return {
        status: 'APROVADO',
        resposta_bot: 'Aprovado com sucesso'
      };
    }

    if (action === 'REJECT_USR') {
      if (!user || (user.papel !== 'OWNER' && user.papel !== 'ADMIN')) {
        if (queryId) {
          answerCallbackQuery(queryId, 'Apenas administradores podem gerenciar usuários.', true, options);
        }
        return {
          status: 'RECUSADO',
          resposta_bot: sendTelegramReply(chatId, '⚠️ Apenas administradores podem gerenciar usuários.', null, options)
        };
      }
      var targetUserToBlock = SpreadsheetRepository.findById('USUARIOS', procId);
      if (targetUserToBlock) {
        UserService.changeUserAuthorization(user, targetUserToBlock.id, 'BLOQUEADO', targetUserToBlock.papel, user.grupo_id);
      }
      if (queryId) {
        answerCallbackQuery(queryId, '❌ Solicitação recusada.', false, options);
      }
      if (messageId && chatId) {
        editTelegramMessage(
          chatId,
          messageId,
          '❌ *SOLICITAÇÃO DE ACESSO RECUSADA*\n\n' +
          '• *Nome:* ' + (targetUserToBlock ? targetUserToBlock.nome : '') + '\n' +
          '• *E-mail:* `' + (targetUserToBlock ? targetUserToBlock.email : '') + '`\n' +
          '• *Status:* 🔴 BLOQUEADO por ' + (user.nome || 'Proprietário'),
          null,
          options
        );
      } else {
        sendTelegramReply(
          chatId,
          '❌ *Solicitação Recusada.*\n\nO usuário `' + (targetUserToBlock ? targetUserToBlock.email : procId) + '` foi marcado como BLOQUEADO.',
          null,
          options
        );
      }
      return {
        status: 'BLOQUEADO',
        resposta_bot: 'Recusado com sucesso'
      };
    }

    if (action === 'CONFIRM') {
      if (queryId) {
        answerCallbackQuery(queryId, 'Confirmando lançamento...', false, options);
      }
      var confirmed = TelegramLaunchService.confirmProposal(user, procId, extraParam);
      var l = confirmed.lancamento;
      var isPrevisto = (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE');
      var tipoIcon = l.tipo === 'ENTRADA' ? '🟢 Receita' : '🔴 Despesa';
      var sitLabel = isPrevisto ? '⏳ Previsto (A vencer)' : '✅ Confirmado (Baixa no saldo)';
      var accName = '';
      try {
        var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', l.conta_bancaria_id, user.grupo_id);
        if (acc) accName = acc.nome_identificacao;
      } catch (eAcc) {}

      var receiptText = [
        '🧾 *COMPROVANTE DE LANÇAMENTO*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '✅ *Lançamento Registrado com Sucesso!*',
        '• *ID:* `' + l.id + '`',
        '• *Descrição:* ' + (l.descricao || 'Sem descrição'),
        '• *Valor:* ' + ValidationService.formatCentavosToBrl(l.valor_centavos) + '.',
        '• *Classificação:* ' + tipoIcon,
        '• *Data:* ' + ValidationService.formatDateBr(l.data_lancamento),
        '• *Conta:* ' + (accName || 'Padrão do Sistema'),
        '• *Situação:* ' + sitLabel,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '✨ _Saldo bancário e relatórios atualizados automaticamente._'
      ].join('\n');

      var respConfirm = null;
      if (messageId && chatId) {
        respConfirm = editTelegramMessage(chatId, messageId, receiptText, null, options);
      }
      if (!respConfirm) {
        respConfirm = sendTelegramReply(chatId, receiptText, null, options);
      }

      return {
        status: 'CONFIRMADO',
        idempotente_ja_confirmado: confirmed.idempotente_ja_confirmado,
        lancamento: confirmed.lancamento,
        resposta_bot: respConfirm
      };
    }

    if (action === 'CANCEL') {
      if (queryId) {
        answerCallbackQuery(queryId, 'Proposta cancelada.', false, options);
      }
      var canceled = TelegramLaunchService.cancelProposal(user, procId);
      var cancelText = '❌ *LANÇAMENTO CANCELADO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nEsta proposta de lançamento foi descartada e nenhum dado foi gravado na planilha.';
      var respCancel = null;
      if (messageId && chatId) {
        respCancel = editTelegramMessage(chatId, messageId, cancelText, null, options);
      }
      if (!respCancel) {
        respCancel = sendTelegramReply(chatId, cancelText, null, options);
      }
      return {
        status: 'CANCELADO',
        processamento: canceled,
        resposta_bot: respCancel
      };
    }

    if (action === 'MENU_MAIN') {
      if (queryId) answerCallbackQuery(queryId, 'Menu principal', false, options);
      var mText = formatMainMenu(user);
      var mKb = buildMainMenuKeyboard();
      var respM = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, mText, mKb, options)
        : sendTelegramReply(chatId, mText, mKb, options);
      return { status: 'MENU_EXIBIDO', resposta_bot: respM };
    }

    if (action === 'MENU_SALDO') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando saldos...', false, options);
      var sText = formatSaldosResponse(user);
      var backKbS = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respS = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, sText, backKbS, options)
        : sendTelegramReply(chatId, sText, backKbS, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'SALDO', resposta_bot: respS };
    }

    if (action === 'MENU_FATURAS') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando cartões...', false, options);
      var fText = formatFaturasResponse(user);
      var backKbF = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respF = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, fText, backKbF, options)
        : sendTelegramReply(chatId, fText, backKbF, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'FATURAS', resposta_bot: respF };
    }

    if (action === 'MENU_CONTAS') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando contas...', false, options);
      var cText = formatContasResponse(user);
      var backKbC = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respC = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, cText, backKbC, options)
        : sendTelegramReply(chatId, cText, backKbC, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'CONTAS', resposta_bot: respC };
    }

    if (action === 'MENU_RESUMO') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando balanço...', false, options);
      var rText = formatResumoResponse(user);
      var backKbR = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respR = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, rText, backKbR, options)
        : sendTelegramReply(chatId, rText, backKbR, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'RESUMO', resposta_bot: respR };
    }

    if (action === 'MENU_METAS') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando metas...', false, options);
      var gText = formatMetasResponse(user);
      var backKbG = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respG = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, gText, backKbG, options)
        : sendTelegramReply(chatId, gText, backKbG, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'METAS', resposta_bot: respG };
    }

    if (action === 'MENU_DIVIDAS') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando dívidas...', false, options);
      var dText = formatDividasResponse(user);
      var backKbD = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respD = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, dText, backKbD, options)
        : sendTelegramReply(chatId, dText, backKbD, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'DIVIDAS', resposta_bot: respD };
    }

    if (action === 'MENU_INVEST') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando investimentos...', false, options);
      var iText = formatInvestimentosResponse(user);
      var backKbI = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respI = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, iText, backKbI, options)
        : sendTelegramReply(chatId, iText, backKbI, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'INVESTIMENTOS', resposta_bot: respI };
    }

    if (action === 'MENU_EXTRATO') {
      if (queryId) answerCallbackQuery(queryId, 'Carregando extrato...', false, options);
      var eText = formatExtratoResponse(user);
      var backKbE = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respE = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, eText, backKbE, options)
        : sendTelegramReply(chatId, eText, backKbE, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'EXTRATO', resposta_bot: respE };
    }

    if (action === 'MENU_ORACULO') {
      if (queryId) answerCallbackQuery(queryId, 'Consultando Oráculo IA...', false, options);
      var oText = formatOraculoResponse(user);
      var backKbO = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respO = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, oText, backKbO, options)
        : sendTelegramReply(chatId, oText, backKbO, options);
      return { status: 'CONSULTA_PROCESSADA', tipo_consulta: 'ORACULO', resposta_bot: respO };
    }

    if (action === 'MENU_AJUDA') {
      if (queryId) answerCallbackQuery(queryId, 'Central de ajuda', false, options);
      var hText = [
        '✨ *CENTRAL DE AJUDA — FINANÇAS INTELIGENTES*',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '💡 *Dicas de Uso:*',
        '• Envie mensagens rápidas para registrar despesas: _"Farmácia 45 no Pix"_',
        '• Envie áudios para registrar lançamentos falados.',
        '• Tire fotos de comprovantes fiscais ou recibos.',
        '• Use os botões do menu ou comandos como /saldo, /faturas, /contas, /resumo, /metas, /oraculo.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n');
      var backKbH = { inline_keyboard: [[{ text: '« Voltar ao Menu Principal', callback_data: 'MENU_MAIN' }]] };
      var respH = (messageId && chatId)
        ? editTelegramMessage(chatId, messageId, hText, backKbH, options)
        : sendTelegramReply(chatId, hText, backKbH, options);
      return { status: 'AJUDA_EXIBIDA', resposta_bot: respH };
    }

    if (action === 'SETACC') {
      var edited = TelegramLaunchService.editProposalFields(user, procId, {
        conta_bancaria_id: extraParam
      });
      var kb = buildInlineKeyboardForProposal(user, edited.processamento, edited.dados_extraidos);
      return {
        status: edited.processamento.estado,
        processamento: edited.processamento,
        dados_extraidos: edited.dados_extraidos,
        resposta_bot: sendTelegramReply(chatId, edited.texto_previa, kb, options)
      };
    }

    if (action === 'SETTYPE') {
      var edited = TelegramLaunchService.editProposalFields(user, procId, {
        tipo: extraParam
      });
      var kb = buildInlineKeyboardForProposal(user, edited.processamento, edited.dados_extraidos);
      return {
        status: edited.processamento.estado,
        processamento: edited.processamento,
        dados_extraidos: edited.dados_extraidos,
        resposta_bot: sendTelegramReply(chatId, edited.texto_previa, kb, options)
      };
    }

    if (action === 'SETSTATUS') {
      var editedStatus = TelegramLaunchService.editProposalFields(user, procId, {
        situacao: extraParam
      });
      var kbStatus = editedStatus.processamento.estado === 'AGUARDANDO_CONFIRMACAO'
        ? buildConfirmationKeyboard(editedStatus.processamento)
        : null;
      return {
        status: editedStatus.processamento.estado,
        processamento: editedStatus.processamento,
        dados_extraidos: editedStatus.dados_extraidos,
        resposta_bot: sendTelegramReply(chatId, editedStatus.texto_previa, kbStatus, options)
      };
    }

    if (action === 'EDITMENU') {
      var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
        return a.situacao === 'ATIVA';
      });
      var inlineRows = [
        [
          { text: '🔴 Saída (Despesa)', callback_data: 'SETTYPE:' + procId + ':SAIDA' },
          { text: '🟢 Entrada (Receita)', callback_data: 'SETTYPE:' + procId + ':ENTRADA' }
        ],
        [
          { text: '⏳ Marcar A Vencer', callback_data: 'SETSTATUS:' + procId + ':PREVISTO' },
          { text: '✅ Marcar Já Pago', callback_data: 'SETSTATUS:' + procId + ':CONFIRMADO' }
        ]
      ];
      accounts.slice(0, 4).forEach(function (a) {
        inlineRows.push([{ text: 'Conta: ' + a.nome_identificacao, callback_data: 'SETACC:' + procId + ':' + a.id }]);
      });
      inlineRows.push([{ text: '❌ Cancelar proposta', callback_data: 'CANCEL:' + procId }]);
      return {
        status: 'EDITANDO',
        resposta_bot: sendTelegramReply(
          chatId,
          'Selecione abaixo para ajustar Tipo, Situação ou Conta, ou envie uma nova mensagem corrigida:',
          { inline_keyboard: inlineRows },
          options
        )
      };
    }

    throw new Error('Ação de callback desconhecida.');
  }

  /**
   * Processa uma atualização completa (update) recebida pelo Webhook do Telegram.
   */
  function handleWebhookUpdate(update, providedSecret, options) {
    TelegramAuthService.validateWebhookSecret(providedSecret);
    if (!update || typeof update !== 'object' || !update.update_id) {
      throw new Error('INVALID_TELEGRAM_UPDATE: Payload de atualização inválido.');
    }

    var opts = options || {};
    var updateId = update.update_id;

    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query, updateId, opts);
    }

    var msg = update.message || update.edited_message;
    if (!msg || !msg.from || !msg.chat) {
      return { status: 'IGNORADO', motivo: 'Sem mensagem de usuário' };
    }

    var telegramUserId = msg.from.id;
    var telegramChatId = msg.chat.id;
    var messageId = msg.message_id || updateId;

    // 1. Verifica comandos iniciados por "/" ou envio direto do código FIN-XXXXXX
    var rawText = msg.text ? String(msg.text).trim() : '';
    if (rawText) {
      var isCmd = rawText.charAt(0) === '/';
      var detectedToken = extractLinkingToken(rawText);
      if (isCmd || detectedToken) {
        var commandToRun = isCmd ? rawText : ('/start ' + detectedToken);
        var cmdReply = handleCommand(commandToRun, telegramUserId, telegramChatId, opts);
        return {
          status: 'COMANDO_PROCESSADO',
          resposta_bot: cmdReply
        };
      }
    }

    // 2. Exige vínculo autorizado para qualquer mensagem financeira de texto ou áudio
    var authInfo = TelegramAuthService.getAuthorizedUserByTelegramId(telegramUserId);
    var user = authInfo.usuario;

    // 3. Processa mensagem de voz ou arquivo de áudio
    if (msg.voice || msg.audio) {
      var audioMeta = msg.voice || msg.audio;
      try {
        var audioResult = TelegramAudioService.processAudioMessage(user, audioMeta, opts);
        var proposalAudio = TelegramLaunchService.createProposalFromUpdate(
          user,
          {
            telegram_update_id: updateId,
            telegram_message_id: messageId,
            telegram_chat_id: telegramChatId,
            tipo_entrada: 'AUDIO'
          },
          audioResult.extracted
        );
        var kbAudio = buildInlineKeyboardForProposal(user, proposalAudio.processamento, proposalAudio.dados_extraidos);
        return {
          status: proposalAudio.processamento.estado,
          idempotente_reutilizado: proposalAudio.idempotente_reutilizado,
          processamento: proposalAudio.processamento,
          dados_extraidos: proposalAudio.dados_extraidos,
          resposta_bot: sendTelegramReply(telegramChatId, proposalAudio.texto_previa, kbAudio, opts)
        };
      } catch (audioErr) {
        var errMsg = audioErr && audioErr.message ? audioErr.message : String(audioErr);
        AuditService.log({
          grupo_id: user.grupo_id,
          usuario_id: user.id,
          acao: 'TELEGRAM_AUDIO_RECUSADO_OU_FALHA',
          entidade: 'TELEGRAM_PROCESSAMENTOS',
          entidade_id: String(updateId),
          origem: 'TELEGRAM',
          detalhes: { erro: errMsg }
        });
        return {
          status: 'RECUSADO_OU_ERRO',
          erro: errMsg,
          resposta_bot: sendTelegramReply(telegramChatId, '⚠️ ' + errMsg, null, opts)
        };
      }
    }

    // 4. Processa foto de cupom fiscal / recibo / comprovante
    if ((msg.photo && msg.photo.length > 0) || (msg.document && msg.document.mime_type && msg.document.mime_type.indexOf('image/') === 0)) {
      try {
        var photoMeta = (msg.photo && msg.photo.length > 0)
          ? msg.photo[msg.photo.length - 1]
          : msg.document;

        var photoData = null;
        if (typeof opts.mockReceipt !== 'object') {
          photoData = TelegramAudioService.downloadTelegramFileInMemory(photoMeta.file_id, photoMeta.mime_type || 'image/jpeg', opts);
        }

        var receiptResult = GeminiService.extractReceiptFromImage(
          photoData ? photoData.base64 : '',
          photoData ? photoData.mimeType : 'image/jpeg',
          opts
        );
        photoData = null;

        var catDesc = TelegramParserService.suggestCategoryAndDescription(user, receiptResult.descricao + ' ' + (receiptResult.subcategoria_sugerida || ''), 'SAIDA');
        var accountMatch = TelegramParserService.matchBankAccount(user, receiptResult.descricao);

        var camposPendentes = [];
        if (!receiptResult.valor_centavos || receiptResult.valor_centavos <= 0) {
          camposPendentes.push('valor_centavos');
        }
        if (!accountMatch.conta_bancaria_id) {
          camposPendentes.push('conta_bancaria');
        }

        var extractedPhoto = {
          tipo: 'SAIDA',
          descricao: receiptResult.descricao || catDesc.descricao || 'Cupom Fiscal',
          valor_centavos: receiptResult.valor_centavos,
          data: receiptResult.data || SpreadsheetRepository.todayIso(),
          categoria_sugerida: catDesc.categoria_sugerida || receiptResult.categoria_sugerida,
          categoria_id: catDesc.categoria_id,
          subcategoria_sugerida: catDesc.subcategoria_sugerida || receiptResult.subcategoria_sugerida,
          subcategoria_id: catDesc.subcategoria_id,
          conta_bancaria_sugerida: accountMatch.conta_bancaria_sugerida,
          conta_bancaria_id: accountMatch.conta_bancaria_id,
          forma_pagamento: receiptResult.forma_pagamento || 'PIX',
          observacoes: 'Leitura automática de cupom fiscal / comprovante',
          campos_pendentes: camposPendentes,
          confianca: camposPendentes.length === 0 ? 'alta' : 'media'
        };

        var proposalPhoto = TelegramLaunchService.createProposalFromUpdate(
          user,
          {
            telegram_update_id: updateId,
            telegram_message_id: messageId,
            telegram_chat_id: telegramChatId,
            tipo_entrada: 'FOTO'
          },
          extractedPhoto
        );
        var kbPhoto = buildInlineKeyboardForProposal(user, proposalPhoto.processamento, proposalPhoto.dados_extraidos);
        return {
          status: proposalPhoto.processamento.estado,
          idempotente_reutilizado: proposalPhoto.idempotente_reutilizado,
          processamento: proposalPhoto.processamento,
          dados_extraidos: proposalPhoto.dados_extraidos,
          resposta_bot: sendTelegramReply(telegramChatId, proposalPhoto.texto_previa, kbPhoto, opts)
        };
      } catch (photoErr) {
        var errMsgP = photoErr && photoErr.message ? photoErr.message : String(photoErr);
        AuditService.log({
          grupo_id: user.grupo_id,
          usuario_id: user.id,
          acao: 'TELEGRAM_FOTO_RECUSADA_OU_FALHA',
          entidade: 'TELEGRAM_PROCESSAMENTOS',
          entidade_id: String(updateId),
          origem: 'TELEGRAM',
          detalhes: { erro: errMsgP }
        });
        return {
          status: 'RECUSADO_OU_ERRO',
          erro: errMsgP,
          resposta_bot: sendTelegramReply(telegramChatId, '⚠️ Falha ao ler cupom fiscal: ' + errMsgP, null, opts)
        };
      }
    }

    // 5. Processa mensagem de texto em linguagem natural
    if (msg.text) {
      var lower = String(msg.text).toLowerCase().trim();
      var backKb = { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] };

      // Identifica consultas conversacionais (evita tentar criar lançamentos para dúvidas de saldo, faturas, etc.)
      if (/^(qual|ver|consultar|meu)?\s*sald(o|os)\??$/i.test(lower) || lower === 'quanto tenho' || lower === 'saldo' || /^qual\s+(é\s+|e\s+)?o\s+meu\s+saldo\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'SALDO',
          resposta_bot: sendTelegramReply(telegramChatId, formatSaldosResponse(user), backKb, opts)
        };
      }

      if (/^(minhas?\s+)?faturas?\??$/i.test(lower) || /^(meus?\s+)?cart(o|õ)es\??$/i.test(lower) || /^(qual|ver|consultar)?\s*fatura\??$/i.test(lower) || /^limite\s+(do\s+)?cart(a|ã)o\??$/i.test(lower) || /^melhor\s+dia(\s+de\s+compra)?\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'FATURAS',
          resposta_bot: sendTelegramReply(telegramChatId, formatFaturasResponse(user), backKb, opts)
        };
      }

      if (/^contas?\s*(a\s*vencer|vencid|para\s*pagar|d(a|e)\s*semana)\??$/i.test(lower) || /^pr(o|ó)ximas?\s*contas?\??$/i.test(lower) || lower === 'contas' || lower === 'contas?' || /^o\s+que\s+tenho\s+(a|para)\s+pagar\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'CONTAS',
          resposta_bot: sendTelegramReply(telegramChatId, formatContasResponse(user), backKb, opts)
        };
      }

      if (/^quanto\s*(eu\s*)?gastei(\s+este\s+m(e|ê)s)?\??$/i.test(lower) || /^balan(c|ç)o(\s+do\s+m(e|ê)s)?\??$/i.test(lower) || /^resumo(\s+do\s+m(e|ê)s)?\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'RESUMO',
          resposta_bot: sendTelegramReply(telegramChatId, formatResumoResponse(user), backKb, opts)
        };
      }

      if (/^(minhas?\s+)?metas?\??$/i.test(lower) || /^(minha\s+)?reserva(\s+de\s+emerg(e|ê)ncia)?\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'METAS',
          resposta_bot: sendTelegramReply(telegramChatId, formatMetasResponse(user), backKb, opts)
        };
      }

      if (/^consultar\s*d(i|í)vida|^(minhas?\s+)?d(i|í)vidas?\??$/i.test(lower) || /^(meus?\s+)?empr(e|é)stimos?\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'DIVIDAS',
          resposta_bot: sendTelegramReply(telegramChatId, formatDividasResponse(user), backKb, opts)
        };
      }

      if (/^consultar\s*investimento|^(meus?\s+)?investimentos?\??$/i.test(lower) || /^(minha\s+)?carteira\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'INVESTIMENTOS',
          resposta_bot: sendTelegramReply(telegramChatId, formatInvestimentosResponse(user), backKb, opts)
        };
      }

      if (/^extrato\??$/i.test(lower) || /^(u|ú)ltimos?\s*lan(c|ç)amentos?\??$/i.test(lower)) {
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'EXTRATO',
          resposta_bot: sendTelegramReply(telegramChatId, formatExtratoResponse(user), backKb, opts)
        };
      }

      if (/^menu$/i.test(lower) || /^painel$/i.test(lower) || /^iniciar$/i.test(lower)) {
        return {
          status: 'MENU_EXIBIDO',
          resposta_bot: sendTelegramReply(telegramChatId, formatMainMenu(user), buildMainMenuKeyboard(), opts)
        };
      }

      if (/^or(a|á)culo/i.test(lower) || /^posso\s*(comprar|gastar)/i.test(lower) || /^como\s*est(a|ã)o\s*minhas\s*finan(c|ç)as\??$/i.test(lower)) {
        sendChatAction(telegramChatId, 'typing', opts);
        return {
          status: 'CONSULTA_PROCESSADA',
          tipo_consulta: 'ORACULO',
          resposta_bot: sendTelegramReply(telegramChatId, formatOraculoResponse(user, msg.text), backKb, opts)
        };
      }

      try {
        var extracted = TelegramParserService.parseNaturalLanguageLaunch(user, msg.text, {
          referenceDateIso: opts.referenceDateIso
        });
        var proposalText = TelegramLaunchService.createProposalFromUpdate(
          user,
          {
            telegram_update_id: updateId,
            telegram_message_id: messageId,
            telegram_chat_id: telegramChatId,
            tipo_entrada: 'TEXTO'
          },
          extracted
        );
        var kbText = buildInlineKeyboardForProposal(user, proposalText.processamento, proposalText.dados_extraidos);
        return {
          status: proposalText.processamento.estado,
          idempotente_reutilizado: proposalText.idempotente_reutilizado,
          processamento: proposalText.processamento,
          dados_extraidos: proposalText.dados_extraidos,
          resposta_bot: sendTelegramReply(telegramChatId, proposalText.texto_previa, kbText, opts)
        };
      } catch (textErr) {
        var tMsg = textErr && textErr.message ? textErr.message : String(textErr);
        var errCode = textErr.code || 'PARSE_ERROR';

        // Mantém bloqueio estrito de segurança quando o usuário tenta criar entidades proibidas via Telegram
        if (errCode === 'FORBIDDEN_SCOPE') {
          AuditService.log({
            grupo_id: user.grupo_id,
            usuario_id: user.id,
            acao: 'TELEGRAM_MENSAGEM_RECUSADA',
            entidade: 'TELEGRAM_PROCESSAMENTOS',
            entidade_id: String(updateId),
            origem: 'TELEGRAM',
            detalhes: { motivo: tMsg, codigo: errCode }
          });
          return {
            status: 'RECUSADO',
            codigo: errCode,
            erro: tMsg,
            resposta_bot: sendTelegramReply(telegramChatId, '🚫 ' + tMsg, null, opts)
          };
        }

        // Reconhecimento de consultas em linguagem natural (perguntas e comandos falados)
        var lower = msg.text.toLowerCase().trim();
        var backKb = { inline_keyboard: [[{ text: '« Menu Principal', callback_data: 'MENU_MAIN' }]] };

        if (/^(qual|ver|consultar|meu)?\s*sald(o|os)/i.test(lower) || lower === 'quanto tenho' || lower === 'saldo') {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'SALDO',
            resposta_bot: sendTelegramReply(telegramChatId, formatSaldosResponse(user), backKb, opts)
          };
        }

        if (/fatura|cart(a|ã)o|limite|melhor dia/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'FATURAS',
            resposta_bot: sendTelegramReply(telegramChatId, formatFaturasResponse(user), backKb, opts)
          };
        }

        if (/conta(s)?\s*(a\s*vencer|vencid|para\s*pagar|d(a|e)\s*semana)/i.test(lower) || /pr(o|ó)ximas?\s*contas?/i.test(lower) || lower === 'contas') {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'CONTAS',
            resposta_bot: sendTelegramReply(telegramChatId, formatContasResponse(user), backKb, opts)
          };
        }

        if (/quanto\s*(eu\s*)?gastei|balan(c|ç)o|resumo(\s*do\s*m(e|ê)s)?/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'RESUMO',
            resposta_bot: sendTelegramReply(telegramChatId, formatResumoResponse(user), backKb, opts)
          };
        }

        if (/meta(s)?|reserva/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'METAS',
            resposta_bot: sendTelegramReply(telegramChatId, formatMetasResponse(user), backKb, opts)
          };
        }

        if (/consultar\s*d(i|í)vida|minhas\s*d(i|í)vidas|meus\s*empr(e|é)stimos/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'DIVIDAS',
            resposta_bot: sendTelegramReply(telegramChatId, formatDividasResponse(user), backKb, opts)
          };
        }

        if (/consultar\s*investimento|meus\s*investimentos|minha\s*carteira/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'INVESTIMENTOS',
            resposta_bot: sendTelegramReply(telegramChatId, formatInvestimentosResponse(user), backKb, opts)
          };
        }

        if (/extrato|(u|ú)ltimos?\s*lan(c|ç)amento(s)?/i.test(lower)) {
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'EXTRATO',
            resposta_bot: sendTelegramReply(telegramChatId, formatExtratoResponse(user), backKb, opts)
          };
        }

        if (/^menu$/i.test(lower) || /^iniciar$/i.test(lower) || /^painel$/i.test(lower)) {
          return {
            status: 'MENU_EXIBIDO',
            resposta_bot: sendTelegramReply(telegramChatId, formatMainMenu(user), buildMainMenuKeyboard(), opts)
          };
        }

        if (/^or(a|á)culo/i.test(lower) || /posso\s*(comprar|gastar)/i.test(lower) || /como\s*est(a|ã)o\s*minhas\s*finan(c|ç)as/i.test(lower)) {
          sendChatAction(telegramChatId, 'typing', opts);
          return {
            status: 'CONSULTA_PROCESSADA',
            tipo_consulta: 'ORACULO',
            resposta_bot: sendTelegramReply(telegramChatId, formatOraculoResponse(user, msg.text), backKb, opts)
          };
        }

        AuditService.log({
          grupo_id: user.grupo_id,
          usuario_id: user.id,
          acao: 'TELEGRAM_MENSAGEM_RECUSADA',
          entidade: 'TELEGRAM_PROCESSAMENTOS',
          entidade_id: String(updateId),
          origem: 'TELEGRAM',
          detalhes: { motivo: tMsg, codigo: errCode }
        });
        return {
          status: 'RECUSADO',
          codigo: errCode,
          erro: tMsg,
          resposta_bot: sendTelegramReply(telegramChatId, '🚫 ' + tMsg + '\n\n💡 _Dica: Digite /menu para acessar o painel de consultas ou /ajuda para ver exemplos._', null, opts)
        };
      }
    }

    return {
      status: 'IGNORADO',
      motivo: 'Formato de mensagem não suportado'
    };
  }

  return {
    handleWebhookUpdate: handleWebhookUpdate,
    handleCommand: handleCommand,
    handleCallbackQuery: handleCallbackQuery,
    buildInlineKeyboardForProposal: buildInlineKeyboardForProposal,
    buildMainMenuKeyboard: buildMainMenuKeyboard,
    formatMainMenu: formatMainMenu,
    formatSaldosResponse: formatSaldosResponse,
    formatFaturasResponse: formatFaturasResponse,
    formatContasResponse: formatContasResponse,
    formatResumoResponse: formatResumoResponse,
    formatMetasResponse: formatMetasResponse,
    formatDividasResponse: formatDividasResponse,
    formatInvestimentosResponse: formatInvestimentosResponse,
    formatExtratoResponse: formatExtratoResponse,
    formatOraculoResponse: formatOraculoResponse,
    notifyChat: function (chatId, text) {
      return sendTelegramReply(chatId, text, null, { sendRealTelegramMessages: true });
    }
  };
})();

