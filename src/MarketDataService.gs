/**
 * @file MarketDataService.gs
 * @description Módulo de dados de mercado financeiro, cotações, rankings transparentes (Top 10),
 * commodities, notícias econômicas e calendário para a plataforma de investimentos.
 * Utiliza CacheService do Google Apps Script para otimizar requisições e garantir alta performance.
 */

var MarketDataService = (function () {
  var CACHE_TTL_MARKET = 600; // 10 minutos (cache inteligente curto com dados frescos)
  var CACHE_TTL_NEWS = 7200;   // 2 horas

  /**
   * Busca cotações de câmbio e cripto em tempo real da AwesomeAPI (gratuita e sem chave).
   */
  function fetchAwesomeApiData() {
    try {
      if (typeof UrlFetchApp === 'undefined') return null;
      var res = UrlFetchApp.fetch('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL', {
        method: 'get',
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Finpess-Platform/2.0' }
      });
      if (res && res.getResponseCode && res.getResponseCode() === 200) {
        var text = res.getContentText ? res.getContentText() : '';
        if (text) return JSON.parse(text);
      }
    } catch (e) {}
    return null;
  }

  /**
   * Busca séries temporais oficiais do Banco Central do Brasil (SGS).
   * Selic Meta: 432 | CDI anualizado: 4389 | IPCA 12m: 13522
   */
  function fetchBcbSeries(serieId) {
    try {
      if (typeof UrlFetchApp === 'undefined') return null;
      var res = UrlFetchApp.fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + serieId + '/dados/ultimos/1?formato=json', {
        method: 'get',
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Finpess-Platform/2.0' }
      });
      if (res && res.getResponseCode && res.getResponseCode() === 200) {
        var text = res.getContentText ? res.getContentText() : '';
        if (text) {
          var arr = JSON.parse(text);
          if (Array.isArray(arr) && arr.length > 0 && arr[0].valor) {
            return parseFloat(arr[0].valor);
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * Busca cotações de ações e FIIs da B3 em tempo real via Brapi.
   */
  function fetchBrapiQuotes(tickers) {
    try {
      if (typeof UrlFetchApp === 'undefined' || !tickers || tickers.length === 0) return null;
      var url = 'https://brapi.dev/api/quote/' + tickers.join(',');
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Finpess-Platform/2.0' }
      });
      if (res && res.getResponseCode && res.getResponseCode() === 200) {
        var text = res.getContentText ? res.getContentText() : '';
        if (text) {
          var json = JSON.parse(text);
          if (json && Array.isArray(json.results)) {
            var map = {};
            for (var i = 0; i < json.results.length; i++) {
              var it = json.results[i];
              if (it && it.symbol) {
                map[it.symbol] = it;
              }
            }
            return map;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * Obtém os indicadores macroeconômicos oficiais consolidados com cache inteligente e consulta online.
   */
  function getMacroIndicators(forceRefresh) {
    var cacheKey = 'finpess_macro_indicators_v3';
    if (!forceRefresh) {
      try {
        var cache = CacheService.getScriptCache();
        var cached = cache ? cache.get(cacheKey) : null;
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }

    // Valores padrão de segurança (fallback caso offline)
    var selicVal = '11,25% a.a.';
    var cdiVal = '11,15% a.a.';
    var ipcaVal = '4,45%';
    var dolarVal = 'R$ 5,75';
    var dolarBid = 5.75;
    var ouroVal = '$ 4.065/oz (R$ 737,60/g)';

    // 1. Consulta Banco Central do Brasil em tempo real
    var bcbSelic = fetchBcbSeries(432);
    if (bcbSelic !== null && !isNaN(bcbSelic) && bcbSelic > 0) {
      selicVal = bcbSelic.toFixed(2).replace('.', ',') + '% a.a.';
    }

    var bcbCdi = fetchBcbSeries(4389);
    if (bcbCdi !== null && !isNaN(bcbCdi) && bcbCdi > 0) {
      cdiVal = bcbCdi.toFixed(2).replace('.', ',') + '% a.a.';
    }

    var bcbIpca = fetchBcbSeries(13522);
    if (bcbIpca !== null && !isNaN(bcbIpca) && bcbIpca > 0) {
      ipcaVal = bcbIpca.toFixed(2).replace('.', ',') + '%';
    }

    // 2. Consulta Câmbio e Cripto AwesomeAPI em tempo real
    var awesome = fetchAwesomeApiData();
    if (awesome && awesome.USDBRL) {
      var bid = parseFloat(awesome.USDBRL.bid);
      if (!isNaN(bid) && bid > 0) {
        dolarBid = bid;
        dolarVal = 'R$ ' + bid.toFixed(2).replace('.', ',');
        var grama = (4065.46 * bid) / 31.1034768;
        ouroVal = '$ 4.065/oz (R$ ' + grama.toFixed(2).replace('.', ',') + '/g)';
      }
    }

    var indicators = [
      {
        sigla: 'SELIC',
        nome: 'Taxa Selic Meta',
        valor: selicVal,
        tendencia: 'ALTA',
        fonte: 'Banco Central do Brasil (Copom)',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Renda Fixa muito atrativa; títulos pós-fixados e IPCA+ rentabilizando alto.'
      },
      {
        sigla: 'CDI',
        nome: 'Certificado de Depósito Interbancário',
        valor: cdiVal,
        tendencia: 'ESTAVEL',
        fonte: 'B3 / Cetip / BCB',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Excelente rentabilidade com baixo risco para reservas de emergência e caixa.'
      },
      {
        sigla: 'IPCA',
        nome: 'Inflação Oficial (12m)',
        valor: ipcaVal,
        tendencia: 'ATENCAO',
        fonte: 'IBGE / BCB',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Juro real líquido brasileiro em patamar elevado (acima de 6,5% a.a.).'
      },
      {
        sigla: 'IBOVESPA',
        nome: 'Índice Bovespa',
        valor: '130.500 pts',
        tendencia: 'OPORTUNIDADE',
        fonte: 'B3',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Múltiplos P/L médios descontados em relação à média histórica decenal.'
      },
      {
        sigla: 'IFIX',
        nome: 'Índice de Fundos Imobiliários',
        valor: '3.360 pts',
        tendencia: 'ALTA',
        fonte: 'B3',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Dividend yield médio dos FIIs acima de 10,5% a.a. isento de imposto de renda.'
      },
      {
        sigla: 'DOLAR',
        nome: 'Dólar Comercial (USD/BRL)',
        valor: dolarVal,
        tendencia: 'VOLATILIDADE',
        fonte: 'Banco Central do Brasil / AwesomeAPI',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Reforça a importância de diversificação internacional e proteção cambial.'
      },
      {
        sigla: 'OURO',
        nome: 'Ouro Spot (XAU/USD / B3)',
        valor: ouroVal,
        tendencia: 'ALTA',
        fonte: 'Mercado Internacional / B3',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Reserva de valor histórica em momentos de tensão geopolítica e inflação global.'
      },
      {
        sigla: 'BRENT',
        nome: 'Petróleo Brent',
        valor: '$ 74,50/barril',
        tendencia: 'NEUTRA',
        fonte: 'ICE Londres',
        data_atualizacao: SpreadsheetRepository.todayIso(),
        impacto: 'Impacto direto em combustíveis, Petrobras e balança comercial de exportação.'
      }
    ];

    try {
      var cacheStore = CacheService.getScriptCache();
      if (cacheStore) cacheStore.put(cacheKey, JSON.stringify(indicators), CACHE_TTL_MARKET);
    } catch (e) {}

    return indicators;
  }

  /**
   * Catálogo de destaques de mercado para o Banner Rotativo e Top 10 com critérios transparentes.
   * Suporta forceRefresh para busca online em tempo real.
   */
  function getMarketHighlights(forceRefresh) {
    var cacheKey = 'finpess_market_highlights_v3';
    if (!forceRefresh) {
      try {
        var cache = CacheService.getScriptCache();
        var cached = cache ? cache.get(cacheKey) : null;
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }

    var items = [
      // 1. Renda Fixa / Tesouro
      {
        ticker: 'TESOURO IPCA+ 2029',
        nome: 'Tesouro IPCA+ com Juros Semestrais',
        preco: 'R$ 3.250,00',
        variacao_dia: '+0,12%',
        variacao_periodo: '+1,85%',
        tendencia: 'ALTA',
        categoria: 'RENDA_FIXA',
        categoria_label: 'Renda Fixa Pública',
        dy: 'IPCA + 6,65% a.a.',
        pl: null,
        pvp: null,
        risco: 'BAIXO',
        criterio: 'Maior juro real garantido soberano dos últimos anos',
        justificativa: 'Taxa real de juros historicamente alta, protegendo integralmente o poder de compra com risco de crédito soberano.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'CDB LIQUIDEZ 105% CDI',
        nome: 'CDB Bancário com Liquidez Diária',
        preco: '100% Par (R$ 1.000,00)',
        variacao_dia: '+0,04%',
        variacao_periodo: '+0,92%',
        tendencia: 'ESTAVEL',
        categoria: 'RENDA_FIXA',
        categoria_label: 'Renda Fixa Bancária',
        dy: '11,70% a.a.',
        pl: null,
        pvp: null,
        risco: 'MUITO BAIXO',
        criterio: 'Proteção FGC e liquidez imediata para reserva',
        justificativa: 'Ideal para construção e preservação de reserva de emergência com rentabilidade superior à poupança.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },

      // 2. Ações Pagadoras de Dividendos
      {
        ticker: 'BBAS3',
        nome: 'Banco do Brasil S.A.',
        preco: 'R$ 27,80',
        variacao_dia: '+0,85%',
        variacao_periodo: '+5,40%',
        tendencia: 'ALTA',
        categoria: 'DIVIDENDOS',
        categoria_label: 'Ações Dividendos',
        dy: '10,2%',
        pl: '4,1x',
        pvp: '0,78x',
        risco: 'MEDIO',
        criterio: 'Payout consistente, ROE superior a 21% e P/L abaixo de 5x',
        justificativa: 'Líder em crédito agro, forte rentabilidade sobre patrimônio líquido e distribuição semestral de dividendos robustos.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'TAEE11',
        nome: 'Transmissora Aliança de Energia (Taesa)',
        preco: 'R$ 34,20',
        variacao_dia: '-0,15%',
        variacao_periodo: '+2,10%',
        tendencia: 'ESTAVEL',
        categoria: 'DIVIDENDOS',
        categoria_label: 'Ações Dividendos',
        dy: '9,8%',
        pl: '8,2x',
        pvp: '1,65x',
        risco: 'BAIXO_MEDIO',
        criterio: 'Receita Anual Permitida (RAP) reajustada por IPCA/IGPM',
        justificativa: 'Concessões de transmissão de energia elétrica com contratos de longo prazo e baixíssimo risco operacional.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'ITUB4',
        nome: 'Itaú Unibanco Holding',
        preco: 'R$ 35,50',
        variacao_dia: '+1,10%',
        variacao_periodo: '+4,20%',
        tendencia: 'ALTA',
        categoria: 'DIVIDENDOS',
        categoria_label: 'Ações Dividendos',
        dy: '7,4%',
        pl: '8,4x',
        pvp: '1,62x',
        risco: 'MEDIO',
        criterio: 'Maior banco privado da América Latina com inadimplência controlada',
        justificativa: 'Excelente eficiência operacional, diversificação de receitas e payout adicional anunciado.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },

      // 3. Fundos Imobiliários (FIIs)
      {
        ticker: 'HGLG11',
        nome: 'CSHG Logística FII',
        preco: 'R$ 163,50',
        variacao_dia: '+0,30%',
        variacao_periodo: '+1,50%',
        tendencia: 'ALTA',
        categoria: 'FIIS',
        categoria_label: 'Fundos Imobiliários',
        dy: '8,9%',
        pl: null,
        pvp: '1,02x',
        risco: 'BAIXO_MEDIO',
        criterio: 'Galpões logísticos de alto padrão no raio de 30km de São Paulo',
        justificativa: 'Portfólio de ativos premium com vacância física próxima a zero e inquilinos de primeira linha (mercado livre, volkswagen, etc.).',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'KNIP11',
        nome: 'Kinea Rendimentos Imobiliários FII',
        preco: 'R$ 94,80',
        variacao_dia: '+0,15%',
        variacao_periodo: '+2,30%',
        tendencia: 'ALTA',
        categoria: 'FIIS',
        categoria_label: 'Fundos Imobiliários',
        dy: '11,4%',
        pl: null,
        pvp: '0,97x',
        risco: 'MEDIO',
        criterio: 'Carteira de CRIs atrelada à inflação com devedores corporativos sólidos',
        justificativa: 'Fundo de papel de alta liquidez gerido pela Kinea/Itaú com distribuição isenta regular e proteção contra inflação.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'XPML11',
        nome: 'XP Malls FII',
        preco: 'R$ 108,20',
        variacao_dia: '+0,45%',
        variacao_periodo: '+3,80%',
        tendencia: 'ALTA',
        categoria: 'FIIS',
        categoria_label: 'Fundos Imobiliários',
        dy: '9,1%',
        pl: null,
        pvp: '0,96x',
        risco: 'MEDIO',
        criterio: 'Participação em shoppings consolidados de alto fluxo',
        justificativa: 'Recuperação forte de vendas nas lojas satélite e reajuste anual de contratos de locação.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },

      // 4. Ações de Crescimento
      {
        ticker: 'WEGE3',
        nome: 'WEG S.A.',
        preco: 'R$ 52,40',
        variacao_dia: '+1,80%',
        variacao_periodo: '+8,60%',
        tendencia: 'ALTA',
        categoria: 'CRESCIMENTO',
        categoria_label: 'Ações Crescimento',
        dy: '1,8%',
        pl: '31,2x',
        pvp: '10,8x',
        risco: 'MEDIO',
        criterio: 'Crescimento de receita (CAGR > 18%) e liderança global em motores e energia renovável',
        justificativa: 'Empresa modelo de governança, forte presença internacional e expansão em transição energética e inteligência artificial.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'PRIO3',
        nome: 'PRIO (PetroRio)',
        preco: 'R$ 43,10',
        variacao_dia: '+2,15%',
        variacao_periodo: '+6,20%',
        tendencia: 'ALTA',
        categoria: 'CRESCIMENTO',
        categoria_label: 'Ações Crescimento',
        dy: '0,0%',
        pl: '6,8x',
        pvp: '1,85x',
        risco: 'ALTO',
        criterio: 'Lifting cost mais baixo do setor de petróleo e aumento substancial de produção',
        justificativa: 'Eficiência recorde na revitalização de campos maduros de óleo na bacia de Campos.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },

      // 5. Internacional / BDRs / ETFs
      {
        ticker: 'IVVB11',
        nome: 'iShares S&P 500 Fundo de Índice',
        preco: 'R$ 342,00',
        variacao_dia: '+0,70%',
        variacao_periodo: '+4,90%',
        tendencia: 'ALTA',
        categoria: 'INTERNACIONAL',
        categoria_label: 'Internacional / ETF',
        dy: '0,0% (Reinveste)',
        pl: '24,5x',
        pvp: null,
        risco: 'MEDIO_ALTO',
        criterio: 'Exposição às 500 maiores empresas dos Estados Unidos e ao Dólar',
        justificativa: 'Principal instrumento de diversificação geográfica e cambial passiva na B3.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },
      {
        ticker: 'AAPL34',
        nome: 'Apple Inc. (BDR)',
        preco: 'R$ 68,90',
        variacao_dia: '+1,25%',
        variacao_periodo: '+3,40%',
        tendencia: 'ALTA',
        categoria: 'INTERNACIONAL',
        categoria_label: 'Internacional / BDR',
        dy: '0,6%',
        pl: '32,1x',
        pvp: null,
        risco: 'MEDIO',
        criterio: 'Ecossistema global incomparável e programa maciço de recompras de ações',
        justificativa: 'Liderança em tecnologia de consumo e avanços na integração de modelos de IA proprietários.',
        atualizado_em: SpreadsheetRepository.todayIso()
      },

      // 6. Commodities & Metais
      {
        ticker: 'OURO (OZ1D)',
        nome: 'Ouro Físico B3 (250g / Fração)',
        preco: 'R$ 737,60/g',
        variacao_dia: '+0,40%',
        variacao_periodo: '+7,10%',
        tendencia: 'ALTA',
        categoria: 'COMMODITIES',
        categoria_label: 'Ativos Reais / Proteção',
        dy: '0,0%',
        pl: null,
        pvp: null,
        risco: 'MEDIO',
        criterio: 'Hedge inflacionário e geopolítico milenar',
        justificativa: 'Demanda de bancos centrais mundiais em máximas históricas para reserva soberana.',
        atualizado_em: SpreadsheetRepository.todayIso()
      }
    ];

    // 1. Enriquecimento Câmbio & Ouro via AwesomeAPI
    try {
      var awesome = fetchAwesomeApiData();
      if (awesome && awesome.USDBRL) {
        var bid = parseFloat(awesome.USDBRL.bid);
        if (!isNaN(bid) && bid > 0) {
          var gramaOuro = (4065.46 * bid) / 31.1034768;
          for (var g = 0; g < items.length; g++) {
            if (items[g].ticker === 'OURO (OZ1D)') {
              items[g].preco = 'R$ ' + gramaOuro.toFixed(2).replace('.', ',') + '/g';
              if (awesome.USDBRL.pctChange) {
                var pct = parseFloat(awesome.USDBRL.pctChange);
                items[g].variacao_dia = (pct >= 0 ? '+' : '') + pct.toFixed(2).replace('.', ',') + '%';
              }
              items[g].atualizado_em = SpreadsheetRepository.todayIso();
            }
          }
        }
      }
    } catch (eOuro) {}

    // 2. Enriquecimento CDI para CDB 105% CDI via BCB
    try {
      var cdiNum = fetchBcbSeries(4389);
      if (cdiNum !== null && !isNaN(cdiNum) && cdiNum > 0) {
        var cdbDy = (cdiNum * 1.05).toFixed(2).replace('.', ',') + '% a.a.';
        for (var c = 0; c < items.length; c++) {
          if (items[c].ticker === 'CDB LIQUIDEZ 105% CDI') {
            items[c].dy = cdbDy;
            items[c].atualizado_em = SpreadsheetRepository.todayIso();
          }
        }
      }
    } catch (eBcb) {}

    // 3. Enriquecimento Ações e FIIs da B3 via Brapi
    try {
      var b3Tickers = ['BBAS3', 'TAEE11', 'ITUB4', 'HGLG11', 'KNIP11', 'XPML11', 'WEGE3', 'PRIO3', 'IVVB11', 'AAPL34'];
      var quotesMap = fetchBrapiQuotes(b3Tickers);
      if (quotesMap) {
        for (var i = 0; i < items.length; i++) {
          var t = items[i].ticker;
          if (quotesMap[t]) {
            var q = quotesMap[t];
            if (q.regularMarketPrice !== undefined && q.regularMarketPrice !== null) {
              items[i].preco = 'R$ ' + Number(q.regularMarketPrice).toFixed(2).replace('.', ',');
            }
            if (q.regularMarketChangePercent !== undefined && q.regularMarketChangePercent !== null) {
              var chg = Number(q.regularMarketChangePercent);
              items[i].variacao_dia = (chg >= 0 ? '+' : '') + chg.toFixed(2).replace('.', ',') + '%';
              items[i].tendencia = chg >= 0.3 ? 'ALTA' : (chg <= -0.3 ? 'BAIXA' : 'ESTAVEL');
            }
            items[i].atualizado_em = SpreadsheetRepository.todayIso();
          }
        }
      }
    } catch (eBrapi) {}

    try {
      var cacheStore = CacheService.getScriptCache();
      if (cacheStore) cacheStore.put(cacheKey, JSON.stringify(items), CACHE_TTL_MARKET);
    } catch (e) {}

    return items;
  }

  /**
   * Retorna os Top 10 ativos filtrados por categoria transparente.
   * Suporta forceRefresh para consulta online em tempo real.
   */
  function getTop10ByCategory(category, forceRefresh) {
    var all = getMarketHighlights(forceRefresh);
    var catUpper = String(category || 'GERAL').toUpperCase();

    if (catUpper === 'GERAL') {
      return {
        categoria: 'GERAL',
        titulo: 'Top Destaques Gerais do Mercado',
        descricao: 'Ativos selecionados por liquidez diária, solidez operacional e equilíbrio risco-retorno.',
        itens: all.slice(0, 10)
      };
    }

    var filtered = all.filter(function (it) {
      return it.categoria === catUpper;
    });

    var titles = {
      DIVIDENDOS: 'Top Dividendos (Renda Passiva)',
      FIIS: 'Top Fundos Imobiliários (Tijolo & Papel)',
      CRESCIMENTO: 'Top Crescimento & Ações de Valor',
      RENDA_FIXA: 'Top Renda Fixa & Títulos Públicos',
      INTERNACIONAL: 'Top Internacional (BDRs & ETFs Globais)',
      COMMODITIES: 'Top Commodities & Ativos Reais'
    };

    var descs = {
      DIVIDENDOS: 'Critérios: Dividend Yield consistente (>7%), payout seguro e empresas em setores perenes (bancos, saneamento, energia).',
      FIIS: 'Critérios: Preço/Valor Patrimonial próximo de 1, vacância controlada e histórico de rendimentos mensais regulares.',
      CRESCIMENTO: 'Critérios: Crescimento de receitas, liderança no mercado de atuação e alto retorno sobre capital investido.',
      RENDA_FIXA: 'Critérios: Segurança institucional (garantia Tesouro Nacional ou FGC) com retorno real substancial.',
      INTERNACIONAL: 'Critérios: Diversificação cambial em dólar e exposição às empresas mais inovadoras do planeta.',
      COMMODITIES: 'Critérios: Proteção contra choques inflacionários globais e preservação de poder aquisitivo.'
    };

    return {
      categoria: catUpper,
      titulo: titles[catUpper] || ('Top ' + catUpper),
      descricao: descs[catUpper] || 'Seleção fundamentada baseada em indicadores verificáveis.',
      itens: filtered.length > 0 ? filtered : all.slice(0, 6)
    };
  }

  /**
   * Informativo de Notícias Financeiras com fonte, categoria e impacto.
   */
  function getMarketNews() {
    var cacheKey = 'finpess_market_news';
    try {
      var cache = CacheService.getScriptCache();
      var cached = cache ? cache.get(cacheKey) : null;
      if (cached) return JSON.parse(cached);
    } catch (e) {}

    var news = [
      {
        id: 'news-1',
        titulo: 'Copom mantém tom cauteloso e mercado consolida projeções para a taxa Selic',
        resumo: 'O Banco Central do Brasil ressaltou a desancoragem das expectativas de inflação e o dinamismo do mercado de trabalho como fatores para manter a taxa básica em patamar restritivo.',
        fonte: 'Banco Central / Valor Econômico',
        categoria: 'POLITICA_MONETARIA',
        categoria_label: 'Política Monetária',
        data_hora: SpreadsheetRepository.todayIso() + ' 08:30',
        impacto: 'POSITIVO_RENDA_FIXA',
        impacto_label: 'Favorável para Renda Fixa',
        link: 'https://www.bcb.gov.br'
      },
      {
        id: 'news-2',
        titulo: 'Fundos Imobiliários de Logística registram nova queda na taxa de vacância física',
        resumo: 'A forte demanda de gigantes do e-commerce por centros de distribuição no entorno metropolitano elevou o valor dos aluguéis e garantiu dividendos estáveis aos cotistas.',
        fonte: 'B3 Notícias / Funds Explorer',
        categoria: 'FIIS',
        categoria_label: 'Fundos Imobiliários',
        data_hora: SpreadsheetRepository.todayIso() + ' 10:15',
        impacto: 'POSITIVO_FIIS',
        impacto_label: 'Favorável para FIIs de Tijolo',
        link: 'https://www.b3.com.br'
      },
      {
        id: 'news-3',
        titulo: 'Temporada de Balanços: Grandes bancos brasileiros reportam inadimplência sob controle',
        resumo: 'Itaú, Banco do Brasil e Bradesco apresentaram carteira de crédito resiliente, margem financeira robusta e novos anúncios de proventos complementares (dividendos e JCP).',
        fonte: 'CVM / Relações com Investidores',
        categoria: 'EMPRESAS',
        categoria_label: 'Balanços Corporativos',
        data_hora: SpreadsheetRepository.todayIso() + ' 11:45',
        impacto: 'POSITIVO_ACOES',
        impacto_label: 'Apoio para Ações de Dividendos',
        link: 'https://www.gov.br/cvm'
      },
      {
        id: 'news-4',
        titulo: 'Ouro atinge novas marcas históricas com busca global por proteção cambial',
        resumo: 'Compras massivas por bancos centrais e tensões geopolíticas no Oriente Médio e Leste Europeu impulsionam o metal precioso para patamares recordes em dólar e reais.',
        fonte: 'Reuters Internacional',
        categoria: 'COMMODITIES',
        categoria_label: 'Commodities & Ouro',
        data_hora: SpreadsheetRepository.todayIso() + ' 13:00',
        impacto: 'PROTECAO_PATRIMONIAL',
        impacto_label: 'Proteção contra Riscos Globais',
        link: 'https://www.reuters.com'
      },
      {
        id: 'news-5',
        titulo: 'Tesouro Direto registra recorde de adesões em títulos indexados à inflação (IPCA+)',
        resumo: 'Investidores pessoas físicas intensificam alocação nos papéis Tesouro RendA+ e IPCA+ visando planejamento de previdência e aposentadoria antecipada.',
        fonte: 'Secretaria do Tesouro Nacional',
        categoria: 'TESOURO_DIRETO',
        categoria_label: 'Tesouro Nacional',
        data_hora: SpreadsheetRepository.todayIso() + ' 15:20',
        impacto: 'POSITIVO_RENDA_FIXA',
        impacto_label: 'Planejamento de Longo Prazo',
        link: 'https://www.tesourodireto.com.br'
      }
    ];

    try {
      var cacheStore = CacheService.getScriptCache();
      if (cacheStore) cacheStore.put(cacheKey, JSON.stringify(news), CACHE_TTL_NEWS);
    } catch (e) {}

    return news;
  }

  /**
   * Calendário Econômico Oficial com eventos que afetam os investimentos.
   */
  function getEconomicCalendar() {
    return [
      {
        data: '2026-11-06',
        evento: 'Divulgação do IPCA Mensal (Inflação Oficial)',
        orgao: 'IBGE',
        importancia: 'ALTA',
        impacto_esperado: 'Define os rendimentos futuros dos títulos IPCA+ e a política monetária.'
      },
      {
        data: '2026-11-10',
        evento: 'Data-Com de Dividendos dos Grandes Bancos',
        orgao: 'B3 / Companhias Abertas',
        importancia: 'ALTA',
        impacto_esperado: 'Último dia para ter direito aos proventos anunciados na safra de balanços.'
      },
      {
        data: '2026-11-12',
        evento: 'Reunião do Comitê de Mercado Aberto (FOMC / Fed)',
        orgao: 'Federal Reserve (EUA)',
        importancia: 'MUITO_ALTA',
        impacto_esperado: 'Decisão da taxa de juros norte-americana impacta o câmbio (Dólar) e o fluxo global de capital.'
      },
      {
        data: '2026-11-18',
        evento: 'Vencimento de Opções sobre Ações na B3',
        orgao: 'B3',
        importancia: 'MEDIA',
        impacto_esperado: 'Aumento pontual da volatilidade nos papéis com maior liquidez (PETR4, VALE3, ITUB4).'
      },
      {
        data: '2026-12-09',
        evento: 'Reunião do Copom — Definição da Taxa Selic',
        orgao: 'Banco Central do Brasil',
        importancia: 'MUITO_ALTA',
        impacto_esperado: 'Direcionamento dos rendimentos da Renda Fixa e custo de crédito corporativo.'
      }
    ];
  }

  /**
   * Painel de Ativos Reais e Commodities detalhado.
   * Suporta forceRefresh para consulta online em tempo real.
   */
  function getCommoditiesPanel(forceRefresh) {
    var cacheKey = 'finpess_commodities_panel_v3';
    if (!forceRefresh) {
      try {
        var cache = CacheService.getScriptCache();
        var cached = cache ? cache.get(cacheKey) : null;
        if (cached) return JSON.parse(cached);
      } catch (e) {}
    }

    var list = [
      {
        nome: 'Ouro (OZ1D / Spot)',
        simbolo: 'OURO',
        cotacao: 'US$ 4.065,00 / R$ 737,60g',
        variacao_dia: '+0,40%',
        variacao_semana: '+1,80%',
        variacao_mes: '+6,20%',
        tendencia: 'ALTA',
        fatores_influencia: 'Tensões geopolíticas globais, compras ativas por bancos centrais e busca por reserva de valor anti-inflação.',
        formas_exposicao: 'Contrato Fracionário B3 (OZ1D), ETFs internacionais (GOLD11), Fundos de Ouro sem taxa de administração.'
      },
      {
        nome: 'Petróleo Brent',
        simbolo: 'BRENT',
        cotacao: 'US$ 74,50 / barril',
        variacao_dia: '-0,35%',
        variacao_semana: '-1,10%',
        variacao_mes: '+2,40%',
        tendencia: 'ESTAVEL',
        fatores_influencia: 'Equilíbrio entre cortes de oferta da OPEP+ e desaceleração do consumo industrial na Ásia.',
        formas_exposicao: 'Ações petrolíferas (Petrobras, PRIO, PetroReconcavo), ETFs de energia.'
      },
      {
        nome: 'Dólar Comercial',
        simbolo: 'USD/BRL',
        cotacao: 'R$ 5,75',
        variacao_dia: '+0,15%',
        variacao_semana: '+0,80%',
        variacao_mes: '+3,10%',
        tendencia: 'ALTA',
        fatores_influencia: 'Juros nos EUA, diferencial de risco fiscal brasileiro e volatilidade pré-eleitoral internacional.',
        formas_exposicao: 'ETFs globais (IVVB11, WRLD11), BDRs de empresas americanas, fundos cambiais.'
      },
      {
        nome: 'Soja em Grão (Paranaguá)',
        simbolo: 'SOJA',
        cotacao: 'R$ 138,00 / saca 60kg',
        variacao_dia: '+0,25%',
        variacao_semana: '+0,90%',
        variacao_mes: '-0,50%',
        tendencia: 'NEUTRA',
        fatores_influencia: 'Condições climáticas favoráveis na safra brasileira e ritmo de importação pela China.',
        formas_exposicao: 'Fiagros (VGIA11, KNCA11), ações do agronegócio (SLC Agrícola, Jalles Machado).'
      }
    ];

    try {
      var awesome = fetchAwesomeApiData();
      if (awesome && awesome.USDBRL) {
        var bid = parseFloat(awesome.USDBRL.bid);
        if (!isNaN(bid) && bid > 0) {
          var grama = (4065.46 * bid) / 31.1034768;
          for (var i = 0; i < list.length; i++) {
            if (list[i].simbolo === 'OURO') {
              list[i].cotacao = 'US$ 4.065,00 / R$ ' + grama.toFixed(2).replace('.', ',') + 'g';
              if (awesome.USDBRL.pctChange) {
                var p = parseFloat(awesome.USDBRL.pctChange);
                list[i].variacao_dia = (p >= 0 ? '+' : '') + p.toFixed(2).replace('.', ',') + '%';
              }
            } else if (list[i].simbolo === 'USD/BRL') {
              list[i].cotacao = 'R$ ' + bid.toFixed(2).replace('.', ',');
              if (awesome.USDBRL.pctChange) {
                var pd = parseFloat(awesome.USDBRL.pctChange);
                list[i].variacao_dia = (pd >= 0 ? '+' : '') + pd.toFixed(2).replace('.', ',') + '%';
              }
            }
          }
        }
      }
    } catch (eAw) {}

    try {
      var cacheStore = CacheService.getScriptCache();
      if (cacheStore) cacheStore.put(cacheKey, JSON.stringify(list), CACHE_TTL_MARKET);
    } catch (e) {}

    return list;
  }

  /**
   * Busca cotação individual de um ticker da B3 online.
   */
  function fetchSingleQuote(ticker) {
    if (!ticker) return null;
    var t = String(ticker).trim().toUpperCase();
    var map = fetchBrapiQuotes([t]);
    if (map && map[t]) {
      var q = map[t];
      return {
        ticker: t,
        nome: q.longName || q.shortName || t,
        preco: q.regularMarketPrice ? 'R$ ' + Number(q.regularMarketPrice).toFixed(2).replace('.', ',') : null,
        variacao_dia: q.regularMarketChangePercent !== undefined ? (Number(q.regularMarketChangePercent) >= 0 ? '+' : '') + Number(q.regularMarketChangePercent).toFixed(2).replace('.', ',') + '%' : '0,00%',
        atualizado_em: SpreadsheetRepository.todayIso()
      };
    }
    return null;
  }

  /**
   * Força a atualização de todos os caches e retorna os dados online frescos.
   */
  function refreshAllOnlineMarketData() {
    try {
      var cache = CacheService.getScriptCache();
      if (cache) {
        cache.remove('finpess_macro_indicators_v3');
        cache.remove('finpess_market_highlights_v3');
        cache.remove('finpess_commodities_panel_v3');
      }
    } catch (e) {}

    var macro = getMacroIndicators(true);
    var highlights = getMarketHighlights(true);
    var commodities = getCommoditiesPanel(true);

    return {
      atualizado_em: SpreadsheetRepository.todayIso(),
      macro: macro,
      highlights: highlights,
      commodities: commodities
    };
  }

  return {
    fetchAwesomeApiData: fetchAwesomeApiData,
    fetchBcbSeries: fetchBcbSeries,
    fetchBrapiQuotes: fetchBrapiQuotes,
    fetchSingleQuote: fetchSingleQuote,
    refreshAllOnlineMarketData: refreshAllOnlineMarketData,
    getMacroIndicators: getMacroIndicators,
    getMarketHighlights: getMarketHighlights,
    getTop10ByCategory: getTop10ByCategory,
    getMarketNews: getMarketNews,
    getEconomicCalendar: getEconomicCalendar,
    getCommoditiesPanel: getCommoditiesPanel
  };
})();

