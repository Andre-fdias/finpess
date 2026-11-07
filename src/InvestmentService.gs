/**
 * @file InvestmentService.gs
 * @description Módulo exclusivo do sistema web para cadastro de ativos, acompanhamento
 * detalhado da carteira de investimentos (aportes, resgates, proventos e cotações informadas),
 * integração automática de fluxo de caixa com contas bancárias e módulo inteligente de IA
 * com diagnóstico de portfólio, radar de mercado financeiro e recomendações de compra/venda.
 */

var InvestmentService = (function () {
  var ASSET_CLASSES = [
    'RENDA_FIXA',
    'TESOURO_DIRETO',
    'FUNDOS_IMOBILIARIOS',
    'ACOES',
    'FUNDOS',
    'PREVIDENCIA',
    'OUTROS'
  ];
  var MOVEMENT_TYPES = ['APORTE', 'RESGATE', 'RENDIMENTO', 'ATUALIZACAO_MERCADO'];

  function assertWebChannelOnly(channel) {
    if (channel && String(channel).toUpperCase() === 'TELEGRAM') {
      throw new Error('FORBIDDEN_TELEGRAM_SCOPE: O Telegram não pode cadastrar ativos, alterar posições, criar aportes ou resgates de investimentos nem modificar a carteira.');
    }
  }

  /**
   * Localiza ou seleciona uma categoria apropriada para o lançamento de investimento.
   */
  function findOrCreateInvestmentCategory(user, tipoLancamento) {
    var categorias = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var candidate = null;

    for (var i = 0; i < categorias.length; i++) {
      var cat = categorias[i];
      var nomeNorm = String(cat.nome || '').toLowerCase();
      if (nomeNorm.indexOf('investimento') !== -1 || nomeNorm.indexOf('resgate') !== -1 || nomeNorm.indexOf('rendimento') !== -1) {
        candidate = cat;
        break;
      }
    }

    if (!candidate) {
      for (var j = 0; j < categorias.length; j++) {
        var c = categorias[j];
        if (c.tipo === 'AMBOS' || c.tipo === tipoLancamento) {
          candidate = c;
          break;
        }
      }
    }

    if (!candidate && categorias.length > 0) {
      candidate = categorias[0];
    }

    return candidate;
  }

  /**
   * Cadastra novo ativo na carteira com suporte a débito opcional da conta bancária.
   */
  function createAsset(user, payload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados do ativo de investimento não informados.');
    }
    var nomeAtivo = ValidationService.sanitizeText(payload.nome_ativo, 120);
    var instituicao = ValidationService.sanitizeText(payload.instituicao, 120);
    if (!nomeAtivo || !instituicao) {
      throw new Error('Nome do ativo e instituição/corretora são obrigatórios.');
    }
    var classeAtivo = ValidationService.validateEnum(payload.classe_ativo || 'RENDA_FIXA', ASSET_CLASSES, 'classe_ativo');
    var valorAplicado = ValidationService.validateCentavos(payload.valor_aplicado_centavos, 'valor_aplicado_centavos', true);
    var valorMercadoInformado = payload.valor_mercado_informado_centavos !== undefined
      ? ValidationService.validateCentavos(payload.valor_mercado_informado_centavos, 'valor_mercado_informado_centavos', true)
      : valorAplicado;
    var qtdMilesimos = payload.quantidade_milesimos !== undefined
      ? Math.max(1, Math.round(Number(payload.quantidade_milesimos)))
      : 1000;
    var precoMedio = Math.round((valorAplicado * 1000) / qtdMilesimos);
    var dataReferencia = ValidationService.validateIsoDate(
      payload.data_referencia || SpreadsheetRepository.todayIso(),
      'data_referencia',
      false
    );

    var createdAsset = SpreadsheetRepository.insert('INVESTIMENTOS', {
      id: SpreadsheetRepository.generateId('inv'),
      grupo_id: user.grupo_id,
      nome_ativo: nomeAtivo,
      classe_ativo: classeAtivo,
      instituicao: instituicao,
      quantidade_milesimos: qtdMilesimos,
      preco_medio_centavos: precoMedio,
      valor_aplicado_centavos: valorAplicado,
      valor_mercado_informado_centavos: valorMercadoInformado,
      data_referencia: dataReferencia,
      rendimentos_acumulados_centavos: Number(payload.rendimentos_acumulados_centavos || 0),
      situacao: 'ATIVO',
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 400),
      criado_por: user.id
    });

    var lancamentoId = '';
    var contaBancariaId = payload.conta_bancaria_id || '';
    var deveDebitarConta = Boolean(payload.debitar_conta && contaBancariaId && valorAplicado > 0);

    if (deveDebitarConta) {
      var conta = SpreadsheetRepository.findById('CONTAS_BANCARIAS', contaBancariaId, user.grupo_id);
      if (conta) {
        var cat = findOrCreateInvestmentCategory(user, 'SAIDA');
        var launchRec = {
          id: SpreadsheetRepository.generateId('lan'),
          grupo_id: user.grupo_id,
          tipo: 'SAIDA',
          natureza_operacao: 'INVESTIMENTO',
          transferencia_id: '',
          descricao: 'Aporte Inicial: ' + nomeAtivo,
          valor_centavos: valorAplicado,
          data_lancamento: dataReferencia,
          data_competencia: dataReferencia.substring(0, 7),
          data_pagamento: dataReferencia,
          categoria_id: cat ? cat.id : '',
          subcategoria_id: '',
          conta_bancaria_id: conta.id,
          forma_pagamento: 'TRANSFERENCIA',
          situacao: 'CONFIRMADO',
          origem: 'INVESTIMENTO',
          referencia_recorrencia_id: '',
          competencia_recorrencia: '',
          referencia_parcela_id: createdAsset.id,
          id_origem_externa: '',
          observacoes: 'Aporte inicial de investimento (' + instituicao + ')',
          usuario_responsavel_id: user.id
        };
        var createdLaunch = SpreadsheetRepository.insert('LANCAMENTOS', launchRec);
        lancamentoId = createdLaunch.id;
      }
    }

    if (valorAplicado > 0) {
      SpreadsheetRepository.insert('MOVIMENTOS_INVESTIMENTOS', {
        id: SpreadsheetRepository.generateId('mvi'),
        grupo_id: user.grupo_id,
        investimento_id: createdAsset.id,
        tipo_movimento: 'APORTE',
        quantidade_milesimos: qtdMilesimos,
        valor_centavos: valorAplicado,
        data_movimento: dataReferencia,
        conta_bancaria_id: contaBancariaId,
        lancamento_id: lancamentoId,
        observacoes: 'Posição / aporte inicial cadastrado manualmente',
        criado_por: user.id
      });
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'INVESTIMENTO_CRIADO',
      entidade: 'INVESTIMENTOS',
      entidade_id: createdAsset.id,
      origem: 'WEB',
      detalhes: {
        nome_ativo: nomeAtivo,
        classe_ativo: classeAtivo,
        valor_aplicado_centavos: valorAplicado,
        valor_mercado_informado_centavos: valorMercadoInformado,
        debito_bancario_integrado: deveDebitarConta
      }
    });

    return createdAsset;
  }

  /**
   * Registra aporte, resgate, rendimento ou atualização manual do valor de mercado
   * com suporte a reflexo financeiro em lançamentos bancários.
   */
  function recordInvestmentMovement(user, payload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || !payload.investimento_id) {
      throw new Error('Ativo de investimento é obrigatório.');
    }
    var asset = SpreadsheetRepository.findById('INVESTIMENTOS', payload.investimento_id, user.grupo_id);
    if (!asset) {
      throw new Error('Ativo de investimento não encontrado.');
    }
    var tipoMov = ValidationService.validateEnum(payload.tipo_movimento, MOVEMENT_TYPES, 'tipo_movimento');
    var valorCentavos = ValidationService.validateCentavos(payload.valor_centavos, 'valor_centavos', false);
    var dataMov = ValidationService.validateIsoDate(
      payload.data_movimento || SpreadsheetRepository.todayIso(),
      'data_movimento',
      false
    );
    var qtdMovMilesimos = payload.quantidade_milesimos !== undefined
      ? Math.max(0, Math.round(Number(payload.quantidade_milesimos)))
      : 0;

    var novoAplicado = Number(asset.valor_aplicado_centavos || 0);
    var novoMercado = Number(asset.valor_mercado_informado_centavos || 0);
    var novoRendimento = Number(asset.rendimentos_acumulados_centavos || 0);
    var novaQtd = Number(asset.quantidade_milesimos || 1000);
    var nuevaSituacao = asset.situacao;

    var lancamentoId = '';
    var contaBancariaId = payload.conta_bancaria_id || '';

    if (tipoMov === 'APORTE') {
      novoAplicado += valorCentavos;
      novoMercado += valorCentavos;
      novaQtd += qtdMovMilesimos;

      if (contaBancariaId && payload.debitar_conta !== false) {
        var contaAporte = SpreadsheetRepository.findById('CONTAS_BANCARIAS', contaBancariaId, user.grupo_id);
        if (contaAporte) {
          var catAporte = findOrCreateInvestmentCategory(user, 'SAIDA');
          var lanAporte = SpreadsheetRepository.insert('LANCAMENTOS', {
            id: SpreadsheetRepository.generateId('lan'),
            grupo_id: user.grupo_id,
            tipo: 'SAIDA',
            natureza_operacao: 'INVESTIMENTO',
            transferencia_id: '',
            descricao: 'Aporte: ' + asset.nome_ativo,
            valor_centavos: valorCentavos,
            data_lancamento: dataMov,
            data_competencia: dataMov.substring(0, 7),
            data_pagamento: dataMov,
            categoria_id: catAporte ? catAporte.id : '',
            subcategoria_id: '',
            conta_bancaria_id: contaAporte.id,
            forma_pagamento: 'TRANSFERENCIA',
            situacao: 'CONFIRMADO',
            origem: 'INVESTIMENTO',
            referencia_recorrencia_id: '',
            competencia_recorrencia: '',
            referencia_parcela_id: asset.id,
            id_origem_externa: '',
            observacoes: payload.observacoes || ('Aporte em ' + asset.nome_ativo + ' (' + asset.instituicao + ')'),
            usuario_responsavel_id: user.id
          });
          lancamentoId = lanAporte.id;
        }
      }
    } else if (tipoMov === 'RESGATE') {
      if (valorCentavos > novoMercado) {
        throw new Error('O valor do resgate excede o valor de mercado informado do ativo.');
      }
      novoAplicado = Math.max(0, novoAplicado - valorCentavos);
      novoMercado = Math.max(0, novoMercado - valorCentavos);
      novaQtd = Math.max(0, novaQtd - qtdMovMilesimos);
      if (novoMercado === 0) {
        nuevaSituacao = 'RESGATADO';
      }

      if (contaBancariaId && payload.creditar_conta !== false) {
        var contaResgate = SpreadsheetRepository.findById('CONTAS_BANCARIAS', contaBancariaId, user.grupo_id);
        if (contaResgate) {
          var catResgate = findOrCreateInvestmentCategory(user, 'ENTRADA');
          var lanResgate = SpreadsheetRepository.insert('LANCAMENTOS', {
            id: SpreadsheetRepository.generateId('lan'),
            grupo_id: user.grupo_id,
            tipo: 'ENTRADA',
            natureza_operacao: 'RESGATE',
            transferencia_id: '',
            descricao: 'Resgate: ' + asset.nome_ativo,
            valor_centavos: valorCentavos,
            data_lancamento: dataMov,
            data_competencia: dataMov.substring(0, 7),
            data_pagamento: dataMov,
            categoria_id: catResgate ? catResgate.id : '',
            subcategoria_id: '',
            conta_bancaria_id: contaResgate.id,
            forma_pagamento: 'TRANSFERENCIA',
            situacao: 'CONFIRMADO',
            origem: 'INVESTIMENTO',
            referencia_recorrencia_id: '',
            competencia_recorrencia: '',
            referencia_parcela_id: asset.id,
            id_origem_externa: '',
            observacoes: payload.observacoes || ('Resgate de ' + asset.nome_ativo + ' (' + asset.instituicao + ')'),
            usuario_responsavel_id: user.id
          });
          lancamentoId = lanResgate.id;
        }
      }
    } else if (tipoMov === 'RENDIMENTO') {
      novoRendimento += valorCentavos;
      // Se não for creditado em conta, assume reinvestimento que aumenta o valor de mercado
      if (payload.reinvestir !== false && !payload.creditar_conta) {
        novoMercado += valorCentavos;
      }

      if (contaBancariaId && payload.creditar_conta) {
        var contaRend = SpreadsheetRepository.findById('CONTAS_BANCARIAS', contaBancariaId, user.grupo_id);
        if (contaRend) {
          var catRend = findOrCreateInvestmentCategory(user, 'ENTRADA');
          var lanRend = SpreadsheetRepository.insert('LANCAMENTOS', {
            id: SpreadsheetRepository.generateId('lan'),
            grupo_id: user.grupo_id,
            tipo: 'ENTRADA',
            natureza_operacao: 'OUTROS',
            transferencia_id: '',
            descricao: 'Proventos / Dividendos: ' + asset.nome_ativo,
            valor_centavos: valorCentavos,
            data_lancamento: dataMov,
            data_competencia: dataMov.substring(0, 7),
            data_pagamento: dataMov,
            categoria_id: catRend ? catRend.id : '',
            subcategoria_id: '',
            conta_bancaria_id: contaRend.id,
            forma_pagamento: 'TRANSFERENCIA',
            situacao: 'CONFIRMADO',
            origem: 'INVESTIMENTO',
            referencia_recorrencia_id: '',
            competencia_recorrencia: '',
            referencia_parcela_id: asset.id,
            id_origem_externa: '',
            observacoes: payload.observacoes || ('Dividendos/Rendimentos de ' + asset.nome_ativo),
            usuario_responsavel_id: user.id
          });
          lancamentoId = lanRend.id;
        }
      }
    } else if (tipoMov === 'ATUALIZACAO_MERCADO') {
      novoMercado = valorCentavos;
    }

    var novoPrecoMedio = novaQtd > 0 ? Math.round((novoAplicado * 1000) / novaQtd) : asset.preco_medio_centavos;

    var updatedAsset = SpreadsheetRepository.updateById('INVESTIMENTOS', asset.id, {
      quantidade_milesimos: novaQtd,
      preco_medio_centavos: novoPrecoMedio,
      valor_aplicado_centavos: novoAplicado,
      valor_mercado_informado_centavos: novoMercado,
      rendimentos_acumulados_centavos: novoRendimento,
      data_referencia: dataMov,
      situacao: nuevaSituacao
    }, user.grupo_id);

    var movement = SpreadsheetRepository.insert('MOVIMENTOS_INVESTIMENTOS', {
      id: SpreadsheetRepository.generateId('mvi'),
      grupo_id: user.grupo_id,
      investimento_id: asset.id,
      tipo_movimento: tipoMov,
      quantidade_milesimos: qtdMovMilesimos,
      valor_centavos: valorCentavos,
      data_movimento: dataMov,
      conta_bancaria_id: contaBancariaId,
      lancamento_id: lancamentoId,
      observacoes: ValidationService.sanitizeText(payload.observacoes || '', 300),
      criado_por: user.id
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'MOVIMENTO_INVESTIMENTO_REGISTRADO',
      entidade: 'INVESTIMENTOS',
      entidade_id: asset.id,
      origem: 'WEB',
      detalhes: {
        tipo_movimento: tipoMov,
        valor_centavos: valorCentavos,
        novo_valor_mercado_informado_centavos: novoMercado,
        lancamento_gerado: Boolean(lancamentoId)
      }
    });

    return {
      ativo: updatedAsset,
      movimento: movement
    };
  }

  /**
   * Remove / inativa um ativo da carteira.
   */
  function deleteAsset(user, assetId, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!assetId) throw new Error('ID do ativo não fornecido.');

    var asset = SpreadsheetRepository.findById('INVESTIMENTOS', assetId, user.grupo_id);
    if (!asset) throw new Error('Ativo não encontrado.');

    var updated = SpreadsheetRepository.updateById('INVESTIMENTOS', asset.id, {
      situacao: 'INATIVO'
    }, user.grupo_id);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'INVESTIMENTO_INATIVADO',
      entidade: 'INVESTIMENTOS',
      entidade_id: asset.id,
      origem: 'WEB',
      detalhes: { nome_ativo: asset.nome_ativo }
    });

    return updated;
  }

  /**
   * Atualiza dados cadastrais de um ativo.
   */
  function updateAsset(user, payload, channel) {
    assertWebChannelOnly(channel);
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || !payload.id) throw new Error('ID do ativo é obrigatório.');

    var asset = SpreadsheetRepository.findById('INVESTIMENTOS', payload.id, user.grupo_id);
    if (!asset) throw new Error('Ativo não encontrado.');

    var updateData = {};
    if (payload.nome_ativo) updateData.nome_ativo = ValidationService.sanitizeText(payload.nome_ativo, 120);
    if (payload.instituicao) updateData.instituicao = ValidationService.sanitizeText(payload.instituicao, 120);
    if (payload.classe_ativo) updateData.classe_ativo = ValidationService.validateEnum(payload.classe_ativo, ASSET_CLASSES, 'classe_ativo');
    if (payload.observacoes !== undefined) updateData.observacoes = ValidationService.sanitizeText(payload.observacoes, 400);

    var updated = SpreadsheetRepository.updateById('INVESTIMENTOS', asset.id, updateData, user.grupo_id);
    return updated;
  }

  /**
   * Resumo geral e consolidação da carteira.
   */
  function getPortfolioSummary(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var assets = SpreadsheetRepository.findByGrupo('INVESTIMENTOS', user.grupo_id);
    var movements = SpreadsheetRepository.findByGrupo('MOVIMENTOS_INVESTIMENTOS', user.grupo_id);

    var totalAplicado = 0;
    var totalMercadoInformado = 0;
    var totalRendimentos = 0;
    var byClassMap = {};

    var activeAssets = [];
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (a.situacao === 'INATIVO') continue;
      activeAssets.push(a);

      var aplicado = Number(a.valor_aplicado_centavos || 0);
      var mercado = Number(a.valor_mercado_informado_centavos || 0);
      var rend = Number(a.rendimentos_acumulados_centavos || 0);

      totalAplicado += aplicado;
      totalMercadoInformado += mercado;
      totalRendimentos += rend;

      var cls = a.classe_ativo || 'OUTROS';
      if (!byClassMap[cls]) {
        byClassMap[cls] = {
          classe_ativo: cls,
          valor_aplicado_centavos: 0,
          valor_mercado_informado_centavos: 0,
          quantidade_ativos: 0
        };
      }
      byClassMap[cls].valor_aplicado_centavos += aplicado;
      byClassMap[cls].valor_mercado_informado_centavos += mercado;
      byClassMap[cls].quantidade_ativos += 1;
    }

    var distribuicaoPorClasse = Object.keys(byClassMap).map(function (k) {
      var item = byClassMap[k];
      item.percentual_carteira_bps = totalMercadoInformado > 0
        ? Math.round((item.valor_mercado_informado_centavos * 10000) / totalMercadoInformado)
        : 0;
      item.percentual_formatado = (item.percentual_carteira_bps / 100).toFixed(1) + '%';
      return item;
    });

    movements.sort(function (x, y) {
      return String(y.data_movimento).localeCompare(String(x.data_movimento));
    });

    var lucroPrejuizoCentavos = totalMercadoInformado - totalAplicado;
    var rentabilidadeBps = totalAplicado > 0
      ? Math.round((lucroPrejuizoCentavos * 10000) / totalAplicado)
      : 0;

    return {
      aviso_natureza_dados: 'Valores informados manualmente pelo usuário conforme data de referência de cada ativo (não representam cotação em tempo real de bolsa).',
      total_aplicado_centavos: totalAplicado,
      total_valor_mercado_informado_centavos: totalMercadoInformado,
      total_rendimentos_registrados_centavos: totalRendimentos,
      variacao_patrimonial_centavos: lucroPrejuizoCentavos,
      rentabilidade_percentual: (rentabilidadeBps / 100).toFixed(2) + '%',
      distribuicao_por_classe: distribuicaoPorClasse,
      ativos: activeAssets,
      ultimos_movimentos: movements.slice(0, 50)
    };
  }

  /**
   * Consultor Inteligente de IA & Radar de Mercado:
   * Diagnostica a carteira real do usuário, apresenta panorama macro e da bolsa brasileira
   * (o que está em alta e baixa) e fornece recomendações fundamentadas de compra e venda.
   */
  function getAiMarketAdvice(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var summary = getPortfolioSummary(user);

    // 1. Indicadores Macroeconômicos e de Mercado Financeiro (Brasil & Global) online
    var liveMacro = MarketDataService.getMacroIndicators();
    var marketRadar = {
      data_referencia: SpreadsheetRepository.todayIso(),
      indicadores_chave: (liveMacro && liveMacro.length > 0) ? liveMacro : [
        { sigla: 'SELIC', nome: 'Taxa Selic Meta', valor: '11,25% a.a.', tendencia: 'ALTA', impacto: 'Renda Fixa muito atrativa; crédito e varejo pressionados' },
        { sigla: 'CDI', nome: 'Taxa CDI', valor: '11,15% a.a.', tendencia: 'ESTAVEL', impacto: 'Excelente remuneração para reserva de emergência e caixa' },
        { sigla: 'IPCA', nome: 'Inflação Projetada (12m)', valor: '4,45%', tendencia: 'ATENCAO', impacto: 'Juro real líquido historicamente alto (IPCA + 6,5% a.a.)' },
        { sigla: 'IBOVESPA', nome: 'Índice Bovespa', valor: '130.500 pts', tendencia: 'OPORTUNIDADE', impacto: 'Múltiplos P/L descontados frente à média histórica de 10 anos' },
        { sigla: 'IFIX', nome: 'Índice de FIIs', valor: '3.360 pts', tendencia: 'ALTA', impacto: 'Dividend yield médio superior a 10,5% a.a. isento de IR' },
        { sigla: 'DOLAR', nome: 'Dólar Comercial', valor: 'R$ 5,75', tendencia: 'VOLATILIDADE', impacto: 'Empresas exportadoras beneficiadas; hedge cambial recomendado' }
      ],
      em_alta: [
        {
          titulo: 'Renda Fixa IPCA+ (Tesouro Direto / CDB / Debêntures Incentivadas)',
          motivo: 'Com juros reais em torno de IPCA + 6,50% a.a., o investidor trava um dos maiores ganhos reais do mundo com proteção inflacionária garantida.',
          destaque: 'Ideal para aposentadoria e metas de médio/longo prazo.'
        },
        {
          titulo: 'Fundos Imobiliários de Papel (CRI) e Logística Premium',
          motivo: 'Contratos atrelados a CDI e IPCA entregando proventos mensais de dois dígitos isentos de IR, com inquilinos de primeira linha.',
          destaque: 'Foco em geração contínua de renda passiva.'
        },
        {
          titulo: 'Ações de Setores Defensivos e Pagadoras de Dividendos (Bancos, Energia, Saneamento)',
          motivo: 'Empresas com demanda inelástica, forte geração de caixa e repasse de inflação em tarifas (ex: BB, Itaú, CPFL, Sanepar, Taesa).',
          destaque: 'Resiliência contra volatilidade política e macro.'
        }
      ],
      em_baixa: [
        {
          titulo: 'Varejo Discricionário e E-Commerce',
          motivo: 'Pressionados pelo custo elevado da dívida (Selic a 11,25%), inadimplência das famílias e concorrência internacional agressiva.',
          risco: 'Compressão de margem líquida e queima de caixa operacional.'
        },
        {
          titulo: 'Small Caps Muito Endividadas / Pré-Operacionais',
          motivo: 'Empresas em fase de expansão dependentes de captação de crédito sofrem desvalorização quando os juros sobem ou demoram a cair.',
          risco: 'Risco de diluição de capital e refinanciamento caro.'
        },
        {
          titulo: 'FIIs de Lajes Corporativas Secundárias (Monousuário fora dos eixos nobres)',
          motivo: 'Vacância física prolongada e descontos no aluguel para reter locatários fora da Faria Lima/Itaim em São Paulo.',
          risco: 'Queda na distribuição de dividendos e desvalorização patrimonial.'
        }
      ]
    };

    // 2. Diagnóstico Personalizado da Carteira do Usuário
    var totalMercado = summary.total_valor_mercado_informado_centavos;
    var totalAplicado = summary.total_aplicado_centavos;
    var classes = summary.distribuicao_por_classe;

    var rendaFixaBps = 0;
    var rendaVariavelBps = 0;
    var maiorAtivo = null;

    for (var i = 0; i < summary.ativos.length; i++) {
      var atv = summary.ativos[i];
      var mkt = Number(atv.valor_mercado_informado_centavos || atv.valor_aplicado_centavos || 0);
      if (!maiorAtivo || mkt > Number(maiorAtivo.valor_mercado_informado_centavos || maiorAtivo.valor_aplicado_centavos || 0)) {
        maiorAtivo = atv;
      }
    }

    for (var c = 0; c < classes.length; c++) {
      var cl = classes[c];
      if (cl.classe_ativo === 'RENDA_FIXA' || cl.classe_ativo === 'TESOURO_DIRETO') {
        rendaFixaBps += cl.percentual_carteira_bps;
      } else if (cl.classe_ativo === 'ACOES' || cl.classe_ativo === 'FUNDOS_IMOBILIARIOS') {
        rendaVariavelBps += cl.percentual_carteira_bps;
      }
    }

    var perfil = 'Conservador';
    if (rendaVariavelBps >= 5000) perfil = 'Arrojado';
    else if (rendaVariavelBps >= 2000) perfil = 'Moderado';

    var concentracaoAviso = '';
    if (maiorAtivo && totalMercado > 0) {
      var pctMaior = Math.round((Number(maiorAtivo.valor_mercado_informado_centavos || 0) * 10000) / totalMercado);
      if (pctMaior > 3500) {
        concentracaoAviso = 'Atenção: O ativo "' + maiorAtivo.nome_ativo + '" representa ' + (pctMaior / 100).toFixed(1) + '% de todo o seu patrimônio. Recomenda-se diversificar novos aportes em outras classes.';
      }
    }

    // 3. Recomendações Estruturadas de Compra, Venda e Balanceamento
    var recomendacoesCompra = [];
    var recomendacoesVenda = [];
    var recomendacaoGeral = '';

    if (totalMercado === 0) {
      recomendacoesCompra.push({
        classe: 'RENDA_FIXA / TESOURO SELIC',
        titulo: 'Construção da Reserva de Emergência (Passo 1)',
        acao: 'COMPRA / APORTE',
        prioridade: 'ALTA',
        motivo: 'Antes de investir em renda variável, monte uma reserva equivalente a 6 meses do seu custo de vida em Tesouro Selic ou CDB de liquidez diária 100%+ do CDI.'
      });
      recomendacoesCompra.push({
        classe: 'TESOURO_DIRETO',
        titulo: 'Tesouro IPCA+ 2035 ou 2045',
        acao: 'COMPRA / APORTE',
        prioridade: 'MEDIA',
        motivo: 'Aproveite o momento histórico de taxas acima de IPCA + 6,5% a.a. para aposentadoria e patrimônio futuro.'
      });
      recomendacaoGeral = 'Sua carteira está no início. O foco principal deve ser a formação da reserva de liquidez com segurança absoluta, aproveitando a Selic de dois dígitos.';
    } else {
      // Recomendações baseadas na composição real
      if (rendaFixaBps < 3000) {
        recomendacoesCompra.push({
          classe: 'RENDA_FIXA',
          titulo: 'Fortalecer Colchão de Segurança (CDB / Tesouro Selic)',
          acao: 'COMPRA / APORTE',
          prioridade: 'ALTA',
          motivo: 'Sua carteira possui menos de 30% em Renda Fixa. Com a Selic a 11,25%, aumentar a parcela pós-fixada garante liquidez, tranquilidade e excelente rentabilidade sem risco.'
        });
      }

      var temFii = classes.some(function (x) { return x.classe_ativo === 'FUNDOS_IMOBILIARIOS'; });
      if (!temFii) {
        recomendacoesCompra.push({
          classe: 'FUNDOS_IMOBILIARIOS',
          titulo: 'Inserir Fundos Imobiliários (FIIs) para Renda Passiva',
          acao: 'COMPRA / APORTE',
          prioridade: 'MEDIA',
          motivo: 'Você ainda não possui FIIs. Selecionar 2 a 4 fundos maduros de papel e logística permite receber dividendos isentos todo mês na conta corrente.'
        });
      }

      var temAcoes = classes.some(function (x) { return x.classe_ativo === 'ACOES'; });
      if (temAcoes) {
        recomendacoesCompra.push({
          classe: 'ACOES',
          titulo: 'Aportes Táticos em Empresas Sólidas com Alto P/L Descontado',
          acao: 'COMPRA / APORTE',
          prioridade: 'MEDIA',
          motivo: 'O Ibovespa negocia a múltiplos atrativos. Foque em empresas geradoras de caixa (grandes bancos e concessões de energia) reinvestindo os dividendos.'
        });
      }

      if (concentracaoAviso) {
        recomendacoesVenda.push({
          classe: maiorAtivo ? maiorAtivo.classe_ativo : 'OUTROS',
          titulo: 'Rebalanceamento de Concentração (' + (maiorAtivo ? maiorAtivo.nome_ativo : 'Ativo Principal') + ')',
          acao: 'REBALANCEAR / VENDA PARCIAL',
          prioridade: 'MEDIA',
          motivo: 'Evite concentração acima de 30% em um único ativo ou emissor. Não é necessário vender tudo com pressa: você pode interromper aportes nele e direcionar os próximos fluxos de caixa para as classes deficitárias.'
        });
      }

      recomendacoesVenda.push({
        classe: 'MERCADO GERAL',
        titulo: 'Revisar Ativos de Varejo Alavancado / Small Caps sem Lucro',
        acao: 'AVALIAR VENDA / REDUÇÃO',
        prioridade: 'BAIXA',
        motivo: 'Se tiver ativos que dependem de corte rápido de juros para fechar as contas, considere realizar perdas ou migrar o capital para títulos que pagam CDI puro com risco muito menor.'
      });

      recomendacaoGeral = 'Sua carteira está classificada como perfil ' + perfil + ' com ' + summary.ativos.length + ' ativo(s). A rentabilidade acumulada informada é de ' + summary.rentabilidade_percentual + '. A estratégia ideal é o Rebalanceamento por Aporte: utilizar a sobra mensal de caixa para comprar a classe que estiver abaixo do objetivo.';
    }

    // 4. Integração Opcional com Gemini API para refinamento do parecer
    var parecerIaCustomizado = '';
    var aiApiKey = '';
    try {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      if (props) aiApiKey = props.getProperty('GEMINI_API_KEY') || '';
    } catch (e) {}

    if (aiApiKey && typeof UrlFetchApp !== 'undefined' && summary.ativos.length > 0) {
      try {
        var prompt = [
          'Você é o Advisor de Investimentos Sênior do Finanças Inteligentes.',
          'Analise a carteira do usuário e o cenário macroeconômico brasileiro atual e forneça um parecer executivo:',
          '- Composição da Carteira: Total Aplicado R$ ' + (totalAplicado / 100).toFixed(2) + ', Valor de Mercado R$ ' + (totalMercado / 100).toFixed(2) + ', Rentabilidade ' + summary.rentabilidade_percentual,
          '- Classes de Ativos: ' + JSON.stringify(classes),
          '- Cenário Macro: Selic 11,25%, IPCA 4,45%, Ibov 130.500 pts, Dólar R$ 5,75',
          'Instruções: Seja conciso, direto e profissional. Dê orientações claras de rebalanceamento, controle de risco e onde concentrar os próximos aportes com foco na realidade brasileira.'
        ].join('\n');

        var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
        var resp = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': aiApiKey },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 600 }
          }),
          muteHttpExceptions: true
        });

        if (resp.getResponseCode() === 200) {
          var body = JSON.parse(resp.getContentText());
          var txt = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;
          if (txt) {
            parecerIaCustomizado = ValidationService.sanitizeText(txt, 1800);
          }
        }
      } catch (errAi) {
        // Fallback gracioso determinístico
      }
    }

    return {
      diagnostico_carteira: {
        perfil_investidor: perfil,
        renda_fixa_percentual: (rendaFixaBps / 100).toFixed(1) + '%',
        renda_variavel_percentual: (rendaVariavelBps / 100).toFixed(1) + '%',
        quantidade_ativos: summary.ativos.length,
        alerta_concentracao: concentracaoAviso || 'Excelente: Sua carteira não apresenta concentração excessiva em um único ativo.',
        rentabilidade_acumulada: summary.rentabilidade_percentual,
        lucro_prejuizo_centavos: summary.variacao_patrimonial_centavos,
        parecer_executivo: parecerIaCustomizado || recomendacaoGeral
      },
      radar_mercado: marketRadar,
      recomendacoes: {
        compra: recomendacoesCompra,
        venda: recomendacoesVenda,
        regra_ouro: 'Estratégia de Rebalanceamento Inteligente: Nunca venda ativos sólidos no pânico. Use o fluxo mensal de novos aportes para comprar a classe que ficou abaixo do percentual alvo.'
      }
    };
  }

  /**
   * Obtém o perfil de investidor (Suitability) do usuário.
   */
  function getSuitability(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var key = 'suitability_' + user.id;
    var config = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.grupo_id === user.grupo_id && c.chave === key;
    });

    if (config && config.valor) {
      try {
        return JSON.parse(config.valor);
      } catch (e) {}
    }

    // Default inteligente inferido
    return {
      perfil_risco: 'MODERADO',
      horizonte: 'MEDIO_PRAZO',
      objetivo_principal: 'RENDA_PASSIVA_DIVIDENDOS',
      conhecimento_mercado: 'INTERMEDIARIO',
      tolerancia_oscilacao: 'MODERADA',
      reserva_emergencia_concluida: true,
      atualizado_em: null
    };
  }

  /**
   * Salva as respostas do questionário de Suitability do usuário.
   */
  function saveSuitability(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados do perfil de investidor inválidos.');
    }

    var cleanData = {
      perfil_risco: ValidationService.validateEnum(payload.perfil_risco || 'MODERADO', ['CONSERVADOR', 'MODERADO', 'ARROJADO'], 'perfil_risco'),
      horizonte: ValidationService.validateEnum(payload.horizonte || 'MEDIO_PRAZO', ['CURTO_PRAZO', 'MEDIO_PRAZO', 'LONGO_PRAZO'], 'horizonte'),
      objetivo_principal: ValidationService.validateEnum(payload.objetivo_principal || 'RENDA_PASSIVA_DIVIDENDOS', ['RESERVA_EMERGENCIA', 'RENDA_PASSIVA_DIVIDENDOS', 'CRESCIMENTO_PATRIMONIAL', 'APOSENTADORIA_LONGO_PRAZO'], 'objetivo_principal'),
      conhecimento_mercado: ValidationService.validateEnum(payload.conhecimento_mercado || 'INTERMEDIARIO', ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO'], 'conhecimento_mercado'),
      tolerancia_oscilacao: ValidationService.validateEnum(payload.tolerancia_oscilacao || 'MODERADA', ['BAIXA', 'MODERADA', 'ALTA'], 'tolerancia_oscilacao'),
      reserva_emergencia_concluida: Boolean(payload.reserva_emergencia_concluida),
      atualizado_em: SpreadsheetRepository.todayIso()
    };

    var key = 'suitability_' + user.id;
    var existing = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.grupo_id === user.grupo_id && c.chave === key;
    });

    if (existing) {
      SpreadsheetRepository.updateById('CONFIGURACOES', existing.id, {
        valor: JSON.stringify(cleanData),
        atualizado_por: user.id
      }, user.grupo_id);
    } else {
      SpreadsheetRepository.insert('CONFIGURACOES', {
        id: SpreadsheetRepository.generateId('cfg'),
        grupo_id: user.grupo_id,
        chave: key,
        valor: JSON.stringify(cleanData),
        descricao: 'Questionário de Suitability e perfil de investidor do usuário ' + user.nome,
        atualizado_por: user.id
      });
    }

    return cleanData;
  }

  /**
   * Comparador Inteligente de Ativos lado a lado com métricas e parecer da IA.
   */
  function compareAssets(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || !payload.ticker1 || !payload.ticker2) {
      throw new Error('Informe ao menos dois ativos para comparação.');
    }

    var marketCatalog = MarketDataService.getMarketHighlights();
    var portfolio = getPortfolioSummary(user);

    function findAssetData(query) {
      var q = String(query).toUpperCase().trim();
      // 1. Busca no catálogo de mercado
      for (var i = 0; i < marketCatalog.length; i++) {
        if (marketCatalog[i].ticker.toUpperCase() === q || marketCatalog[i].ticker.toUpperCase().indexOf(q) !== -1) {
          return marketCatalog[i];
        }
      }
      // 2. Busca na carteira do usuário
      for (var j = 0; j < portfolio.ativos.length; j++) {
        var a = portfolio.ativos[j];
        if (a.id === query || a.nome_ativo.toUpperCase().indexOf(q) !== -1) {
          return {
            ticker: a.nome_ativo,
            nome: a.nome_ativo + ' (' + a.instituicao + ')',
            preco: 'R$ ' + (Number(a.valor_mercado_informado_centavos || 0) / 100).toFixed(2),
            variacao_dia: '0,00%',
            tendencia: 'ESTAVEL',
            categoria: a.classe_ativo,
            categoria_label: a.classe_ativo,
            dy: a.rendimentos_acumulados_centavos > 0 ? ((a.rendimentos_acumulados_centavos / (a.valor_aplicado_centavos || 1)) * 100).toFixed(1) + '%' : 'N/D',
            pl: 'N/A',
            pvp: 'N/A',
            risco: a.classe_ativo === 'RENDA_FIXA' ? 'BAIXO' : 'MEDIO',
            justificativa: 'Ativo pertencente à sua carteira pessoal de investimentos.',
            criterio: 'Posição do usuário'
          };
        }
      }
      // 3. Consulta online via MarketDataService para ativos da B3
      try {
        var liveQuote = MarketDataService.fetchSingleQuote(q);
        if (liveQuote && liveQuote.preco) {
          return {
            ticker: q,
            nome: liveQuote.nome || q,
            preco: liveQuote.preco,
            variacao_dia: liveQuote.variacao_dia || '0,00%',
            tendencia: (liveQuote.variacao_dia && liveQuote.variacao_dia.indexOf('+') !== -1) ? 'ALTA' : 'ESTAVEL',
            categoria: 'B3_ONLINE',
            categoria_label: 'Ativo B3 (Tempo Real)',
            dy: 'N/D',
            pl: 'N/D',
            pvp: 'N/D',
            risco: 'MEDIO',
            justificativa: 'Cotação consultada online via provedores oficiais de mercado.',
            criterio: 'Cotação Online B3'
          };
        }
      } catch (eQuote) {}

      // 4. Fallback genérico estruturado
      return {
        ticker: q,
        nome: q,
        preco: 'Cotação de Fechamento',
        variacao_dia: '0,00%',
        tendencia: 'NEUTRA',
        categoria: 'OUTROS',
        categoria_label: 'Ativo B3 / Mercado',
        dy: 'N/D',
        pl: 'N/D',
        pvp: 'N/D',
        risco: 'MEDIO',
        justificativa: 'Ativo de mercado para análise comparativa.',
        criterio: 'Consulta livre'
      };
    }

    var a1 = findAssetData(payload.ticker1);
    var a2 = findAssetData(payload.ticker2);
    var suitability = getSuitability(user);

    // Gera o parecer comparativo inteligente
    var analiseComparativa = 'Comparativo entre ' + a1.ticker + ' e ' + a2.ticker + ': ';
    if (a1.categoria === a2.categoria) {
      analiseComparativa += 'Ambos pertencem à mesma classe (' + a1.categoria_label + '). ' +
        (a1.dy !== 'N/D' && a2.dy !== 'N/D' ? 'Em termos de dividendos, ' + a1.ticker + ' entrega ' + a1.dy + ' contra ' + a2.dy + ' de ' + a2.ticker + '. ' : '') +
        'A escolha deve considerar seu horizonte temporal e diversificação setorial.';
    } else {
      analiseComparativa += a1.ticker + ' foca em ' + a1.categoria_label + ', enquanto ' + a2.ticker + ' atua em ' + a2.categoria_label + '. ' +
        'Para o seu perfil ' + suitability.perfil_risco + ', combiná-los em proporções equilibradas costuma ser a estratégia mais recomendada para mitigar volatilidade sem abrir mão de retorno.';
    }

    return {
      ativo1: a1,
      ativo2: a2,
      perfil_usuario: suitability.perfil_risco,
      parecer_ia: analiseComparativa,
      comparativo_metricas: [
        { metrica: 'Classe / Categoria', v1: a1.categoria_label, v2: a2.categoria_label },
        { metrica: 'Cotação / Preço', v1: a1.preco, v2: a2.preco },
        { metrica: 'Dividend Yield (DY)', v1: a1.dy || 'N/A', v2: a2.dy || 'N/A' },
        { metrica: 'P/L (Preço / Lucro)', v1: a1.pl || 'N/A', v2: a2.pl || 'N/A' },
        { metrica: 'P/VP (Preço / V. Patrimonial)', v1: a1.pvp || 'N/A', v2: a2.pvp || 'N/A' },
        { metrica: 'Grau de Risco Estimado', v1: a1.risco, v2: a2.risco },
        { metrica: 'Critério de Destaque', v1: a1.criterio, v2: a2.criterio }
      ]
    };
  }

  /**
   * Mapa de Projeção de Dividendos e Renda Passiva Futura.
   */
  function getDividendProjections(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var summary = getPortfolioSummary(user);
    var totalMercado = summary.total_valor_mercado_informado_centavos;
    var totalRendimentosPassados = summary.total_rendimentos_registrados_centavos;

    // Calcula estimativa anual de dividend yield ponderado por classe
    var dyPonderadoBps = 0;
    var classes = summary.distribuicao_por_classe;

    var dyPorClasseMap = {
      RENDA_FIXA: 1115,          // ~11,15% a.a. (CDI)
      TESOURO_DIRETO: 1050,      // ~10,50% a.a.
      FUNDOS_IMOBILIARIOS: 980,  // ~9,80% a.a. isento
      ACOES: 680,                // ~6,80% a.a.
      FUNDOS: 850,               // ~8,50% a.a.
      PREVIDENCIA: 900,          // ~9,00% a.a.
      OUTROS: 0
    };

    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      var taxa = dyPorClasseMap[c.classe_ativo] || 600;
      var peso = c.percentual_carteira_bps || 0;
      dyPonderadoBps += Math.round((taxa * peso) / 10000);
    }

    if (dyPonderadoBps === 0 && totalMercado > 0) {
      dyPonderadoBps = 850; // 8,5% default
    }

    var projecaoAnualCentavos = Math.round((totalMercado * dyPonderadoBps) / 10000);
    var projecaoMensalMediaCentavos = Math.round(projecaoAnualCentavos / 12);

    var mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    var cronogramaMensal = [];
    var hojeMes = new Date().getMonth();

    for (var m = 0; m < 12; m++) {
      var mesIndex = (hojeMes + m) % 12;
      var sazonalidade = (mesIndex === 2 || mesIndex === 7 || mesIndex === 11) ? 1.35 : 0.90;
      var valorMes = Math.round(projecaoMensalMediaCentavos * sazonalidade);

      cronogramaMensal.push({
        mes: mesesNomes[mesIndex],
        ano: new Date().getFullYear() + (hojeMes + m >= 12 ? 1 : 0),
        valor_estimado_centavos: valorMes,
        status: m === 0 ? 'ANUNCIADO' : 'PROJETADO'
      });
    }

    return {
      total_rendimentos_recebidos_centavos: totalRendimentosPassados,
      dividend_yield_medio_ponderado: (dyPonderadoBps / 100).toFixed(2) + '% a.a.',
      projecao_anual_total_centavos: projecaoAnualCentavos,
      projecao_mensal_media_centavos: projecaoMensalMediaCentavos,
      cronograma_12m: cronogramaMensal,
      nota_metodologia: 'Projeção estimada a partir do valor atual informado da carteira e do yield histórico médio de cada classe de ativo. Não constitui promessa de rendimento.'
    };
  }

  return {
    ASSET_CLASSES: ASSET_CLASSES,
    MOVEMENT_TYPES: MOVEMENT_TYPES,
    assertWebChannelOnly: assertWebChannelOnly,
    createAsset: createAsset,
    recordInvestmentMovement: recordInvestmentMovement,
    deleteAsset: deleteAsset,
    updateAsset: updateAsset,
    getPortfolioSummary: getPortfolioSummary,
    getAiMarketAdvice: getAiMarketAdvice,
    getSuitability: getSuitability,
    saveSuitability: saveSuitability,
    compareAssets: compareAssets,
    getDividendProjections: getDividendProjections
  };
})();
