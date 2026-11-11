/**
 * @file Code.gs
 * @description Ponto de entrada principal do Google Apps Script Web App (doGet, doPost),
 * inclusão modular de templates HTML e despachante RPC seguro (apiCall) com validação
 * centralizada de autenticação e autorização no servidor.
 */

function doGet(e) {
  // Retorna manifest.json do PWA se solicitado por parâmetro
  if (e && e.parameter && (e.parameter.manifest === '1' || e.parameter.pwa === 'manifest')) {
    var iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#059669"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs><rect width="512" height="512" rx="115" fill="url(#g)"/><path d="M256 90 L390 145 V255 C390 340 330 405 256 430 C182 405 122 340 122 255 V145 Z" fill="rgba(255,255,255,0.15)" stroke="#ffffff" stroke-width="16" stroke-linejoin="round"/><rect x="175" y="270" width="34" height="90" rx="8" fill="#ffffff"/><rect x="239" y="215" width="34" height="145" rx="8" fill="#ffffff"/><rect x="303" y="165" width="34" height="195" rx="8" fill="#34d399"/><polyline points="160 250 230 185 285 225 355 140" fill="none" stroke="#fbbf24" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><polygon points="365,140 335,138 355,165" fill="#fbbf24"/></svg>';
    var iconDataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(iconSvg);

    var manifestObj = {
      name: "Finpess — Finanças Inteligentes",
      short_name: "Finpess",
      description: "Controle financeiro pessoal, familiar, cartões de crédito e investimentos.",
      start_url: "./?source=pwa",
      scope: "./",
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#059669",
      orientation: "portrait-primary",
      icons: [
        {
          src: iconDataUri,
          sizes: "192x192 512x512",
          type: "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    };

    return ContentService.createTextOutput(JSON.stringify(manifestObj))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var template = HtmlService.createTemplateFromFile('Index');
  template.initialParamsJson = JSON.stringify((e && e.parameter) || {});

  try {
    var ownerEmail = AuthService.resolveOwnerEmail();
    if (ownerEmail) {
      AuthService.bootstrapOwnerAndGroup(ownerEmail);
    }
  } catch (err) {}

  // Isolamento estrito de segurança: nunca injeta token do proprietário no HTML globalmente.
  // Cada visitante/navegador deve possuir sua própria sessão isolada ou se autenticar.
  template.initialSessionToken = '';

  return template
    .evaluate()
    .setTitle('Finanças Inteligentes — Controle Financeiro Pessoal e Familiar')
    .setFaviconUrl('https://andre-fdias.github.io/finpess/icon-192.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Endpoint HTTP POST:
 * 1. Chamadas de API REST (App Android Nativo, PWA, integrações externas) quando payload contém `action`.
 * 2. Webhook do Bot do Telegram quando payload é um Update do Telegram.
 */
function doPost(e) {
  try {
    var rawBody = (e && e.postData && e.postData.contents) || '{}';
    var parsed = JSON.parse(rawBody);

    // Se a requisição contiver 'action', despacha via apiCall para o App Android Nativo / clientes REST
    if (parsed && parsed.action) {
      var authCtx = parsed.authContext || {};
      if (!authCtx.sessionToken) {
        authCtx.sessionToken = parsed.sessionToken || parsed.token || (parsed.payload && (parsed.payload.sessionToken || parsed.payload.token)) || '';
      }
      var payloadData = parsed.payload || parsed;
      var apiResponse = apiCall(parsed.action, payloadData, authCtx);
      return ContentService.createTextOutput(JSON.stringify(apiResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var providedSecret = (e && e.parameter && e.parameter.secret) || '';
    var update = parsed;
    var result = TelegramWebhookService.handleWebhookUpdate(update, providedSecret, {
      dryRun: false,
      sendRealTelegramMessages: true
    });
    // ⚠️ CRÍTICO: HtmlService retorna HTTP 200 diretamente, evitando o redirecionamento 302 do ContentService
    return HtmlService.createHtmlOutput('OK');
  } catch (err) {
    var safeMsg = err && err.message ? err.message : 'Erro no processamento do webhook';
    try {
      Logger.log('Webhook erro: ' + safeMsg);
      if (safeMsg.indexOf('WEBHOOK_') !== 0 && safeMsg.indexOf('INVALID_TELEGRAM_UPDATE') !== 0) {
        var failedUpdate = JSON.parse((e && e.postData && e.postData.contents) || '{}');
        var failedMsg = failedUpdate.message || failedUpdate.edited_message ||
          (failedUpdate.callback_query && failedUpdate.callback_query.message);
        var failedChatId = failedMsg && failedMsg.chat && failedMsg.chat.id;
        if (failedChatId) {
          TelegramWebhookService.notifyChat(failedChatId, '⚠️ ' + safeMsg.replace(/^[A-Z_]+:\s*/, ''));
        }
      }
    } catch (notifyErr) {}
    // Retorna HTTP 200 para o Telegram não empilhar retentativas em loop
    return HtmlService.createHtmlOutput('OK');
  }
}

/**
 * Despachante RPC unificado chamado pelo frontend via google.script.run.apiCall(action, payload, authContext).
 * Todas as regras de permissão, isolamento de grupo e validação são executadas aqui no servidor.
 */
function apiCall(action, payload, authContext) {
  try {
    var reqPayload = payload || {};
    var act = String(action || '').trim();

    // Rotas de Autenticação Pública (Login, Cadastro, Logout e Checagem de Aprovação)
    if (act === 'auth.login') {
      return AuthService.loginWithCredentials(reqPayload.email, reqPayload.senha);
    }
    if (act === 'auth.googleLogin') {
      return AuthService.loginWithGoogle(reqPayload.email, reqPayload.idToken, reqPayload.senha);
    }
    if (act === 'auth.register') {
      return AuthService.registerUser(reqPayload.nome, reqPayload.email, reqPayload.senha);
    }
    if (act === 'auth.logout') {
      return AuthService.logout(authContext);
    }
    if (act === 'auth.checkApproval') {
      return AuthService.checkApprovalStatus(reqPayload.email);
    }

    // Rota 1: Bootstrap de sessão (retorna status do usuário mesmo se PENDENTE/BLOQUEADO, sem expor dados financeiros)
    if (act === 'session.getBootstrap') {
      var sessionUser = null;
      try {
        sessionUser = AuthService.getCurrentSessionUser(authContext);
      } catch (eAuth) {
        return {
          ok: true,
          authenticated: false,
          authorized: false,
          user: null
        };
      }
      if (!sessionUser) {
        return {
          ok: true,
          authenticated: false,
          authorized: false,
          user: null
        };
      }
      if (sessionUser.status !== 'APROVADO') {
        return {
          ok: true,
          authenticated: true,
          authorized: false,
          user: {
            id: sessionUser.id,
            email: sessionUser.email,
            nome: sessionUser.nome,
            status: sessionUser.status,
            papel: sessionUser.papel,
            tema_preferido: sessionUser.tema_preferido || 'light'
          }
        };
      }
      var profile = UserService.getProfileAndPreferences(sessionUser);
      var dashboard = FinanceService.getDashboardData(sessionUser, reqPayload.mesReferencia);
      var categories = FinanceService.listCategoriesWithSubcategories(sessionUser);
      var tgStatus = TelegramAuthService.getLinkStatusForUser(sessionUser);
      var syncVersion = SpreadsheetRepository.getSyncVersion(sessionUser.grupo_id);
      var onlineUsers = SpreadsheetRepository.recordUserPresence(sessionUser, reqPayload.currentModule || 'dashboard');
      var notifOverview = NotificationService.getCenterOverview(sessionUser, { unreadOnly: true });
      return {
        ok: true,
        authenticated: true,
        authorized: true,
        sessionToken: sessionUser.token_sessao || '',
        user: {
          id: sessionUser.id,
          email: sessionUser.email,
          nome: sessionUser.nome,
          papel: sessionUser.papel,
          status: sessionUser.status,
          tema_preferido: sessionUser.tema_preferido || 'light',
          hasPassword: Boolean(sessionUser.hash_senha && String(sessionUser.hash_senha).trim())
        },
        profile: profile,
        dashboard: dashboard,
        categories: categories,
        telegram: tgStatus,
        syncVersion: syncVersion,
        onlineUsers: onlineUsers,
        unreadNotificationsCount: notifOverview.nao_lidas,
        notificationsBadge: notifOverview.badge_text,
        hasCriticalNotification: notifOverview.has_critical
      };
    }

    // Rotas de Sincronização Multi-Usuário em Tempo Real e Auto-Sync
    if (act === 'sync.getVersion') {
      var userSync = null;
      try {
        userSync = AuthService.requireApprovedUser(authContext);
      } catch (eSync) {
        return { ok: false, error: 'Unauthorized' };
      }
      var onlineUsers = SpreadsheetRepository.recordUserPresence(userSync, reqPayload.currentModule);
      var notifSync = NotificationService.getCenterOverview(userSync, { unreadOnly: true });
      return {
        ok: true,
        version: SpreadsheetRepository.getSyncVersion(userSync.grupo_id),
        onlineUsers: onlineUsers,
        unreadNotificationsCount: notifSync.nao_lidas,
        notificationsBadge: notifSync.badge_text,
        hasCriticalNotification: notifSync.has_critical,
        timestamp: Date.now()
      };
    }
    if (act === 'sync.forceSync') {
      var userForce = null;
      try {
        userForce = AuthService.requireApprovedUser(authContext);
      } catch (eForce) {
        return { ok: false, error: 'Unauthorized' };
      }
      var bumped = SpreadsheetRepository.bumpSyncVersion(userForce.grupo_id);
      return {
        ok: true,
        version: bumped,
        timestamp: Date.now()
      };
    }

    // Rota 2: Preferência de tema (permitida para qualquer usuário autenticado atualizar seu tema)
    if (act === 'user.updateTheme') {
      var uTheme = AuthService.getCurrentSessionUser(authContext);
      var updatedThemeUser = UserService.updateUserPreferences(uTheme, {
        tema_preferido: reqPayload.tema_preferido
      });
      return { ok: true, data: { tema_preferido: updatedThemeUser.tema_preferido } };
    }

    // Todas as demais rotas exigem obrigatoriamente usuário autenticado E APROVADO!
    var user = AuthService.requireApprovedUser(authContext);

    switch (act) {
      // Preferências do usuário
      case 'user.updatePreferences':
        return { ok: true, data: UserService.updateUserPreferences(user, reqPayload) };
      case 'user.updatePersonalPassword':
        return { ok: true, data: UserService.updatePersonalPassword(user, reqPayload) };

      // Dashboard e Lançamentos
      case 'dashboard.get':
        return { ok: true, data: FinanceService.getDashboardData(user, reqPayload.mesReferencia) };
      case 'launches.list':
        return { ok: true, data: FinanceService.listLaunches(user, reqPayload) };
      case 'launches.create':
        return { ok: true, data: FinanceService.createLaunch(user, reqPayload, 'WEB') };
      case 'launches.update':
        return { ok: true, data: FinanceService.updateLaunch(user, reqPayload.id, reqPayload) };
      case 'launches.confirm':
        return { ok: true, data: FinanceService.confirmLaunch(user, reqPayload.id, reqPayload) };
      case 'launches.cancel':
        return { ok: true, data: FinanceService.cancelLaunch(user, reqPayload.id, reqPayload.motivo) };
      case 'launches.exportCsv':
        return { ok: true, data: FinanceService.exportLaunchesCsv(user, reqPayload) };
      case 'receipt.scan':
        var scanRes = GeminiService.extractReceiptFromImage(reqPayload.imageBase64, reqPayload.mimeType, reqPayload.options);
        var catDesc = TelegramParserService.suggestCategoryAndDescription(user, scanRes.descricao + ' ' + (scanRes.subcategoria_sugerida || ''), 'SAIDA');
        var accountMatch = TelegramParserService.matchBankAccount(user, scanRes.descricao);
        return {
          ok: true,
          data: {
            tipo: 'SAIDA',
            descricao: scanRes.descricao,
            valor_centavos: scanRes.valor_centavos,
            data: scanRes.data,
            forma_pagamento: scanRes.forma_pagamento,
            categoria_id: catDesc.categoria_id,
            subcategoria_id: catDesc.subcategoria_id,
            conta_bancaria_id: accountMatch.conta_bancaria_id,
            provedor: scanRes.provedor
          }
        };

      // Busca Global Unificada (Spotlight Search)
      case 'search.global':
        return { ok: true, data: SearchService.searchGlobal(user, reqPayload.term) };

      // Categorias e Subcategorias
      case 'categories.list':
        return { ok: true, data: FinanceService.listCategoriesWithSubcategories(user) };
      case 'categories.create':
        return { ok: true, data: FinanceService.createCategory(user, reqPayload) };
      case 'subcategories.create':
        return { ok: true, data: FinanceService.createSubcategory(user, reqPayload) };
      case 'categories.updateBudget':
        return { ok: true, data: FinanceService.updateCategoryBudget(user, reqPayload.categoria_id, reqPayload.orcamento_mensal_centavos) };
      case 'categories.getBudgetStatus':
        return { ok: true, data: FinanceService.getCategoryBudgetStatus(user, reqPayload.mesReferencia) };

      // Contas Mensais Recorrentes
      case 'recurring.list':
        return { ok: true, data: RecurringAccountService.listRecurringAccounts(user, reqPayload.competencia) };
      case 'recurring.getSubscriptionsOverview':
        return { ok: true, data: RecurringAccountService.getSubscriptionsOverview(user) };
      case 'recurring.create':
        return { ok: true, data: RecurringAccountService.createRecurringAccount(user, reqPayload) };
      case 'recurring.update':
        return {
          ok: true,
          data: RecurringAccountService.updateRecurringAccount(
            user,
            reqPayload.id,
            reqPayload,
            Boolean(reqPayload.aplicar_ocorrencias_futuras)
          )
        };
      case 'recurring.generateForecasts':
        return { ok: true, data: RecurringAccountService.generateMonthlyForecasts(user, reqPayload.competencia) };
      case 'recurring.payOccurrence':
        return {
          ok: true,
          data: RecurringAccountService.payRecurringOccurrence(
            user,
            reqPayload.id,
            reqPayload.competencia,
            reqPayload
          )
        };

      // Contas Bancárias
      case 'users.listGroupMembers':
        return { ok: true, data: UserService.listGroupMembers(user) };
      case 'bankAccounts.list':
        return { ok: true, data: BankAccountService.listBankAccountsWithBalances(user, Boolean(reqPayload.includeInactive)) };
      case 'bankAccounts.create':
        return { ok: true, data: BankAccountService.createBankAccount(user, reqPayload) };
      case 'bankAccounts.update':
        return { ok: true, data: BankAccountService.updateBankAccount(user, reqPayload.id, reqPayload) };
      case 'bankAccounts.transfer':
        return { ok: true, data: BankAccountService.createOwnAccountTransfer(user, reqPayload) };
      case 'bankAccounts.statement':
        return {
          ok: true,
          data: BankAccountService.getAccountStatement(
            user,
            reqPayload.conta_bancaria_id,
            reqPayload.data_inicio,
            reqPayload.data_fim
          )
        };
      case 'bankAccounts.reconcile':
        return {
          ok: true,
          data: BankAccountService.reconcileAccountBalance(
            user,
            reqPayload.conta_bancaria_id,
            reqPayload.saldo_informado_centavos,
            Boolean(reqPayload.gerar_ajuste)
          )
        };

      // Cartões de Crédito e Faturas
      case 'creditCards.list':
        return { ok: true, data: CreditCardService.listCards(user) };
      case 'creditCards.create':
        return { ok: true, data: CreditCardService.createCard(user, reqPayload) };
      case 'creditCards.update':
        return { ok: true, data: CreditCardService.updateCard(user, reqPayload.id, reqPayload) };
      case 'creditCards.delete':
        return { ok: true, data: CreditCardService.deleteCard(user, reqPayload.id) };
      case 'creditCards.invoices.list':
        return { ok: true, data: CreditCardService.listInvoices(user, reqPayload.cartao_id) };
      case 'creditCards.invoices.get':
        return { ok: true, data: CreditCardService.getInvoiceDetails(user, reqPayload.id) };
      case 'creditCards.invoices.pay':
        return { ok: true, data: CreditCardService.payInvoice(user, reqPayload.fatura_id, reqPayload) };
      case 'creditCards.purchases.create':
        return { ok: true, data: CreditCardService.createPurchase(user, reqPayload) };
      case 'creditCards.purchases.cancel':
        return { ok: true, data: CreditCardService.cancelPurchase(user, reqPayload.id, reqPayload.motivo) };
      case 'creditCards.adjustments.create':
        return { ok: true, data: CreditCardService.addAdjustment(user, reqPayload) };
      case 'creditCards.simulate':
        return { ok: true, data: CreditCardService.simulatePurchase(user, reqPayload) };

      // Metas Financeiras e Reserva de Emergência
      case 'goals.list':
        return { ok: true, data: GoalService.listGoals(user, reqPayload) };
      case 'goals.create':
        return { ok: true, data: GoalService.createGoal(user, reqPayload) };
      case 'goals.update':
        return { ok: true, data: GoalService.updateGoal(user, reqPayload.id, reqPayload) };
      case 'goals.delete':
        return { ok: true, data: GoalService.deleteGoal(user, reqPayload.id) };
      case 'goals.contribute':
        return { ok: true, data: GoalService.contributeToGoal(user, reqPayload.id, reqPayload) };
      case 'goals.getEmergencyFundRecommendation':
        return { ok: true, data: GoalService.calculateEmergencyFundRecommendation(user) };

      // Dívidas (Exclusivo Web)
      case 'debts.list':
        return { ok: true, data: DebtService.listDebts(user) };
      case 'debts.create':
        return { ok: true, data: DebtService.createDebt(user, reqPayload, 'WEB') };
      case 'debts.update':
        return { ok: true, data: DebtService.updateDebt(user, reqPayload.id, reqPayload, 'WEB') };
      case 'debts.approveAgreement':
        return { ok: true, data: DebtService.approveDebtAgreement(user, reqPayload.id, reqPayload, 'WEB') };
      case 'debts.payInstallment':
        return { ok: true, data: DebtService.payDebtInstallment(user, reqPayload.parcela_id, reqPayload, 'WEB') };

      // Empréstimos (Exclusivo Web)
      case 'loans.list':
        return { ok: true, data: LoanService.listLoans(user) };
      case 'loans.create':
        return { ok: true, data: LoanService.createLoan(user, reqPayload, 'WEB') };
      case 'loans.update':
        return { ok: true, data: LoanService.updateLoan(user, reqPayload.id, reqPayload, 'WEB') };
      case 'loans.payInstallment':
        return { ok: true, data: LoanService.payLoanInstallment(user, reqPayload.parcela_id, reqPayload, 'WEB') };

      // Investimentos (Exclusivo Web)
      case 'investments.summary':
        return { ok: true, data: InvestmentService.getPortfolioSummary(user) };
      case 'investments.createAsset':
        return { ok: true, data: InvestmentService.createAsset(user, reqPayload, 'WEB') };
      case 'investments.recordMovement':
        return { ok: true, data: InvestmentService.recordInvestmentMovement(user, reqPayload, 'WEB') };
      case 'investments.deleteAsset':
        return { ok: true, data: InvestmentService.deleteAsset(user, reqPayload.id, 'WEB') };
      case 'investments.updateAsset':
        return { ok: true, data: InvestmentService.updateAsset(user, reqPayload, 'WEB') };
      case 'investments.getAiAdvice':
        return { ok: true, data: InvestmentService.getAiMarketAdvice(user) };
      case 'investments.getMarketRadar':
        return { ok: true, data: MarketDataService.getMarketHighlights(reqPayload && reqPayload.forceRefresh) };
      case 'investments.getTop10':
        return { ok: true, data: MarketDataService.getTop10ByCategory(reqPayload && reqPayload.categoria, reqPayload && reqPayload.forceRefresh) };
      case 'investments.getNews':
        return { ok: true, data: MarketDataService.getMarketNews() };
      case 'investments.getEconomicCalendar':
        return { ok: true, data: MarketDataService.getEconomicCalendar() };
      case 'investments.getCommodities':
        return { ok: true, data: MarketDataService.getCommoditiesPanel(reqPayload && reqPayload.forceRefresh) };
      case 'investments.refreshMarketDataOnline':
        return { ok: true, data: MarketDataService.refreshAllOnlineMarketData() };
      case 'investments.getSuitability':
        return { ok: true, data: InvestmentService.getSuitability(user) };
      case 'investments.saveSuitability':
        return { ok: true, data: InvestmentService.saveSuitability(user, reqPayload) };
      case 'investments.compareAssets':
        return { ok: true, data: InvestmentService.compareAssets(user, reqPayload) };
      case 'investments.getDividendProjections':
        return { ok: true, data: InvestmentService.getDividendProjections(user) };

      // Planejamento e Projeções
      case 'projections.generate':
        return {
          ok: true,
          data: ProjectionService.generateCashFlowProjection(
            user,
            reqPayload.horizonte_meses || reqPayload.monthsAhead || 6,
            Boolean(reqPayload.salvar_snapshot || reqPayload.saveSnapshot)
          )
        };

      // Calendário Financeiro e Sincronização
      case 'calendar.get':
        return { ok: true, data: CalendarService.getFinancialCalendar(user, reqPayload) };
      case 'calendar.syncItem':
        return { ok: true, data: CalendarService.syncFinancialItemToCalendar(user, reqPayload.item, reqPayload.options) };
      case 'calendar.syncGoogleCalendar':
        return { ok: true, data: CalendarService.syncAllToGoogleCalendar(user, reqPayload) };

      // Relatórios Financeiros e Inteligência BI
      case 'reports.getComprehensiveReport':
        return { ok: true, data: ReportService.getComprehensiveReport(user, reqPayload) };
      case 'reports.getAiNarrativeReport':
        return { ok: true, data: ReportService.getAiNarrativeReport(user, reqPayload) };
      case 'reports.getDre':
        return { ok: true, data: ReportService.getDreReport(user, reqPayload) };

      // Central Inteligente de Notificações, Alertas e Comunicação
      case 'notifications.getCenterOverview':
        return { ok: true, data: NotificationService.getCenterOverview(user, reqPayload) };
      case 'notifications.getInitialPopup':
        return { ok: true, data: NotificationService.getInitialPopup(user, reqPayload) };
      case 'notifications.setReadStatus':
        return { ok: true, data: NotificationService.setReadStatus(user, reqPayload.id, reqPayload.isRead) };
      case 'notifications.markAllAsRead':
        return { ok: true, data: NotificationService.markAllAsRead(user) };
      case 'notifications.snooze':
        return { ok: true, data: NotificationService.snoozeNotification(user, reqPayload.id, reqPayload.options) };
      case 'notifications.delete':
        return { ok: true, data: NotificationService.deleteNotification(user, reqPayload.id) };
      case 'notifications.clearRead':
        return { ok: true, data: NotificationService.clearReadNotifications(user) };
      case 'notifications.getPreferences':
        return { ok: true, data: NotificationService.getUserPreferences(user) };
      case 'notifications.savePreferences':
        return { ok: true, data: NotificationService.saveUserPreferences(user, reqPayload) };
      case 'notifications.scanAndEnqueue':
        return { ok: true, data: NotificationService.scanAndEnqueueDueAlerts(user) };
      case 'notifications.scanInvestments':
        return { ok: true, data: NotificationService.scanInvestmentAndOracleAlerts(user) };
      case 'notifications.processQueue':
        return { ok: true, data: NotificationService.processNotificationQueue(user, reqPayload) };
      case 'notifications.sendMorningDigest':
        return { ok: true, data: NotificationService.sendDailyMorningDigest(user, reqPayload) };
      case 'notifications.sendAllMorningDigests':
        var adminDigest = AuthService.requireAdminUser(authContext);
        return { ok: true, data: NotificationService.sendAllDailyMorningDigests(reqPayload) };
      case 'notifications.ensureTrigger':
        var adminTrig = AuthService.requireAdminUser(authContext);
        return { ok: true, data: NotificationService.ensureDailyMorningTrigger() };
      case 'notifications.getTriggerStatus':
        return { ok: true, data: NotificationService.getTriggerStatus() };

      // Oráculo IA 2.0 (Analista Financeiro Autônomo)
      case 'oracle.getFullOverview':
        return { ok: true, data: OracleService.getFullOracleOverview(user, reqPayload.mesReferencia) };
      case 'oracle.getHealthScore':
        return { ok: true, data: OracleService.getHealthScore(user, reqPayload.mesReferencia) };
      case 'oracle.getProactiveAlerts':
        return { ok: true, data: OracleService.getProactiveAlerts(user, reqPayload.mesReferencia) };
      case 'oracle.getFinancialBottlenecks':
        return { ok: true, data: OracleService.getFinancialBottlenecks(user, reqPayload.mesReferencia) };
      case 'oracle.simulateScenario':
        return { ok: true, data: OracleService.simulateScenario(user, reqPayload) };
      case 'oracle.getActionPlan':
        return { ok: true, data: OracleService.getActionPlan(user, reqPayload.mesReferencia) };
      case 'oracle.ask':
        return {
          ok: true,
          data: GeminiService.askOracle(
            user,
            reqPayload.pergunta,
            reqPayload.mesReferencia,
            reqPayload.options
          )
        };

      // Telegram (Vinculação, Revogação e Configuração Automática 1-Clique na Web)
      case 'telegram.generateCode':
        return { ok: true, data: TelegramAuthService.generateLinkingCode(user) };
      case 'telegram.revokeLink':
        return { ok: true, data: TelegramAuthService.revokeTelegramLink(user) };
      case 'telegram.status':
        return { ok: true, data: TelegramAuthService.getLinkStatusForUser(user) };
      case 'setup.autoConfigureTelegram':
        var adminTg = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.autoConfigureTelegramAndAi(adminTg, reqPayload) };
      case 'setup.getIntegrationDetails':
        var adminInteg = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.getIntegrationDetails(adminInteg) };
      case 'setup.testAi':
        var adminTestAi = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.testAiConnection(adminTestAi, reqPayload) };
      case 'setup.testTelegram':
        var adminTestTg = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.testTelegramConnection(adminTestTg, reqPayload) };
      case 'setup.saveIntegrationSettings':
        var adminSaveInteg = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.saveAiTelegramAdvancedSettings(adminSaveInteg, reqPayload) };
      case 'setup.getDiagnostic':
        var adminDiag = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.runSystemDiagnostic(adminDiag) };
      case 'setup.installSpreadsheet':
        var adminSetup = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.installSpreadsheetAndSeed(adminSetup.email) };

      // Administração, Usuários, Auditoria e Backup/Restore
      case 'admin.listUsers':
        var admin1 = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.listUsersForAdmin(admin1) };
      case 'admin.createUser':
        var adminCreate = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.createUserByAdmin(adminCreate, reqPayload) };
      case 'admin.updateUser':
        var adminUpdate = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.updateUserByAdmin(adminUpdate, reqPayload.target_user_id, reqPayload) };
      case 'admin.getUserDetails':
        var adminDetails = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.getUserDetails(adminDetails, reqPayload.target_user_id) };
      case 'admin.deleteUser':
        var adminDelete = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.deleteUserByAdmin(adminDelete, reqPayload.target_user_id) };
      case 'admin.revokeSession':
        var adminRevoke = AuthService.requireAdminUser(authContext);
        return { ok: true, data: AuthService.revokeUserSession(adminRevoke, reqPayload.target_user_id) };
      case 'admin.changeUserAuth':
        var admin2 = AuthService.requireAdminUser(authContext);
        return {
          ok: true,
          data: UserService.changeUserAuthorization(
            admin2,
            reqPayload.target_user_id,
            reqPayload.status,
            reqPayload.papel,
            reqPayload.grupo_id
          )
        };
      case 'admin.getConfigs':
        return { ok: true, data: UserService.getGroupConfigurations(user) };
      case 'admin.updateConfigs':
        var admin3 = AuthService.requireAdminUser(authContext);
        return { ok: true, data: UserService.updateGroupConfigurations(admin3, reqPayload) };
      case 'admin.auditLogs':
        var admin4 = AuthService.requireAdminUser(authContext);
        return { ok: true, data: AuditService.listByGrupo(admin4.grupo_id, reqPayload.limit || 100) };
      case 'admin.exportBackup':
        var admin5 = AuthService.requireAdminUser(authContext);
        var backupData = SpreadsheetRepository.exportBackup(admin5.grupo_id, admin5.id);
        AuditService.log({
          grupo_id: admin5.grupo_id,
          usuario_id: admin5.id,
          acao: 'BACKUP_EXPORTADO',
          entidade: 'SISTEMA',
          entidade_id: admin5.grupo_id,
          origem: 'WEB',
          detalhes: { schemaVersion: backupData.schemaVersion }
        });
        return { ok: true, data: backupData };
      case 'admin.restoreBackup':
        var admin6 = AuthService.requireAdminUser(authContext);
        var restoreReport = SpreadsheetRepository.restoreBackup(reqPayload.backup, admin6.grupo_id);
        AuditService.log({
          grupo_id: admin6.grupo_id,
          usuario_id: admin6.id,
          acao: 'BACKUP_RESTAURADO',
          entidade: 'SISTEMA',
          entidade_id: admin6.grupo_id,
          origem: 'WEB',
          detalhes: restoreReport
        });
        return { ok: true, data: restoreReport };
      case 'admin.resetData':
        var adminReset = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SetupService.resetFinancialData(adminReset, reqPayload) };

      // Painel de Segurança Operacional e Varredura de Auditoria
      case 'security.getOperationalDashboard':
        var adminSec = AuthService.requireAdminUser(authContext);
        return { ok: true, data: AuditService.getOperationalDashboard(adminSec) };
      case 'security.runAuditCheck':
        var adminCheck = AuthService.requireAdminUser(authContext);
        return { ok: true, data: AuditService.runAuditCheck(adminCheck) };

      // Consulta de Logs Estruturados e Observabilidade
      case 'logs.query':
        var adminLogs = AuthService.requireAdminUser(authContext);
        return { ok: true, data: SecurityLogger.queryLogs(adminLogs.grupo_id, reqPayload) };

      // Gestão de Incidentes
      case 'incidents.list':
        var adminInc = AuthService.requireAdminUser(authContext);
        return { ok: true, data: IncidentManagementService.listIncidents(adminInc, reqPayload) };
      case 'incidents.resolve':
        var adminResolve = AuthService.requireAdminUser(authContext);
        return { ok: true, data: IncidentManagementService.resolveIncident(adminResolve, reqPayload.incident_id, reqPayload.notes) };

      // Diagnóstico de Performance e Cache
      case 'performance.getMetrics':
        var adminPerf = AuthService.requireAdminUser(authContext);
        return { ok: true, data: CacheServiceManager.getMetrics() };
      case 'performance.clearCache':
        var adminClr = AuthService.requireAdminUser(authContext);
        CacheServiceManager.clearL1();
        CacheServiceManager.invalidateFinancialCache(adminClr);
        return { ok: true, data: { cleared: true, metrics: CacheServiceManager.getMetrics() } };

      default:
        throw new Error('UNKNOWN_ACTION: Ação desconhecida no servidor: ' + act);
    }
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

/**
 * Ponto de entrada do gatilho automático diário do Google Apps Script (Time-Driven Trigger).
 * Executado pontualmente todas as manhãs entre 07:00 e 08:00 para envio do resumo unificado.
 */
function executarEnvioMatinalNotificacoes() {
  return NotificationService.sendAllDailyMorningDigests({ dryRun: false });
}

/**
 * Utilitário para instalação ou reparo do gatilho matinal no projeto do Apps Script.
 */
function configurarGatilhoMatinal() {
  return NotificationService.ensureDailyMorningTrigger();
}

