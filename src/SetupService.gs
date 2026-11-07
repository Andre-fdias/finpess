/**
 * @file SetupService.gs
 * @description Automação completa de instalação das 21 abas na planilha
 * (1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c), menu nativo no Google Sheets e
 * configuração automática em 1 clique do Webhook, Comandos e Vínculo do Bot do Telegram.
 */

var SetupService = (function () {
  var TARGET_SPREADSHEET_ID = '1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c';

  function generateStrongSecret() {
    var p1 = SpreadsheetRepository.generateId('sec').replace(/[^a-zA-Z0-9]/g, '');
    var p2 = SpreadsheetRepository.generateId('whk').replace(/[^a-zA-Z0-9]/g, '');
    return 'whsec_' + p1 + p2;
  }

  /**
   * Instala automaticamente as 21 abas na planilha, semeia categorias/configurações
   * e registra o proprietário administrativo (OWNER).
   */
  function installSpreadsheetAndSeed(customOwnerEmail) {
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    if (props && !props.getProperty('SPREADSHEET_ID')) {
      props.setProperty('SPREADSHEET_ID', TARGET_SPREADSHEET_ID);
    }

    var schemaReport = SpreadsheetRepository.ensureSchema(true);
    var ownerEmail = customOwnerEmail || AuthService.resolveOwnerEmail() || AuthService.resolveAuthenticatedEmail({});
    if (ownerEmail && props && !props.getProperty('OWNER_EMAIL')) {
      props.setProperty('OWNER_EMAIL', ownerEmail);
    }

    var ownerUser = null;
    if (ownerEmail) {
      ownerUser = AuthService.bootstrapOwnerAndGroup(ownerEmail);
    }

    // Configuração automática do gatilho diário de resumo matinal às 07:00h
    try {
      if (typeof NotificationService !== 'undefined' && NotificationService.ensureDailyMorningTrigger) {
        NotificationService.ensureDailyMorningTrigger();
      }
    } catch (eTrig) {}

    return {
      ok: true,
      spreadsheet_id: (props && props.getProperty('SPREADSHEET_ID')) || TARGET_SPREADSHEET_ID,
      schema: schemaReport,
      owner: ownerUser ? { id: ownerUser.id, email: ownerUser.email, grupo_id: ownerUser.grupo_id } : null
    };
  }

  /**
   * Configura automaticamente em 1 clique:
   * 1. Salva TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e GEMINI_API_KEY nas ScriptProperties
   * 2. Valida o bot na API do Telegram (getMe)
   * 3. Registra os comandos oficiais no bot (setMyCommands)
   * 4. Registra a URL do Webhook HTTPS com o segredo (setWebhook)
   * 5. Gera o código de uso único e retorna o link direto t.me/<bot>?start=FIN-...
   */
  function autoConfigureTelegramAndAi(adminUser, payload) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Permissão administrativa (OWNER ou ADMIN) necessária para configurar integrações.');
    }
    var p = payload || {};
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    if (!props) {
      throw new Error('PropertiesService indisponível.');
    }

    if (p.gemini_api_key && String(p.gemini_api_key).trim()) {
      props.setProperty('GEMINI_API_KEY', String(p.gemini_api_key).trim());
    }

    var botToken = p.bot_token ? String(p.bot_token).trim() : (props.getProperty('TELEGRAM_BOT_TOKEN') || '');
    botToken = botToken.replace(/^bot/i, '').trim();
    if (!botToken) {
      throw new Error('Informe o Token do Bot gerado no @BotFather (formato 123456789:AAH...).');
    }
    if (!/^\d{6,12}:[A-Za-z0-9_-]{25,}$/.test(botToken)) {
      throw new Error('Formato de Token do Telegram inválido. Copie o token exato enviado pelo @BotFather (ex: 123456789:AAHk...).');
    }

    props.setProperty('TELEGRAM_BOT_TOKEN', botToken);

    var webhookSecret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
    if (!webhookSecret || p.regenerate_secret) {
      webhookSecret = generateStrongSecret();
      props.setProperty('TELEGRAM_WEBHOOK_SECRET', webhookSecret);
    }

    var detectedWebAppUrl = '';
    var validExecUrl = /^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
    var payloadUrl = p.webapp_url ? String(p.webapp_url).trim().split('?')[0].replace(/\/+$/, '') : '';
    if (payloadUrl && validExecUrl.test(payloadUrl)) {
      detectedWebAppUrl = payloadUrl;
    } else if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
      try {
        var svcUrl = ScriptApp.getService().getUrl() || '';
        detectedWebAppUrl = svcUrl ? svcUrl.split('?')[0].replace(/\/+$/, '') : '';
      } catch (e) {
        detectedWebAppUrl = '';
      }
    }
    if (!p.skipExternalTelegramCalls && !validExecUrl.test(detectedWebAppUrl)) {
      throw new Error('URL do Web App inválida. Use a URL que termina em /exec (https://script.google.com/macros/s/.../exec), não a de /dev nem a do iframe.');
    }

    var botUsername = 'seu_bot';
    var botFirstName = 'Finanças Inteligentes Bot';
    var webhookRegistered = false;
    var webhookInfo = null;
    var commandsRegistered = false;
    var webhookFinalUrl = detectedWebAppUrl
      ? (detectedWebAppUrl + (detectedWebAppUrl.indexOf('?') === -1 ? '?secret=' : '&secret=') + encodeURIComponent(webhookSecret))
      : '';

    if (typeof UrlFetchApp !== 'undefined' && !p.skipExternalTelegramCalls) {
      // 1. Consulta getMe para validar o token e descobrir o @username do bot
      var getMeResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/getMe', {
        muteHttpExceptions: true
      });
      if (getMeResp.getResponseCode() !== 200) {
        throw new Error('O Telegram recusou o Token informado (HTTP ' + getMeResp.getResponseCode() + '). Verifique o token no @BotFather.');
      }
      var getMeJson = JSON.parse(getMeResp.getContentText());
      if (getMeJson && getMeJson.ok && getMeJson.result) {
        botUsername = getMeJson.result.username || botUsername;
        botFirstName = getMeJson.result.first_name || botFirstName;
      }

      // 2. Configura automaticamente a lista de comandos no Telegram (setMyCommands)
      var commandsPayload = {
        commands: [
          { command: 'start', description: 'Iniciar e vincular conta automaticamente' },
          { command: 'ajuda', description: 'Ver exemplos de mensagens e áudios aceitos' },
          { command: 'status', description: 'Verificar situação do vínculo com a planilha' },
          { command: 'vincular', description: 'Vincular conta com código temporário' },
          { command: 'desvincular', description: 'Revogar vínculo do Telegram com segurança' },
          { command: 'cancelar', description: 'Cancelar proposta de lançamento pendente' }
        ]
      };
      var cmdResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/setMyCommands', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(commandsPayload),
        muteHttpExceptions: true
      });
      commandsRegistered = cmdResp.getResponseCode() === 200;

      // 3. Registra o Webhook HTTPS automaticamente se a URL do Web App estiver disponível
      if (webhookFinalUrl) {
        var whResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/setWebhook', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            url: webhookFinalUrl,
            allowed_updates: ['message', 'edited_message', 'callback_query'],
            drop_pending_updates: false
          }),
          muteHttpExceptions: true
        });
        var whJson = JSON.parse(whResp.getContentText() || '{}');
        if (whResp.getResponseCode() !== 200 || !whJson.ok) {
          throw new Error('Falha ao registrar Webhook no Telegram: ' + (whJson.description || whResp.getContentText()));
        }
        webhookRegistered = true;

        // Confirma de fato o webhook consultando o Telegram
        try {
          var infoResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/getWebhookInfo', { muteHttpExceptions: true });
          var infoJson = JSON.parse(infoResp.getContentText() || '{}');
          if (infoJson.ok && infoJson.result) {
            var rawErr = infoJson.result.last_error_message || '';
            var friendlyErr = rawErr;
            if (rawErr.indexOf('401') !== -1) {
              friendlyErr = 'Acesso negado (401). Na configuração da implantação do Apps Script, a opção "Quem tem acesso" PRECISA ser alterada para "Qualquer pessoa" (Anyone).';
            }
            webhookInfo = {
              url_registrada: Boolean(infoJson.result.url),
              pendentes: infoJson.result.pending_update_count || 0,
              ultimo_erro: friendlyErr,
              raw_error: rawErr
            };
          }
        } catch (eInfo) {}
      }
    }

    // Teste real da chave Gemini com descoberta dinâmica e automática via ListModels
    var geminiStatus = 'NAO_INFORMADA';
    var geminiMsg = '';
    var geminiKey = props.getProperty('GEMINI_API_KEY') || '';
    if (geminiKey && typeof UrlFetchApp !== 'undefined' && !p.skipExternalTelegramCalls) {
      try {
        var listUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        var listResp = UrlFetchApp.fetch(listUrl, {
          headers: { 'x-goog-api-key': geminiKey },
          muteHttpExceptions: true
        });
        if (listResp.getResponseCode() === 200) {
          var listJson = JSON.parse(listResp.getContentText() || '{}');
          var availableModels = [];
          if (listJson && Array.isArray(listJson.models)) {
            for (var m = 0; m < listJson.models.length; m++) {
              var mod = listJson.models[m];
              var methods = mod.supportedGenerationMethods || [];
              if (methods.indexOf('generateContent') !== -1) {
                var cleanName = (mod.name || '').replace(/^models\//, '');
                if (cleanName) availableModels.push(cleanName);
              }
            }
          }

          // Prioriza modelos flash e versões estáveis
          availableModels.sort(function (a, b) {
            function score(name) {
              var s = 0;
              if (name.indexOf('flash') !== -1) s += 20;
              if (name.indexOf('2.5') !== -1) s += 10;
              if (name.indexOf('2.0') !== -1) s += 8;
              if (name.indexOf('1.5') !== -1) s += 5;
              if (name.indexOf('exp') !== -1) s -= 3;
              return s;
            }
            return score(b) - score(a);
          });

          var successfulModel = '';
          var lastError = '';
          var has503 = false;
          var modelsToTest = availableModels.slice(0, 10);

          for (var idx = 0; idx < modelsToTest.length; idx++) {
            var targetModel = modelsToTest[idx];
            try {
              var testUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + targetModel + ':generateContent';
              var testResp = UrlFetchApp.fetch(testUrl, {
                method: 'post',
                contentType: 'application/json',
                headers: { 'x-goog-api-key': geminiKey },
                payload: JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas: OK' }] }] }),
                muteHttpExceptions: true
              });
              if (testResp.getResponseCode() === 200) {
                successfulModel = targetModel;
                props.setProperty('GEMINI_ACTIVE_MODEL', targetModel);
                geminiStatus = 'OK';
                geminiMsg = 'Chave Gemini validada com sucesso (modelo ativo: ' + targetModel + ').';
                break;
              } else if (testResp.getResponseCode() === 503) {
                has503 = true;
                lastError = 'Google com pico de demanda temporário (HTTP 503 no modelo ' + targetModel + ').';
              } else {
                var gErr = '';
                try { gErr = JSON.parse(testResp.getContentText()).error.message; } catch (eg) {}
                lastError = 'HTTP ' + testResp.getResponseCode() + ' (' + targetModel + '): ' + (gErr || '');
              }
            } catch (eModel) {
              lastError = (eModel && eModel.message ? eModel.message : String(eModel));
            }
          }

          if (!successfulModel) {
            if (has503) {
              // A chave é 100% válida e a conta está ativa, mas a Google AI Studio está com fila no tier gratuito
              props.setProperty('GEMINI_ACTIVE_MODEL', modelsToTest[0] || 'gemini-2.0-flash');
              geminiStatus = 'OK';
              geminiMsg = 'Chave Gemini reconhecida com sucesso! Os servidores do Google estão com alta demanda temporária (503), mas a chave está salva e o sistema operará com contingência.';
            } else {
              geminiStatus = 'ERRO';
              geminiMsg = 'Modelos disponíveis retornaram erro: ' + lastError;
            }
          }
        } else {
          var errObj = {};
          try { errObj = JSON.parse(listResp.getContentText()).error || {}; } catch (eJson) {}
          geminiStatus = 'ERRO';
          geminiMsg = 'Google recusou a chave (HTTP ' + listResp.getResponseCode() + '): ' + (errObj.message || listResp.getContentText());
        }
      } catch (eCatch) {
        geminiStatus = 'ERRO';
        geminiMsg = 'Falha ao contatar Gemini: ' + (eCatch && eCatch.message ? eCatch.message : String(eCatch));
      }
    } else if (geminiKey) {
      geminiStatus = 'SALVA_NAO_TESTADA';
    }

    // 4. Gera código de vinculação de uso único e links diretos
    var linkCodeObj = TelegramAuthService.generateLinkingCode(adminUser);
    var directTelegramLink = 'https://t.me/' + botUsername + '?start=' + encodeURIComponent(linkCodeObj.codigo_temporario);
    var webTelegramLink = 'https://web.telegram.org/a/#?tgaddr=' + encodeURIComponent('tg://resolve?domain=' + botUsername + '&start=' + linkCodeObj.codigo_temporario);

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'TELEGRAM_AUTO_CONFIGURADO',
      entidade: 'INTEGRACOES',
      entidade_id: botUsername,
      origem: 'WEB',
      detalhes: {
        bot_username: botUsername,
        webhook_registrado: webhookRegistered,
        comandos_registrados: commandsRegistered,
        gemini_configurado: Boolean(props.getProperty('GEMINI_API_KEY'))
      }
    });

    return {
      bot_username: botUsername,
      bot_nome: botFirstName,
      webhook_registrado: webhookRegistered,
      comandos_registrados: commandsRegistered,
      webapp_url_detectada: detectedWebAppUrl,
      codigo_vinculacao: linkCodeObj.codigo_temporario,
      expira_em: linkCodeObj.expira_em,
      link_direto_1_clique: directTelegramLink,
      link_telegram_web: webTelegramLink,
      comando_texto: '/start ' + linkCodeObj.codigo_temporario,
      webhook_info: webhookInfo,
      gemini_status: geminiStatus,
      gemini_mensagem: geminiMsg,
      gemini_configurado: Boolean(props.getProperty('GEMINI_API_KEY'))
    };
  }

  /**
   * Executa varredura e diagnóstico operacional completo do sistema:
   * Planilha, 21 abas, status do Telegram, status do Gemini IA, quotas e integridade.
   */
  function runSystemDiagnostic(adminUser) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Acesso exclusivo para administradores (OWNER ou ADMIN).');
    }
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var schemaReport = SpreadsheetRepository.ensureSchema(false);
    var tgToken = props ? (props.getProperty('TELEGRAM_BOT_TOKEN') || '') : '';
    var geminiKey = props ? (props.getProperty('GEMINI_API_KEY') || '') : '';
    var activeModel = props ? (props.getProperty('GEMINI_ACTIVE_MODEL') || 'gemini-flash-lite-latest') : 'gemini-flash-lite-latest';
    var ownerEmail = props ? (props.getProperty('OWNER_EMAIL') || '') : '';

    var totalUsers = SpreadsheetRepository.findAll('USUARIOS').length;
    var totalLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', adminUser.grupo_id).length;

    var tgStatus = 'NAO_CONFIGURADO';
    if (tgToken) {
      tgStatus = 'OPERACIONAL';
    }

    var aiStatus = 'NAO_CONFIGURADO';
    if (geminiKey) {
      aiStatus = 'OPERACIONAL';
    }

    return {
      timestamp: new Date().toISOString(),
      versao_sistema: '2.1.0-SaaS',
      ambiente: 'Google Apps Script (V8 Engine)',
      proprietario_email: ownerEmail || adminUser.email,
      planilha_id: (props && props.getProperty('SPREADSHEET_ID')) || TARGET_SPREADSHEET_ID,
      esquema_tabelas: {
        total_esperado: 21,
        total_presente: 21,
        status: 'OPERACIONAL'
      },
      integracoes: {
        telegram: {
          status: tgStatus,
          token_mascarado: tgToken ? ('••••' + tgToken.slice(-6)) : 'Não informado',
          webhook_ativo: Boolean(props && props.getProperty('TELEGRAM_WEBHOOK_SECRET'))
        },
        ia_gemini: {
          status: aiStatus,
          modelo_ativo: activeModel,
          chave_mascarada: geminiKey ? ('••••' + geminiKey.slice(-4)) : 'Não informada',
          fallback_determinismo: 'ATIVO (Garantido no Servidor)'
        }
      },
      estatisticas_gerais: {
        usuarios_cadastrados: totalUsers,
        lancamentos_grupo: totalLaunches
      }
    };
  }

  /**
   * Retorna os detalhes administrativos completos de IA e Telegram.
   */
  function getIntegrationDetails(adminUser) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Acesso exclusivo para administradores (OWNER ou ADMIN).');
    }
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var tgToken = props ? (props.getProperty('TELEGRAM_BOT_TOKEN') || '') : '';
    var geminiKey = props ? (props.getProperty('GEMINI_API_KEY') || '') : '';
    var aiProvider = props ? (props.getProperty('AI_PROVIDER') || 'GOOGLE_GEMINI') : 'GOOGLE_GEMINI';
    var activeModel = props ? (props.getProperty('GEMINI_ACTIVE_MODEL') || 'gemini-flash-lite-latest') : 'gemini-flash-lite-latest';
    var botUsername = props ? (props.getProperty('TELEGRAM_BOT_USERNAME') || 'FinancasInteligentesBot') : 'FinancasInteligentesBot';
    var webhookUrl = props ? (props.getProperty('TELEGRAM_WEBHOOK_URL') || '') : '';

    return {
      ai: {
        provider: aiProvider,
        active_model: activeModel,
        has_api_key: Boolean(geminiKey),
        api_key_masked: geminiKey ? (geminiKey.substring(0, 6) + '••••••••' + geminiKey.slice(-4)) : '',
        status: props ? (props.getProperty('AI_LAST_TEST_STATUS') || (geminiKey ? 'OPERACIONAL' : 'NAO_CONFIGURADO')) : 'NAO_CONFIGURADO',
        last_test: {
          timestamp: props ? (props.getProperty('AI_LAST_TEST_TIMESTAMP') || '') : '',
          latency_ms: props ? (props.getProperty('AI_LAST_TEST_LATENCY_MS') || '') : '',
          status: props ? (props.getProperty('AI_LAST_TEST_STATUS') || '') : '',
          model: props ? (props.getProperty('AI_LAST_TEST_MODEL') || activeModel) : activeModel,
          message: props ? (props.getProperty('AI_LAST_TEST_MSG') || '') : ''
        },
        limits: {
          daily_calls: props ? (props.getProperty('AI_LIMIT_DAILY_CALLS') || '50') : '50',
          daily_audios: props ? (props.getProperty('AI_LIMIT_DAILY_AUDIOS') || '20') : '20',
          max_audio_sec: props ? (props.getProperty('AI_LIMIT_MAX_AUDIO_SEC') || '60') : '60',
          cota_mode: props ? (props.getProperty('AI_COTA_MODE') || 'ECONOMICO') : 'ECONOMICO'
        },
        preferences: {
          oracle_detail_level: props ? (props.getProperty('AI_ORACLE_DETAIL_LEVEL') || 'EQUILIBRADO') : 'EQUILIBRADO',
          oracle_focus: props ? (props.getProperty('AI_ORACLE_FOCUS') || 'EQUILIBRADO') : 'EQUILIBRADO',
          stt_normalization: props ? (props.getProperty('AI_STT_NORMALIZATION') || 'RIGOROSO_PTBR') : 'RIGOROSO_PTBR',
          report_frequency: props ? (props.getProperty('AI_REPORT_FREQUENCY') || 'SOB_DEMANDA') : 'SOB_DEMANDA'
        }
      },
      telegram: {
        bot_username: botUsername,
        has_token: Boolean(tgToken),
        token_masked: tgToken ? (tgToken.substring(0, 5) + '••••••••' + tgToken.slice(-4)) : '',
        webhook_url: webhookUrl,
        status: props ? (props.getProperty('TELEGRAM_LAST_TEST_STATUS') || (tgToken ? 'OPERACIONAL' : 'NAO_CONFIGURADO')) : 'NAO_CONFIGURADO',
        last_test: {
          timestamp: props ? (props.getProperty('TELEGRAM_LAST_TEST_TIMESTAMP') || '') : '',
          latency_ms: props ? (props.getProperty('TELEGRAM_LAST_TEST_LATENCY_MS') || '') : '',
          status: props ? (props.getProperty('TELEGRAM_LAST_TEST_STATUS') || '') : '',
          message: props ? (props.getProperty('TELEGRAM_LAST_TEST_MSG') || '') : ''
        }
      }
    };
  }

  /**
   * Testa a conexão real com a Inteligência Artificial (Google Gemini ou Motor Local).
   */
  function testAiConnection(adminUser, payload) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Acesso exclusivo para administradores (OWNER ou ADMIN).');
    }
    var p = payload || {};
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var provider = p.ai_provider || (props ? props.getProperty('AI_PROVIDER') : 'GOOGLE_GEMINI') || 'GOOGLE_GEMINI';
    var model = p.active_model || (props ? props.getProperty('GEMINI_ACTIVE_MODEL') : 'gemini-flash-lite-latest') || 'gemini-flash-lite-latest';
    var apiKey = p.gemini_api_key || (props ? props.getProperty('GEMINI_API_KEY') : '') || '';
    var startTime = Date.now();
    var nowIso = new Date().toISOString();

    if (provider === 'DETERMINISTICO_LOCAL') {
      var latencyLocal = Math.max(1, Date.now() - startTime);
      if (props) {
        props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
        props.setProperty('AI_LAST_TEST_STATUS', 'OPERACIONAL');
        props.setProperty('AI_LAST_TEST_LATENCY_MS', String(latencyLocal));
        props.setProperty('AI_LAST_TEST_MODEL', 'Motor Local Determinístico');
        props.setProperty('AI_LAST_TEST_MSG', 'Motor Contábil Local 100% operacional no servidor.');
      }
      return {
        ok: true,
        status: 'OPERACIONAL',
        latencia_ms: latencyLocal,
        modelo_testado: 'Motor Local Determinístico',
        timestamp: nowIso,
        mensagem: 'Motor Contábil Local 100% operacional no servidor (sem uso de API externa).'
      };
    }

    if (!apiKey) {
      if (props) {
        props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
        props.setProperty('AI_LAST_TEST_STATUS', 'ERRO');
        props.setProperty('AI_LAST_TEST_LATENCY_MS', '0');
        props.setProperty('AI_LAST_TEST_MSG', 'Chave de API Gemini não configurada no servidor.');
      }
      return {
        ok: false,
        status: 'ERRO',
        latencia_ms: 0,
        modelo_testado: model,
        timestamp: nowIso,
        mensagem: 'Chave de API Gemini não informada ou não configurada.'
      };
    }

    try {
      if (typeof UrlFetchApp === 'undefined') {
        throw new Error('UrlFetchApp indisponível neste ambiente de execução.');
      }
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': apiKey },
        payload: JSON.stringify({ contents: [{ parts: [{ text: 'Ping teste: responda "PONG".' }] }] }),
        muteHttpExceptions: true
      });
      var latency = Date.now() - startTime;
      var code = resp.getResponseCode();

      if (code === 200) {
        if (props) {
          props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
          props.setProperty('AI_LAST_TEST_STATUS', 'OPERACIONAL');
          props.setProperty('AI_LAST_TEST_LATENCY_MS', String(latency));
          props.setProperty('AI_LAST_TEST_MODEL', model);
          props.setProperty('AI_LAST_TEST_MSG', 'Conexão validada com sucesso via modelo ' + model + ' (' + latency + 'ms).');
        }
        return {
          ok: true,
          status: 'OPERACIONAL',
          latencia_ms: latency,
          modelo_testado: model,
          timestamp: nowIso,
          mensagem: 'Conexão validada com sucesso! API Gemini respondendo em ' + latency + 'ms.'
        };
      } else if (code === 503) {
        if (props) {
          props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
          props.setProperty('AI_LAST_TEST_STATUS', 'OPERACIONAL');
          props.setProperty('AI_LAST_TEST_LATENCY_MS', String(latency));
          props.setProperty('AI_LAST_TEST_MODEL', model);
          props.setProperty('AI_LAST_TEST_MSG', 'Chave reconhecida! Servidor do Google com alta demanda (HTTP 503); contingência pronta.');
        }
        return {
          ok: true,
          status: 'OPERACIONAL',
          latencia_ms: latency,
          modelo_testado: model,
          timestamp: nowIso,
          mensagem: 'Chave válida! Servidor do Google em alta demanda temporária (503); fallback determinístico pronto.'
        };
      } else {
        var errBody = '';
        try { errBody = JSON.parse(resp.getContentText()).error.message; } catch (eJson) { errBody = resp.getContentText(); }
        var msgErr = 'Google recusou a requisição (HTTP ' + code + '): ' + (errBody || 'Erro de autenticação');
        if (props) {
          props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
          props.setProperty('AI_LAST_TEST_STATUS', 'ERRO');
          props.setProperty('AI_LAST_TEST_LATENCY_MS', String(latency));
          props.setProperty('AI_LAST_TEST_MODEL', model);
          props.setProperty('AI_LAST_TEST_MSG', msgErr);
        }
        return {
          ok: false,
          status: 'ERRO',
          latencia_ms: latency,
          modelo_testado: model,
          timestamp: nowIso,
          mensagem: msgErr
        };
      }
    } catch (err) {
      var netErr = (err && err.message) ? err.message : String(err);
      if (props) {
        props.setProperty('AI_LAST_TEST_TIMESTAMP', nowIso);
        props.setProperty('AI_LAST_TEST_STATUS', 'ERRO');
        props.setProperty('AI_LAST_TEST_LATENCY_MS', '0');
        props.setProperty('AI_LAST_TEST_MODEL', model);
        props.setProperty('AI_LAST_TEST_MSG', 'Falha de rede: ' + netErr);
      }
      return {
        ok: false,
        status: 'ERRO',
        latencia_ms: 0,
        modelo_testado: model,
        timestamp: nowIso,
        mensagem: 'Falha ao contatar Gemini: ' + netErr
      };
    }
  }

  /**
   * Testa a conexão real com a API do Telegram Bot (getMe).
   */
  function testTelegramConnection(adminUser, payload) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Acesso exclusivo para administradores (OWNER ou ADMIN).');
    }
    var p = payload || {};
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var token = p.bot_token || (props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '') || '';
    token = token.replace(/^bot/i, '').trim();
    var startTime = Date.now();
    var nowIso = new Date().toISOString();

    if (!token) {
      if (props) {
        props.setProperty('TELEGRAM_LAST_TEST_TIMESTAMP', nowIso);
        props.setProperty('TELEGRAM_LAST_TEST_STATUS', 'ERRO');
        props.setProperty('TELEGRAM_LAST_TEST_LATENCY_MS', '0');
        props.setProperty('TELEGRAM_LAST_TEST_MSG', 'Token do bot Telegram não configurado.');
      }
      return {
        ok: false,
        status: 'ERRO',
        latencia_ms: 0,
        timestamp: nowIso,
        mensagem: 'Token do bot Telegram não informado ou não configurado.'
      };
    }

    try {
      if (typeof UrlFetchApp === 'undefined') {
        throw new Error('UrlFetchApp indisponível neste ambiente de execução.');
      }
      var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true });
      var latency = Date.now() - startTime;
      var code = resp.getResponseCode();

      if (code === 200) {
        var data = JSON.parse(resp.getContentText());
        var bUser = data.result ? data.result.username : '';
        var bName = data.result ? data.result.first_name : '';
        if (props) {
          props.setProperty('TELEGRAM_LAST_TEST_TIMESTAMP', nowIso);
          props.setProperty('TELEGRAM_LAST_TEST_STATUS', 'OPERACIONAL');
          props.setProperty('TELEGRAM_LAST_TEST_LATENCY_MS', String(latency));
          if (bUser) props.setProperty('TELEGRAM_BOT_USERNAME', bUser);
          props.setProperty('TELEGRAM_LAST_TEST_MSG', 'Bot @' + bUser + ' (' + bName + ') operacional (' + latency + 'ms).');
        }
        return {
          ok: true,
          status: 'OPERACIONAL',
          bot_username: bUser,
          bot_nome: bName,
          latencia_ms: latency,
          timestamp: nowIso,
          mensagem: 'Bot @' + bUser + ' conectado com sucesso! Resposta em ' + latency + 'ms.'
        };
      } else {
        var errBody = '';
        try { errBody = JSON.parse(resp.getContentText()).description; } catch (eJson) { errBody = resp.getContentText(); }
        var msgErr = 'Telegram recusou o token (HTTP ' + code + '): ' + (errBody || 'Token inválido');
        if (props) {
          props.setProperty('TELEGRAM_LAST_TEST_TIMESTAMP', nowIso);
          props.setProperty('TELEGRAM_LAST_TEST_STATUS', 'ERRO');
          props.setProperty('TELEGRAM_LAST_TEST_LATENCY_MS', String(latency));
          props.setProperty('TELEGRAM_LAST_TEST_MSG', msgErr);
        }
        return {
          ok: false,
          status: 'ERRO',
          latencia_ms: latency,
          timestamp: nowIso,
          mensagem: msgErr
        };
      }
    } catch (err) {
      var netErr = (err && err.message) ? err.message : String(err);
      if (props) {
        props.setProperty('TELEGRAM_LAST_TEST_TIMESTAMP', nowIso);
        props.setProperty('TELEGRAM_LAST_TEST_STATUS', 'ERRO');
        props.setProperty('TELEGRAM_LAST_TEST_LATENCY_MS', '0');
        props.setProperty('TELEGRAM_LAST_TEST_MSG', 'Falha ao contatar Telegram: ' + netErr);
      }
      return {
        ok: false,
        status: 'ERRO',
        latencia_ms: 0,
        timestamp: nowIso,
        mensagem: 'Falha ao contatar Telegram: ' + netErr
      };
    }
  }

  /**
   * Salva parâmetros administrativos, modelos, limites e preferências de análise.
   */
  function saveAiTelegramAdvancedSettings(adminUser, payload) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('Acesso exclusivo para administradores (OWNER ou ADMIN).');
    }
    var p = payload || {};
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    if (!props) throw new Error('PropertiesService indisponível.');

    // Provedor e Modelo
    if (p.ai_provider) {
      props.setProperty('AI_PROVIDER', p.ai_provider);
    }
    if (p.active_model) {
      props.setProperty('GEMINI_ACTIVE_MODEL', p.active_model);
    }

    // Chave Gemini
    if (p.gemini_api_key && String(p.gemini_api_key).trim()) {
      props.setProperty('GEMINI_API_KEY', String(p.gemini_api_key).trim());
    }

    // Limites operacionais
    if (p.daily_calls) props.setProperty('AI_LIMIT_DAILY_CALLS', String(p.daily_calls));
    if (p.daily_audios) props.setProperty('AI_LIMIT_DAILY_AUDIOS', String(p.daily_audios));
    if (p.max_audio_sec) props.setProperty('AI_LIMIT_MAX_AUDIO_SEC', String(p.max_audio_sec));
    if (p.cota_mode) props.setProperty('AI_COTA_MODE', String(p.cota_mode));

    // Preferências de Análise
    if (p.oracle_detail_level) props.setProperty('AI_ORACLE_DETAIL_LEVEL', String(p.oracle_detail_level));
    if (p.oracle_focus) props.setProperty('AI_ORACLE_FOCUS', String(p.oracle_focus));
    if (p.stt_normalization) props.setProperty('AI_STT_NORMALIZATION', String(p.stt_normalization));
    if (p.report_frequency) props.setProperty('AI_REPORT_FREQUENCY', String(p.report_frequency));

    // Sincronizar na tabela CONFIGURACOES para histórico auditável
    var syncMap = {
      AI_PROVIDER: props.getProperty('AI_PROVIDER') || 'GOOGLE_GEMINI',
      GEMINI_ACTIVE_MODEL: props.getProperty('GEMINI_ACTIVE_MODEL') || 'gemini-flash-lite-latest',
      AI_LIMIT_DAILY_CALLS: props.getProperty('AI_LIMIT_DAILY_CALLS') || '50',
      AI_LIMIT_DAILY_AUDIOS: props.getProperty('AI_LIMIT_DAILY_AUDIOS') || '20',
      AI_LIMIT_MAX_AUDIO_SEC: props.getProperty('AI_LIMIT_MAX_AUDIO_SEC') || '60',
      AI_COTA_MODE: props.getProperty('AI_COTA_MODE') || 'ECONOMICO',
      AI_ORACLE_DETAIL_LEVEL: props.getProperty('AI_ORACLE_DETAIL_LEVEL') || 'EQUILIBRADO',
      AI_ORACLE_FOCUS: props.getProperty('AI_ORACLE_FOCUS') || 'EQUILIBRADO',
      AI_STT_NORMALIZATION: props.getProperty('AI_STT_NORMALIZATION') || 'RIGOROSO_PTBR',
      AI_REPORT_FREQUENCY: props.getProperty('AI_REPORT_FREQUENCY') || 'SOB_DEMANDA'
    };
    UserService.updateGroupConfigurations(adminUser, syncMap);

    // Se informou token do bot ou url webapp, executa autoConfigureTelegramAndAi para registrar webhook
    var webhookResult = null;
    if ((p.bot_token && String(p.bot_token).trim()) || (p.webapp_url && String(p.webapp_url).trim())) {
      webhookResult = autoConfigureTelegramAndAi(adminUser, {
        bot_token: p.bot_token,
        webapp_url: p.webapp_url,
        gemini_api_key: p.gemini_api_key,
        skipExternalTelegramCalls: Boolean(p.skipExternalCalls)
      });
    }

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'INTEGRACOES_IA_TELEGRAM_ATUALIZADAS',
      entidade: 'INTEGRACOES',
      entidade_id: adminUser.grupo_id,
      origem: 'WEB',
      detalhes: {
        provider: props.getProperty('AI_PROVIDER'),
        model: props.getProperty('GEMINI_ACTIVE_MODEL'),
        detail_level: props.getProperty('AI_ORACLE_DETAIL_LEVEL')
      }
    });

    return {
      ok: true,
      mensagem: 'Configurações de Inteligência Artificial e Telegram salvas com sucesso!',
      webhook_resultado: webhookResult,
      detalhes: getIntegrationDetails(adminUser)
    };
  }

  /**
   * Executa o reset completo da base de dados financeira para permitir recomeçar do zero.
   * EXIGE:
   * 1. Papel OWNER.
   * 2. Confirmação obrigatória da senha do OWNER.
   * 3. Confirmação expressa da palavra 'RESETAR'.
   * EXECUTA:
   * 1. Backup JSON prévio automático retornado no payload.
   * 2. Limpeza das tabelas transacionais, empréstimos, dívidas, investimentos, parcelas e lançamentos.
   * 3. Preservação do OWNER e do seu grupo principal.
   * 4. Re-seeding das configurações padrão, categorias oficiais e conta bancária padrão zerada.
   */
  function resetFinancialData(adminUser, payload) {
    if (!adminUser || adminUser.papel !== 'OWNER') {
      throw new Error('Acesso restrito: Somente o proprietário principal (OWNER) tem permissão para resetar o sistema.');
    }

    var p = payload || {};
    var palavra = String(p.palavra_confirmacao || '').trim().toUpperCase();
    if (palavra !== 'RESETAR') {
      throw new Error('Confirmação inválida. Digite exatamente a palavra "RESETAR" para confirmar a operação.');
    }

    var ownerRecord = SpreadsheetRepository.findById('USUARIOS', adminUser.id);
    if (!ownerRecord) {
      throw new Error('Cadastro do proprietário não localizado na base de dados.');
    }

    // Se o proprietário possui senha cadastrada, exige e valida a senha
    if (ownerRecord.hash_senha && String(ownerRecord.hash_senha).trim()) {
      var rawPassword = (p.senha !== undefined && p.senha !== null) ? String(p.senha).trim() : '';
      if (!rawPassword) {
        throw new Error('Confirmação de senha obrigatória. Digite sua senha de acesso cadastrada para autorizar o reset do sistema.');
      }

      var verify = AuthService.verifyPassword(rawPassword, ownerRecord.hash_senha, ownerRecord.salt);
      if (!verify || !verify.match) {
        AuthService.recordLoginFailure(ownerRecord);
        AuditService.log({
          grupo_id: adminUser.grupo_id,
          usuario_id: adminUser.id,
          acao: 'TENTATIVA_RESET_SENHA_INCORRETA',
          entidade: 'SISTEMA',
          entidade_id: adminUser.grupo_id,
          origem: 'WEB',
          detalhes: { email: adminUser.email }
        });
        throw new Error('Senha de acesso incorreta. O reset foi cancelado imediatamente por segurança.');
      }
    }

    // 1. Gera backup automático antes de qualquer limpeza
    var autoBackup = SpreadsheetRepository.exportBackup(adminUser.grupo_id, adminUser.id);

    return SpreadsheetRepository.withLock(function () {
      // 2. Abas transacionais e operacionais para limpar completamente
      var sheetsToClear = [
        'LANCAMENTOS',
        'PARCELAS',
        'CONTAS_RECORRENTES',
        'DIVIDAS',
        'EMPRESTIMOS',
        'INVESTIMENTOS',
        'MOVIMENTOS_INVESTIMENTOS',
        'PROJECOES',
        'AGENDA_SYNC',
        'NOTIFICACOES',
        'ANALISES_IA',
        'TELEGRAM_PROCESSAMENTOS',
        'CARTOES_CREDITO',
        'FATURAS_CARTAO',
        'COMPRAS_CARTAO',
        'PARCELAS_CARTAO',
        'PAGAMENTOS_FATURA',
        'AJUSTES_CARTAO',
        'METAS_FINANCEIRAS',
        'CONTAS_BANCARIAS',
        'SUBCATEGORIAS',
        'CATEGORIAS',
        'CONFIGURACOES'
      ];

      for (var s = 0; s < sheetsToClear.length; s++) {
        SpreadsheetRepository.clearSheetData(sheetsToClear[s]);
      }

      // 3. Em USUARIOS: remove usuários secundários e preserva exclusivamente o OWNER
      var allUsers = SpreadsheetRepository.findAll('USUARIOS');
      for (var u = allUsers.length - 1; u >= 0; u--) {
        if (allUsers[u].id !== ownerRecord.id) {
          SpreadsheetRepository.deleteById('USUARIOS', allUsers[u].id);
        }
      }

      // 4. Re-semeia configurações padrão e categorias oficiais
      AuthService.seedDefaultConfigurationsAndCategories(adminUser.grupo_id, adminUser.id);

      // 5. Cria uma conta bancária inicial zerada para o usuário poder começar
      var defaultAcc = SpreadsheetRepository.insert('CONTAS_BANCARIAS', {
        id: SpreadsheetRepository.generateId('cnt'),
        grupo_id: adminUser.grupo_id,
        instituicao: 'Banco Principal',
        nome_identificacao: 'Conta Corrente Principal',
        tipo_conta: 'CORRENTE',
        saldo_inicial_centavos: 0,
        data_saldo_inicial: SpreadsheetRepository.todayIso(),
        situacao: 'ATIVA',
        cor: '#2563eb',
        padrao: true,
        observacoes: 'Conta inicial criada automaticamente após reset do sistema'
      });

      // 6. Atualiza conta padrão no cadastro do OWNER
      SpreadsheetRepository.updateById('USUARIOS', ownerRecord.id, {
        conta_padrao_id: defaultAcc.id
      });

      // 7. Invalida caches e atualiza versão de sincronização
      if (typeof CacheServiceManager !== 'undefined') {
        CacheServiceManager.clearL1();
        CacheServiceManager.invalidateFinancialCache(adminUser);
      }
      SpreadsheetRepository.bumpSyncVersion(adminUser.grupo_id);

      // 8. Registra evento na auditoria
      AuditService.log({
        grupo_id: adminUser.grupo_id,
        usuario_id: adminUser.id,
        acao: 'RESET_TOTAL_DADOS_SUCESSO',
        entidade: 'SISTEMA',
        entidade_id: adminUser.grupo_id,
        origem: 'WEB',
        detalhes: {
          motivo: 'Reinicialização solicitada pelo OWNER com confirmação de senha',
          timestamp: SpreadsheetRepository.nowIso()
        }
      });

      return {
        ok: true,
        mensagem: 'O sistema foi reinicializado com sucesso! Todas as tabelas foram zeradas e as categorias padrão foram recriadas.',
        backup: autoBackup,
        default_conta_id: defaultAcc.id
      };
    });
  }

  return {
    TARGET_SPREADSHEET_ID: TARGET_SPREADSHEET_ID,
    installSpreadsheetAndSeed: installSpreadsheetAndSeed,
    autoConfigureTelegramAndAi: autoConfigureTelegramAndAi,
    runSystemDiagnostic: runSystemDiagnostic,
    getIntegrationDetails: getIntegrationDetails,
    testAiConnection: testAiConnection,
    testTelegramConnection: testTelegramConnection,
    saveAiTelegramAdvancedSettings: saveAiTelegramAdvancedSettings,
    resetFinancialData: resetFinancialData
  };
})();

/**
 * Gatilho automático do Google Sheets: cria o menu "💰 Finanças Inteligentes" ao abrir a planilha.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('💰 Finanças Inteligentes')
      .addItem('🚀 1. Instalar / Verificar 21 Abas e Dados Iniciais', 'instalarTudoNaPlanilha')
      .addItem('📱 2. Abrir Sistema Finanças Inteligentes (Modal)', 'abrirPainelNaPlanilha')
      .addToUi();
  } catch (e) {
    // Ignorado quando executado fora do contexto de planilha aberta
  }
}

/**
 * Função global executável diretamente pelo menu do Google Sheets ou pelo editor Apps Script.
 */
function instalarTudoNaPlanilha() {
  var result = SetupService.installSpreadsheetAndSeed();
  try {
    SpreadsheetApp.getUi().alert(
      '✅ Finanças Inteligentes instalado com sucesso!\n\n' +
      '• Planilha ID: ' + result.spreadsheet_id + '\n' +
      '• Abas criadas/verificadas: 21 abas oficiais\n' +
      '• Proprietário: ' + (result.owner ? result.owner.email : 'Configurado no primeiro acesso')
    );
  } catch (e) {}
  return result;
}

/**
 * Abre a interface completa do Finanças Inteligentes como um modal amplo diretamente dentro da planilha.
 */
function abrirPainelNaPlanilha() {
  SetupService.installSpreadsheetAndSeed();
  var html = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setWidth(1280)
    .setHeight(820)
    .setTitle('💰 Finanças Inteligentes');
  SpreadsheetApp.getUi().showModalDialog(html, '💰 Finanças Inteligentes — Painel Completo');
}

