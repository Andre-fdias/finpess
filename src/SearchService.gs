/**
 * @file SearchService.gs
 * @description Mecanismo centralizado de Busca Global Inteligente (Spotlight Search)
 * do Finanças Inteligentes. Realiza varreduras em tempo real e insensíveis a acentos
 * em Lançamentos, Contas Recorrentes, Contas Bancárias, Categorias, Investimentos,
 * Dívidas, Empréstimos e Atalhos de Navegação do Sistema.
 */

var SearchService = (function () {
  var SYSTEM_SHORTCUTS = [
    { id: 'sc_dashboard', title: 'Dashboard Geral', desc: 'Visão consolidada de receitas, despesas, saldos e patrimônio', icon: '📊', module: 'dashboard' },
    { id: 'sc_launches', title: 'Lançamentos Financeiros', desc: 'Extrato completo, receitas, despesas e transferências', icon: '💳', module: 'launches' },
    { id: 'sc_recurring', title: 'Contas Recorrentes', desc: 'Assinaturas mensais, contas fixas e vencimentos automáticos', icon: '🔄', module: 'recurring' },
    { id: 'sc_bank_accounts', title: 'Contas Bancárias', desc: 'Gestão de contas correntes, depósitos e saldos bancários', icon: '🏦', module: 'banks' },
    { id: 'sc_credit_cards', title: 'Cartões de Crédito', desc: 'Gestão de limites, faturas e compras parceladas', icon: '💳', module: 'credit-cards' },
    { id: 'sc_debts', title: 'Dívidas a Pagar', desc: 'Controle de dívidas antigas, parcelamentos e acordos', icon: '📄', module: 'debts' },
    { id: 'sc_loans', title: 'Empréstimos', desc: 'Controle de empréstimos concedidos, tomados e consignados', icon: '🤝', module: 'loans' },
    { id: 'sc_investments', title: 'Central de Investimentos', desc: 'Carteira de ativos, proventos, cotações e rentabilidade', icon: '📈', module: 'investments' },
    { id: 'sc_calendar', title: 'Calendário Financeiro', desc: 'Agenda visual de vencimentos de contas e mercado', icon: '📅', module: 'calendar' },
    { id: 'sc_planning', title: 'Planejamento e Projeções', desc: 'Metas, limites orçamentários por categoria e simulador', icon: '🎯', module: 'planning' },
    { id: 'sc_reports', title: 'Relatórios Avançados (BI)', desc: 'Demonstrativos, fluxo de caixa e parecer executivo', icon: '📑', module: 'reports' },
    { id: 'sc_oraculo', title: 'Oráculo IA 2.0', desc: 'Auditor e consultor financeiro autônomo com IA generativa', icon: '🔮', module: 'oraculo' },
    { id: 'sc_settings', title: 'Configurações e Administração', desc: 'Gestão de usuários, categorias, integrações e segurança', icon: '⚙️', module: 'settings' }
  ];

  function normalizeStr(str) {
    if (!str) return '';
    try {
      return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    } catch (e) {
      return String(str).toLowerCase().trim();
    }
  }

  /**
   * Executa a busca global multientidades no grupo financeiro do usuário.
   */
  function searchGlobal(user, rawTerm) {
    AuthService.assertGroupAccess(user, user.grupo_id);

    var cleanTerm = (rawTerm || '').trim();
    if (!cleanTerm || cleanTerm.length < 2) {
      return {
        term: cleanTerm,
        total: 0,
        results: {
          shortcuts: [],
          recurring: [],
          launches: [],
          bankAccounts: [],
          categories: [],
          investments: [],
          debts: []
        }
      };
    }

    var termNorm = normalizeStr(cleanTerm);
    var grupoId = user.grupo_id;

    // Cache L1/L2 com TTL curto (60s) para respostas ultra-rápidas sem tocar repetidamente nas planilhas
    var cacheKey = 'search_g_' + grupoId + '_' + termNorm;
    try {
      var cached = CacheServiceManager.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (cErr) {}

    // 1. Atalhos de Módulos
    var matchedShortcuts = [];
    for (var s = 0; s < SYSTEM_SHORTCUTS.length; s++) {
      var sc = SYSTEM_SHORTCUTS[s];
      if (normalizeStr(sc.title).indexOf(termNorm) !== -1 || normalizeStr(sc.desc).indexOf(termNorm) !== -1 || normalizeStr(sc.module).indexOf(termNorm) !== -1) {
        matchedShortcuts.push(sc);
      }
    }

    // 2. Contas Recorrentes (ex: Spotify, Netflix, Aluguel, Internet)
    var matchedRecurring = [];
    try {
      var recList = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', grupoId);
      for (var r = 0; r < recList.length; r++) {
        var rec = recList[r];
        if (normalizeStr(rec.nome).indexOf(termNorm) !== -1 || normalizeStr(rec.observacoes).indexOf(termNorm) !== -1) {
          matchedRecurring.push({
            id: rec.id,
            nome: rec.nome,
            tipo: rec.tipo,
            dia_vencimento: rec.dia_vencimento,
            valor_centavos: rec.valor_centavos,
            situacao: rec.situacao,
            categoria_id: rec.categoria_id
          });
        }
      }
    } catch (recErr) {}

    // 3. Lançamentos Financeiros (ordenados por data decrescente, limitados aos 15 mais relevantes)
    var matchedLaunches = [];
    try {
      var launchList = SpreadsheetRepository.findByGrupo('LANCAMENTOS', grupoId);
      launchList.sort(function (a, b) {
        return String(b.data_vencimento || b.data_pagamento || '').localeCompare(String(a.data_vencimento || a.data_pagamento || ''));
      });

      for (var l = 0; l < launchList.length; l++) {
        var lan = launchList[l];
        if (lan.situacao === 'CANCELADO') continue;
        var descNorm = normalizeStr(lan.descricao);
        var obsNorm = normalizeStr(lan.observacoes);
        var estNorm = normalizeStr(lan.nome_estabelecimento);

        if (descNorm.indexOf(termNorm) !== -1 || obsNorm.indexOf(termNorm) !== -1 || estNorm.indexOf(termNorm) !== -1) {
          matchedLaunches.push({
            id: lan.id,
            descricao: lan.descricao,
            tipo: lan.tipo,
            situacao: lan.situacao,
            valor_centavos: lan.valor_centavos,
            data: lan.data_pagamento || lan.data_vencimento,
            categoria_id: lan.categoria_id,
            conta_bancaria_id: lan.conta_bancaria_id
          });
          if (matchedLaunches.length >= 15) break;
        }
      }
    } catch (lanErr) {}

    // 4. Contas Bancárias
    var matchedAccounts = [];
    try {
      var accList = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', grupoId);
      for (var a = 0; a < accList.length; a++) {
        var acc = accList[a];
        if (normalizeStr(acc.instituicao).indexOf(termNorm) !== -1 || normalizeStr(acc.nome_identificacao).indexOf(termNorm) !== -1) {
          matchedAccounts.push({
            id: acc.id,
            instituicao: acc.instituicao,
            nome_identificacao: acc.nome_identificacao,
            tipo_conta: acc.tipo_conta,
            situacao: acc.situacao
          });
        }
      }
    } catch (accErr) {}

    // 5. Categorias
    var matchedCategories = [];
    try {
      var catList = SpreadsheetRepository.findByGrupo('CATEGORIAS', grupoId);
      for (var c = 0; c < catList.length; c++) {
        var cat = catList[c];
        if (normalizeStr(cat.nome).indexOf(termNorm) !== -1) {
          matchedCategories.push({
            id: cat.id,
            nome: cat.nome,
            tipo: cat.tipo,
            icone: cat.icone,
            cor: cat.cor
          });
        }
      }
    } catch (catErr) {}

    // 6. Investimentos
    var matchedInvestments = [];
    try {
      var invList = SpreadsheetRepository.findByGrupo('INVESTIMENTOS', grupoId);
      for (var i = 0; i < invList.length; i++) {
        var inv = invList[i];
        if (normalizeStr(inv.codigo_ativo).indexOf(termNorm) !== -1 || normalizeStr(inv.nome).indexOf(termNorm) !== -1 || normalizeStr(inv.instituicao_custodia).indexOf(termNorm) !== -1) {
          matchedInvestments.push({
            id: inv.id,
            codigo_ativo: inv.codigo_ativo,
            nome: inv.nome,
            tipo_ativo: inv.tipo_ativo,
            instituicao: inv.instituicao_custodia,
            quantidade: inv.quantidade,
            valor_investido_centavos: inv.valor_investido_centavos
          });
        }
      }
    } catch (invErr) {}

    // 7. Dívidas & Empréstimos
    var matchedDebts = [];
    try {
      var debtList = SpreadsheetRepository.findByGrupo('DIVIDAS', grupoId);
      for (var d = 0; d < debtList.length; d++) {
        var deb = debtList[d];
        if (normalizeStr(deb.credor).indexOf(termNorm) !== -1 || normalizeStr(deb.observacoes).indexOf(termNorm) !== -1) {
          matchedDebts.push({
            id: deb.id,
            entidade: 'Dívida',
            titulo: deb.credor,
            valor_centavos: deb.valor_total_centavos,
            situacao: deb.situacao,
            module: 'debts'
          });
        }
      }
    } catch (debErr) {}

    var total = matchedShortcuts.length +
      matchedRecurring.length +
      matchedLaunches.length +
      matchedAccounts.length +
      matchedCategories.length +
      matchedInvestments.length +
      matchedDebts.length;

    var response = {
      term: cleanTerm,
      total: total,
      results: {
        shortcuts: matchedShortcuts,
        recurring: matchedRecurring,
        launches: matchedLaunches,
        bankAccounts: matchedAccounts,
        categories: matchedCategories,
        investments: matchedInvestments,
        debts: matchedDebts
      }
    };

    try {
      CacheServiceManager.put(cacheKey, response, 60);
    } catch (putErr) {}

    return response;
  }

  return {
    normalizeStr: normalizeStr,
    searchGlobal: searchGlobal
  };
})();

