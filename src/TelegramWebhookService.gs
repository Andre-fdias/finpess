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
    if (!chatId || !messageId) return;
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
      return sendTelegramReply(
        telegramChatId,
        'Exemplos aceitos (apenas Entradas e Saídas):\n' +
        '• "Recebi R$ 3.500 de salário"\n' +
        '• "Gastei R$ 42,90 no supermercado hoje"\n' +
        '• "Paguei R$ 120 de água"\n' +
        '• Áudio: "Hoje eu gastei quarenta e cinco reais e cinquenta centavos na farmácia, no Pix"\n\n' +
        'Nota: Contas recorrentes, contas bancárias, dívidas, empréstimos e investimentos são gerenciados exclusivamente pelo sistema web.',
        null,
        options
      );
    }

    // Comandos que exigem usuário já autenticado e vinculado
    var authInfo = TelegramAuthService.getAuthorizedUserByTelegramId(telegramUserId);
    var user = authInfo.usuario;

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
      var isPrevisto = (confirmed.lancamento.situacao === 'PREVISTO' || confirmed.lancamento.situacao === 'PENDENTE');
      var statusHeader = isPrevisto
        ? '⏳ Conta a vencer registrada com sucesso!\n'
        : '✅ Lançamento confirmado e gravado com sucesso!\n';
      return {
        status: 'CONFIRMADO',
        idempotente_ja_confirmado: confirmed.idempotente_ja_confirmado,
        lancamento: confirmed.lancamento,
        resposta_bot: sendTelegramReply(
          chatId,
          statusHeader +
          'ID: ' + confirmed.lancamento.id + '\n' +
          'Valor: ' + ValidationService.formatCentavosToBrl(confirmed.lancamento.valor_centavos),
          null,
          options
        )
      };
    }

    if (action === 'CANCEL') {
      if (queryId) {
        answerCallbackQuery(queryId, 'Proposta cancelada.', false, options);
      }
      var canceled = TelegramLaunchService.cancelProposal(user, procId);
      return {
        status: 'CANCELADO',
        processamento: canceled,
        resposta_bot: sendTelegramReply(chatId, '❌ Proposta de lançamento cancelada. Nenhum dado foi gravado.', null, options)
      };
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
        AuditService.log({
          grupo_id: user.grupo_id,
          usuario_id: user.id,
          acao: 'TELEGRAM_MENSAGEM_RECUSADA',
          entidade: 'TELEGRAM_PROCESSAMENTOS',
          entidade_id: String(updateId),
          origem: 'TELEGRAM',
          detalhes: { motivo: tMsg, codigo: textErr.code || 'PARSE_ERROR' }
        });
        return {
          status: 'RECUSADO',
          codigo: textErr.code || 'PARSE_ERROR',
          erro: tMsg,
          resposta_bot: sendTelegramReply(telegramChatId, '🚫 ' + tMsg, null, opts)
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
    buildInlineKeyboardForProposal: buildInlineKeyboardForProposal,
    notifyChat: function (chatId, text) {
      return sendTelegramReply(chatId, text, null, { sendRealTelegramMessages: true });
    }
  };
})();

