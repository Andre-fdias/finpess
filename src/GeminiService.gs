/**
 * @file GeminiService.gs
 * @description Camada desacoplada de Inteligência Artificial (Oráculo IA, transcrição de
 * áudio e apoio à extração estruturada). Executa todos os cálculos financeiros no backend,
 * separa fatos calculados de recomendações e opera com fallback determinístico caso a
 * API externa esteja indisponível ou sem quota.
 */

var GeminiService = (function () {
  var FALLBACK_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest'
  ];

  function getCandidateModels() {
    var list = [];
    try {
      var props = PropertiesService.getScriptProperties();
      var active = props.getProperty('GEMINI_ACTIVE_MODEL');
      if (active && String(active).trim()) list.push(String(active).trim());
      var custom = props.getProperty('GEMINI_MODEL');
      if (custom && String(custom).trim() && list.indexOf(String(custom).trim()) === -1) {
        list.push(String(custom).trim());
      }
    } catch (e) {}
    for (var i = 0; i < FALLBACK_MODELS.length; i++) {
      if (list.indexOf(FALLBACK_MODELS[i]) === -1) {
        list.push(FALLBACK_MODELS[i]);
      }
    }
    return list;
  }

  function getActiveModel() {
    var candidates = getCandidateModels();
    return candidates[0] || 'gemini-flash-lite-latest';
  }

  function getApiKey() {
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    return props ? (props.getProperty('GEMINI_API_KEY') || '') : '';
  }

  /**
   * Calcula determinísticamente no backend todos os fatos financeiros do usuário
   * para responder consultas do Oráculo IA sem depender de cálculos livres do modelo.
   */
  function computeOracleDeterministicFacts(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var today = SpreadsheetRepository.todayIso();
    var targetMonth = (mesReferencia && /^\d{4}-\d{2}$/.test(mesReferencia))
      ? mesReferencia
      : today.substring(0, 7);

    var parts = targetMonth.split('-');
    var prevDate = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 2, 1));
    var prevMonth = prevDate.getUTCFullYear() + '-' + String(prevDate.getUTCMonth() + 1).padStart(2, '0');

    var dashCurrent = FinanceService.getDashboardData(user, targetMonth);
    var dashPrev = FinanceService.getDashboardData(user, prevMonth);

    var prevCatMap = {};
    for (var p = 0; p < dashPrev.evolucao_gastos_por_categoria.length; p++) {
      var pc = dashPrev.evolucao_gastos_por_categoria[p];
      prevCatMap[pc.categoria_id] = pc;
    }

    var categoriasComCrescimento = [];
    var comparativoOrcamento = [];

    for (var i = 0; i < dashCurrent.evolucao_gastos_por_categoria.length; i++) {
      var cur = dashCurrent.evolucao_gastos_por_categoria[i];
      var prv = prevCatMap[cur.categoria_id];
      var prevTotal = prv ? prv.total_comprometido_centavos : 0;
      var diff = cur.total_comprometido_centavos - prevTotal;
      var variacaoBps = prevTotal > 0 ? Math.round((diff * 10000) / prevTotal) : (cur.total_comprometido_centavos > 0 ? 10000 : 0);

      if (diff > 0) {
        categoriasComCrescimento.push({
          categoria_nome: cur.categoria_nome,
          mes_anterior_centavos: prevTotal,
          mes_atual_centavos: cur.total_comprometido_centavos,
          aumento_centavos: diff,
          variacao_percentual: (variacaoBps / 100).toFixed(1) + '%'
        });
      }

      if (cur.orcamento_centavos > 0) {
        comparativoOrcamento.push({
          categoria_nome: cur.categoria_nome,
          orcamento_centavos: cur.orcamento_centavos,
          realizado_confirmado_centavos: cur.confirmado_centavos,
          total_comprometido_centavos: cur.total_comprometido_centavos,
          diferenca_orcamento_centavos: cur.orcamento_centavos - cur.total_comprometido_centavos,
          estourou_orcamento: cur.total_comprometido_centavos > cur.orcamento_centavos
        });
      }
    }

    // Identifica contas futuras que podem comprometer o saldo bancário confirmado
    var saldoDisponivel = dashCurrent.confirmados.saldo_bancario_consolidado_centavos;
    var acumuladoSaidasPendentes = 0;
    var contasComprometedoras = [];
    var todasPendentes = dashCurrent.pendentes.contas_vencidas.concat(dashCurrent.pendentes.contas_a_vencer);

    for (var k = 0; k < todasPendentes.length; k++) {
      var item = todasPendentes[k];
      acumuladoSaidasPendentes += item.valor_centavos;
      if (acumuladoSaidasPendentes > saldoDisponivel) {
        contasComprometedoras.push({
          id: item.id,
          descricao: item.descricao,
          data_vencimento: item.data_lancamento,
          valor_centavos: item.valor_centavos,
          deficit_projetado_centavos: acumuladoSaidasPendentes - saldoDisponivel
        });
      }
    }

    // Extração enriquecida de RAG sobre contas, cartões, faturas e lançamentos
    var rawBanks = [];
    try {
      if (typeof BankAccountService !== 'undefined' && BankAccountService.listBankAccounts) {
        rawBanks = BankAccountService.listBankAccounts(user, true);
      }
    } catch (eB) {}
    var contasBancariasRAG = (rawBanks || []).map(function (b) {
      return {
        nome: b.nome_identificacao || '',
        instituicao: b.instituicao || '',
        tipo: b.tipo_conta || '',
        titular: b.proprietario_nome || 'Titular principal',
        saldo_confirmado: ValidationService.formatCentavosToBrl(b.saldo_confirmado_centavos || 0),
        saldo_projetado: ValidationService.formatCentavosToBrl(b.saldo_projetado_centavos || 0),
        situacao: b.situacao || 'ATIVA'
      };
    });

    var rawCards = [];
    try {
      if (typeof CreditCardService !== 'undefined' && CreditCardService.listCards) {
        rawCards = CreditCardService.listCards(user);
      }
    } catch (eC) {}
    var cartoesRAG = (rawCards || []).map(function (c) {
      var limTotal = Number(c.limite_total_centavos || 0) + Number(c.limite_adicional_centavos || 0);
      var limComp = Number(c.limite_comprometido_centavos || 0);
      var limDisp = limTotal - limComp;
      return {
        nome: c.nome || '',
        banco: c.banco || '',
        bandeira: c.bandeira || '',
        limite_total: ValidationService.formatCentavosToBrl(limTotal),
        limite_disponivel: ValidationService.formatCentavosToBrl(limDisp),
        dia_fechamento: c.dia_fechamento || '',
        dia_vencimento: c.dia_vencimento || '',
        melhor_dia_compra: c.melhor_dia_compra || ''
      };
    });

    var rawLaunches = [];
    try {
      if (typeof FinanceService !== 'undefined' && FinanceService.listLaunches) {
        var lRes = FinanceService.listLaunches(user, { pageSize: 35, mesCompetencia: targetMonth });
        rawLaunches = (lRes && lRes.items) ? lRes.items : [];
      }
    } catch (eL) {}
    var ultimosLancamentosRAG = (rawLaunches || []).map(function (l) {
      return {
        data: l.data_lancamento,
        descricao: l.descricao,
        tipo: l.tipo,
        valor: ValidationService.formatCentavosToBrl(l.valor_centavos || 0),
        categoria: l.categoria_nome || 'Sem categoria',
        situacao: l.situacao
      };
    });

    var rawRec = [];
    try {
      rawRec = SpreadsheetRepository.findByGrupo('CONTAS_RECORRENTES', user.grupo_id, function (r) {
        return r.situacao === 'ATIVA';
      });
    } catch (eR) {}
    var recorrentesRAG = (rawRec || []).map(function (r) {
      return {
        descricao: r.descricao,
        valor: ValidationService.formatCentavosToBrl(r.valor_centavos || 0),
        dia_vencimento: r.dia_vencimento,
        tipo: r.tipo
      };
    });

    var pendentesDetalhadasRAG = todasPendentes.slice(0, 20).map(function (p) {
      return {
        descricao: p.descricao,
        data_vencimento: p.data_lancamento,
        valor: ValidationService.formatCentavosToBrl(p.valor_centavos || 0),
        situacao: p.situacao
      };
    });

    var gastosCatFormatados = (dashCurrent.evolucao_gastos_por_categoria || []).map(function (c) {
      return {
        categoria: c.categoria_nome,
        confirmado: ValidationService.formatCentavosToBrl(c.confirmado_centavos || 0),
        comprometido_total: ValidationService.formatCentavosToBrl(c.total_comprometido_centavos || 0),
        orcamento: c.orcamento_centavos > 0 ? ValidationService.formatCentavosToBrl(c.orcamento_centavos) : 'Sem teto definido'
      };
    });

    var resumoFormatado = {
      saldo_bancario_confirmado: ValidationService.formatCentavosToBrl(saldoDisponivel),
      receitas_confirmadas: ValidationService.formatCentavosToBrl(dashCurrent.confirmados.receitas_realizadas_mes_centavos),
      despesas_confirmadas: ValidationService.formatCentavosToBrl(dashCurrent.confirmados.despesas_pagas_mes_centavos),
      despesas_previstas_e_pendentes: ValidationService.formatCentavosToBrl(
        dashCurrent.previstos.despesas_previstas_mes_centavos + dashCurrent.pendentes.despesas_pendentes_mes_centavos
      ),
      resultado_realizado: ValidationService.formatCentavosToBrl(dashCurrent.confirmados.resultado_mensal_realizado_centavos),
      saldo_projetado_fim_mes: ValidationService.formatCentavosToBrl(dashCurrent.estimados.saldo_final_mes_projetado_centavos)
    };

    return {
      periodo_analisado: targetMonth,
      mes_comparacao: prevMonth,
      premissas: [
        'Cálculos executados determinísticamente pelo backend em centavos.',
        'Transferências entre contas próprias são excluídas dos totais de receitas e despesas.',
        'Previsões não são somadas ao saldo bancário confirmado.'
      ],
      resumo_mensal: {
        saldo_bancario_confirmado_centavos: saldoDisponivel,
        receitas_confirmadas_centavos: dashCurrent.confirmados.receitas_realizadas_mes_centavos,
        despesas_confirmadas_centavos: dashCurrent.confirmados.despesas_pagas_mes_centavos,
        despesas_previstas_e_pendentes_centavos:
          dashCurrent.previstos.despesas_previstas_mes_centavos + dashCurrent.pendentes.despesas_pendentes_mes_centavos,
        resultado_realizado_centavos: dashCurrent.confirmados.resultado_mensal_realizado_centavos,
        saldo_projetado_fim_mes_centavos: dashCurrent.estimados.saldo_final_mes_projetado_centavos
      },
      resumo_mensal_formatado: resumoFormatado,
      contas_bancarias: contasBancariasRAG,
      cartoes_credito: cartoesRAG,
      ultimos_lancamentos: ultimosLancamentosRAG,
      contas_recorrentes: recorrentesRAG,
      contas_pendentes_detalhadas: pendentesDetalhadasRAG,
      gastos_por_categoria_formatado: gastosCatFormatados,
      comparativo_mes_anterior: {
        despesas_confirmadas_mes_anterior_centavos: dashPrev.confirmados.despesas_pagas_mes_centavos,
        despesas_confirmadas_mes_atual_centavos: dashCurrent.confirmados.despesas_pagas_mes_centavos,
        diferenca_despesas_centavos:
          dashCurrent.confirmados.despesas_pagas_mes_centavos - dashPrev.confirmados.despesas_pagas_mes_centavos
      },
      gastos_por_categoria: dashCurrent.evolucao_gastos_por_categoria,
      categorias_com_crescimento: categoriasComCrescimento,
      orcado_vs_realizado: comparativoOrcamento,
      contas_que_comprometem_saldo: contasComprometedoras,
      contas_a_vencer_mes: dashCurrent.pendentes.contas_a_vencer,
      contas_vencidas: dashCurrent.pendentes.contas_vencidas
    };
  }

  /**
   * Constrói resposta analítica determinística baseada nos fatos calculados,
   * garantindo funcionamento mesmo sem chave de API externa ou durante falha do provedor.
   */
  function buildDeterministicInsight(question, facts) {
    var q = String(question || '').toLowerCase();
    var lines = [];
    var r = facts.resumo_mensal_formatado || {};
    var sConf = r.saldo_bancario_confirmado || ValidationService.formatCentavosToBrl(facts.resumo_mensal.saldo_bancario_confirmado_centavos);
    var rConf = r.receitas_confirmadas || ValidationService.formatCentavosToBrl(facts.resumo_mensal.receitas_confirmadas_centavos);
    var dConf = r.despesas_confirmadas || ValidationService.formatCentavosToBrl(facts.resumo_mensal.despesas_confirmadas_centavos);
    var dPrev = r.despesas_previstas_e_pendentes || ValidationService.formatCentavosToBrl(facts.resumo_mensal.despesas_previstas_e_pendentes_centavos);
    var sProj = r.saldo_projetado_fim_mes || ValidationService.formatCentavosToBrl(facts.resumo_mensal.saldo_projetado_fim_mes_centavos);

    lines.push('Olá! Bom dia. Apresento a análise detalhada dos dados financeiros para o ciclo **' + facts.periodo_analisado + '**:');
    lines.push('');
    lines.push('### 1. Diagnóstico do Caixa');
    lines.push('- **Saldo Bancário Confirmado:** ' + sConf);
    lines.push('- **Receitas Realizadas:** ' + rConf);
    lines.push('- **Despesas Pagas:** ' + dConf);
    lines.push('- **Despesas Previstas e Pendentes:** ' + dPrev);
    lines.push('- **Saldo Projetado para o Fechamento:** **' + sProj + '**');
    lines.push('');

    if (q.indexOf('banco') !== -1 || q.indexOf('conta') !== -1 || q.indexOf('titular') !== -1) {
      lines.push('### 2. Contas Bancárias & Titulares');
      if (facts.contas_bancarias && facts.contas_bancarias.length > 0) {
        facts.contas_bancarias.forEach(function (b) {
          lines.push('- **' + b.instituicao + ' (' + b.nome + '):** ' + b.saldo_confirmado + ' | Titular: **' + b.titular + '**');
        });
      } else {
        lines.push('- Nenhuma conta bancária ativa cadastrada.');
      }
      lines.push('');
    }

    if (q.indexOf('cartao') !== -1 || q.indexOf('fatura') !== -1 || q.indexOf('limite') !== -1) {
      lines.push('### 2. Cartões de Crédito & Faturas');
      if (facts.cartoes_credito && facts.cartoes_credito.length > 0) {
        facts.cartoes_credito.forEach(function (c) {
          lines.push('- **' + c.nome + ' (' + c.banco + '):** Limite disponível: ' + c.limite_disponivel + ' de ' + c.limite_total + ' (Melhor dia de compra: dia ' + c.melhor_dia_compra + ')');
        });
      } else {
        lines.push('- Nenhum cartão de crédito cadastrado.');
      }
      lines.push('');
    }

    if (q.indexOf('alimenta') !== -1 || q.indexOf('categoria') !== -1 || q.indexOf('pesaram') !== -1 || q.indexOf('gasto') !== -1) {
      lines.push('### 2. Gastos por Categoria no Período');
      if (facts.gastos_por_categoria && facts.gastos_por_categoria.length > 0) {
        facts.gastos_por_categoria.slice(0, 5).forEach(function (c) {
          lines.push('- **' + c.categoria_nome + ':** ' + ValidationService.formatCentavosToBrl(c.confirmado_centavos) + ' pago (' + ValidationService.formatCentavosToBrl(c.total_comprometido_centavos) + ' total comprometido)');
        });
      } else {
        lines.push('- Nenhuma despesa categorizada registrada até o momento no período.');
      }
      lines.push('');
    }

    if (facts.contas_que_comprometem_saldo && facts.contas_que_comprometem_saldo.length > 0) {
      lines.push('### ⚠️ Alerta de Liquidez');
      lines.push('Existem **' + facts.contas_que_comprometem_saldo.length + ' conta(s)** pendente(s) que superam seu saldo bancário atual caso não entrem novas receitas até a data de vencimento.');
      lines.push('');
    }

    lines.push('### 3. Recomendações Práticas');
    if (facts.resumo_mensal && facts.resumo_mensal.saldo_projetado_fim_mes_centavos < 0) {
      lines.push('1. **Atenção ao Saldo Projetado Negativo:** As obrigações previstas (' + dPrev + ') superam o saldo disponível (' + sConf + ').');
      lines.push('2. **Priorização de Pagamentos:** Concentre os recursos no pagamento de despesas essenciais (moradia, energia, alimentação).');
      lines.push('3. **Novas Entradas:** Busque acelerar recebimentos ou antecipar receitas para evitar encargos bancários.');
    } else {
      lines.push('1. **Fluxo sob Controle:** Seu saldo projetado está equilibrado. Mantenha os lançamentos atualizados.');
      lines.push('2. **Reserva e Aportes:** Havendo saldo excedente, priorize a consolidação da sua reserva de emergência.');
    }

    return lines.join('\n');
  }

  /**
   * Consulta o Oráculo IA respeitando isolamento de grupo, separando fatos calculados
   * de recomendações e tratando falhas do provedor externo sem interromper o sistema.
   */
  function askOracle(user, question, mesReferencia, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var cleanQuestion = ValidationService.sanitizeText(question || 'Resumo da situação mensal', 500);
    var facts = computeOracleDeterministicFacts(user, mesReferencia);
    var opts = options || {};

    var aiRecommendation = '';
    var providerUsed = 'DETERMINISTIC_ENGINE_FALLBACK';
    var apiError = '';

    var apiKey = opts.apiKey !== undefined ? opts.apiKey : getApiKey();
    var simulateFailure = Boolean(opts.simulateAiFailure);
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var provider = (props && props.getProperty('AI_PROVIDER')) || 'GOOGLE_GEMINI';
    var detailLevel = (props && props.getProperty('AI_ORACLE_DETAIL_LEVEL')) || 'EQUILIBRADO';
    var focus = (props && props.getProperty('AI_ORACLE_FOCUS')) || 'EQUILIBRADO';

    if (simulateFailure || provider === 'DETERMINISTICO_LOCAL') {
      if (provider === 'DETERMINISTICO_LOCAL') {
        apiError = 'LOCAL_ENGINE: Motor Determinístico Local ativo por preferência administrativa.';
      } else {
        apiError = 'SIMULATED_AI_UNAVAILABLE: Indisponibilidade simulada do provedor de IA.';
      }
      aiRecommendation = buildDeterministicInsight(cleanQuestion, facts);
    } else if (apiKey && typeof UrlFetchApp !== 'undefined') {
      var candidateModels = getCandidateModels();
      for (var cm = 0; cm < candidateModels.length; cm++) {
        var currentModel = candidateModels[cm];
        try {
          var detailInstruction = 'Apresente um parecer executivo equilibrado com diagnóstico contábil e recomendações práticas.';
          var maxTokens = 900;
          if (detailLevel === 'CONCISO') {
            detailInstruction = 'Seja extremamente conciso e direto. Destaque apenas os números-chave e no máximo 2 ações prioritárias em poucos parágrafos curtos.';
            maxTokens = 450;
          } else if (detailLevel === 'DETALHADO') {
            detailInstruction = 'Apresente um parecer financeiro aprofundado e minucioso, analisando detalhadamente receitas, despesas, gargalos e projeções passo a passo.';
            maxTokens = 1500;
          }

          var focusInstruction = '';
          if (focus === 'REDUCAO_DESPESAS') {
            focusInstruction = 'Dê prioridade máxima na análise para redução de despesas, eliminação de vazamentos e corte de supérfluos.';
          } else if (focus === 'ACUMULACAO_PATRIMONIO') {
            focusInstruction = 'Dê prioridade máxima na análise para aumento da poupança, capacidade de aportes, geração de renda passiva e patrimônio.';
          }

          var ragContext = {
            periodo_referencia: facts.periodo_analisado,
            mes_comparacao: facts.mes_comparacao,
            resumo_caixa: facts.resumo_mensal_formatado,
            contas_bancarias_e_titulares: facts.contas_bancarias,
            cartoes_credito_e_faturas: facts.cartoes_credito,
            gastos_por_categoria: facts.gastos_por_categoria_formatado,
            contas_a_vencer_e_vencidas: facts.contas_pendentes_detalhadas,
            contas_recorrentes_fixas: facts.contas_recorrentes,
            ultimos_lancamentos_do_mes: facts.ultimos_lancamentos
          };

          var prompt = [
            'Você é o Oráculo IA do sistema Finanças Inteligentes, atuando como um analista financeiro executivo e RAG inteligente sobre as finanças do usuário.',
            '',
            'DIRETRIZES DE COMUNICAÇÃO OBRIGATÓRIAS:',
            '1. SAUDAÇÃO PROFISSIONAL: Inicie a resposta de forma educada e polida com "Olá" ou "Bom dia" e comece imediatamente a responder a dúvida.',
            '2. PROIBIÇÃO ABSOLUTA DE GÍRIAS: NUNCA use "Salve", "E aí", "Fala aí", "Beleza" ou qualquer linguagem de rua. O tom deve ser corporativo, acolhedor e profissional.',
            '3. FORMATAÇÃO MARKDOWN RICA E INTELIGÍVEL:',
            '   - Estruture a resposta com títulos Markdown (### Diagnóstico, ### Detalhes, ### Recomendações).',
            '   - Use listas com marcadores (- ) para discriminar contas, categorias e valores.',
            '   - Destaque valores em Real e nomes de contas/titulares em negrito (ex: **R$ 1.250,00**, **Santander André**).',
            '   - Se houver dados comparativos de categorias ou contas, utilize tabelas Markdown (| Categoria | Valor |).',
            '   - Mantenha parágrafos objetivos, claros e organizados, sem blocos densos ou confusos.',
            '4. PRECISÃO CONTÁBIL RAG:',
            '   - Responda com base EXCLUSIVA nos dados financeiros fornecidos no JSON abaixo.',
            '   - Se o usuário perguntar sobre uma conta específica, cartão, categoria, titular ou vencimento, consulte os dados e forneça a resposta exata.',
            '   - Se uma despesa ou informação não estiver registrada no contexto, informe com clareza que o registro não consta nas finanças cadastradas.',
            '5. ESTILO: ' + detailInstruction,
            focusInstruction ? ('6. FOCO: ' + focusInstruction) : '',
            '',
            'PERGUNTA DO USUÁRIO: ' + cleanQuestion,
            '',
            'CONTEXTO FINANCEIRO DO USUÁRIO (RAG DO SISTEMA):',
            JSON.stringify(ragContext)
          ].filter(Boolean).join('\n');

          var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + currentModel + ':generateContent';
          var resp = UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            headers: { 'x-goog-api-key': apiKey },
            payload: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
            }),
            muteHttpExceptions: true
          });

          if (resp.getResponseCode() === 200) {
            var body = JSON.parse(resp.getContentText());
            var candidateText = body &&
              body.candidates &&
              body.candidates[0] &&
              body.candidates[0].content &&
              body.candidates[0].content.parts &&
              body.candidates[0].content.parts[0] &&
              body.candidates[0].content.parts[0].text;
            if (candidateText) {
              aiRecommendation = ValidationService.sanitizeText(candidateText, 4500);
              providerUsed = currentModel;
              try { PropertiesService.getScriptProperties().setProperty('GEMINI_ACTIVE_MODEL', currentModel); } catch (ep) {}
              break;
            }
          } else {
            apiError = 'HTTP_' + resp.getResponseCode() + ' (' + currentModel + ')';
          }
        } catch (err) {
          apiError = ValidationService.sanitizeText(err && err.message ? err.message : String(err), 200);
        }
      }
    }

    if (!aiRecommendation) {
      aiRecommendation = buildDeterministicInsight(cleanQuestion, facts);
    }

    var savedAnalysis = SpreadsheetRepository.insert('ANALISES_IA', {
      id: SpreadsheetRepository.generateId('aia'),
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      periodo_analisado: facts.periodo_analisado,
      pergunta_usuario: cleanQuestion,
      fatos_calculados_json: JSON.stringify(facts.resumo_mensal),
      recomendacao_ia: aiRecommendation,
      provedor_modelo: providerUsed
    });

    return {
      analise_id: savedAnalysis.id,
      periodo_analisado: facts.periodo_analisado,
      premissas: facts.premissas,
      fatos_calculados: facts,
      recomendacao_ia: aiRecommendation,
      provedor_modelo: providerUsed,
      aviso_contingencia: apiError ? ('Provedor externo indisponível (' + apiError + '). Exibindo análise determinística calculada pelo servidor.') : ''
    };
  }

  /**
   * Transcreve áudio em português brasileiro via Gemini Multimodal ou adaptador injetado.
   * Nunca armazena o áudio após a transcrição.
   */
  function transcribeAudioBytes(audioBase64, mimeType, options) {
    var opts = options || {};
    if (opts.simulateTranscriptionFailure) {
      throw new Error('TRANSCRIPTION_FAILED: Falha no serviço de transcrição de áudio.');
    }
    if (typeof opts.mockTranscript === 'string') {
      return {
        transcricao: opts.mockTranscript,
        provedor: 'MOCK_STT_ADAPTER'
      };
    }

    var apiKey = opts.apiKey !== undefined ? opts.apiKey : getApiKey();
    if (!apiKey || typeof UrlFetchApp === 'undefined') {
      throw new Error('STT_UNAVAILABLE: Chave GEMINI_API_KEY não configurada para transcrição de áudio no servidor.');
    }

    var candidateModels = getCandidateModels();
    var lastError = '';
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var normMode = (props && props.getProperty('AI_STT_NORMALIZATION')) || 'RIGOROSO_PTBR';
    var normDirective = normMode === 'RIGOROSO_PTBR'
      ? 'Formate valores em reais sempre com R$ (ex: R$ 45,50). Escreva os nomes de estabelecimentos e métodos com grafia correta em português.'
      : 'Transcreva exatamente como pronunciado sem alterações de formato.';

    var prompt = [
      'Você é um assistente de transcrição de mensagens financeiras em português brasileiro.',
      'Transcreva com precisão o que o usuário disse sobre suas receitas, compras, despesas, pagamentos, valores, nomes de lojas, categorias, bancos ou métodos de pagamento.',
      normDirective,
      'Retorne APENAS o texto falado exatamente como pronunciado, sem pontuação excessiva, sem comentários e sem introduções.',
      'Preste atenção especial aos números em português para não confundir dezenas com centenas (ex: quarenta e cinco vs quatrocentos e cinquenta).',
      'Se não houver voz ou estiver inaudível, responda [INAUDIVEL].'
    ].join(' ');

    for (var m = 0; m < candidateModels.length; m++) {
      var currentModel = candidateModels[m];
      try {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + currentModel + ':generateContent';
        var resp = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': apiKey },
          payload: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mimeType || 'audio/ogg', data: audioBase64 } }
              ]
            }],
            generationConfig: { temperature: 0.0, maxOutputTokens: 300 }
          }),
          muteHttpExceptions: true
        });

        if (resp.getResponseCode() === 200) {
          var parsed = JSON.parse(resp.getContentText());
          var text = parsed &&
            parsed.candidates &&
            parsed.candidates[0] &&
            parsed.candidates[0].content &&
            parsed.candidates[0].content.parts &&
            parsed.candidates[0].content.parts[0] &&
            parsed.candidates[0].content.parts[0].text;

          if (text && text.indexOf('[INAUDIVEL]') === -1) {
            try { PropertiesService.getScriptProperties().setProperty('GEMINI_ACTIVE_MODEL', currentModel); } catch (ep) {}
            return {
              transcricao: text.trim(),
              provedor: currentModel
            };
          }
        } else {
          lastError = 'HTTP_' + resp.getResponseCode() + ' (' + currentModel + ')';
        }
      } catch (err) {
        lastError = (err && err.message) ? err.message : String(err);
      }
    }

    throw new Error('STT_FAILED: Não foi possível transcrever o áudio com os modelos disponíveis (' + lastError + ').');
  }

  /**
   * Analisa a foto de um cupom fiscal, nota fiscal ou comprovante de compra via Gemini Vision
   * e extrai informações estruturadas (estabelecimento, valor total, data, categoria e pagamento).
   */
  function extractReceiptFromImage(imageBase64, mimeType, options) {
    var opts = options || {};
    if (opts.simulateReceiptFailure) {
      throw new Error('RECEIPT_PARSER_FAILED: Falha na análise do cupom fiscal.');
    }
    if (opts.mockReceipt) {
      return opts.mockReceipt;
    }

    var apiKey = opts.apiKey !== undefined ? opts.apiKey : getApiKey();
    if (!apiKey || typeof UrlFetchApp === 'undefined') {
      throw new Error('GEMINI_UNAVAILABLE: Chave GEMINI_API_KEY não configurada no servidor.');
    }

    var candidateModels = getCandidateModels();
    var lastError = '';
    var prompt = [
      'Você é um especialista em OCR e extração estruturada de cupons fiscais, notas fiscais (NFC-e, SAT), recibos e comprovantes de pagamento do Brasil.',
      'Analise a imagem deste cupom ou comprovante e extraia as informações em formato JSON rigoroso.',
      'Instruções para os campos:',
      '- tipo: sempre "SAIDA" para compras e gastos.',
      '- descricao: nome da loja, supermercado ou estabelecimento (ex: "Carrefour", "Droga Raia", "Posto Shell"). Máximo 60 caracteres.',
      '- valor_centavos: valor total final da compra em centavos inteiros (ex: R$ 45,90 = 4590, R$ 10,00 = 1000).',
      '- data: data da compra no formato YYYY-MM-DD.',
      '- forma_pagamento: "PIX", "CREDITO", "DEBITO", "DINHEIRO" ou "BOLETO".',
      '- categoria_sugerida: "Alimentação", "Saúde", "Transporte", "Moradia", "Lazer" ou "Outros".',
      '- subcategoria_sugerida: nome específico da subcategoria (ex: "Supermercado", "Farmácia", "Combustível", "Restaurante / Almoço").',
      'Retorne EXCLUSIVAMENTE o objeto JSON válido, sem cercas Markdown (sem ```json), sem texto explicativo antes ou depois.'
    ].join('\n');

    for (var m = 0; m < candidateModels.length; m++) {
      var currentModel = candidateModels[m];
      try {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + currentModel + ':generateContent';
        var resp = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': apiKey },
          payload: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 600 }
          }),
          muteHttpExceptions: true
        });

        if (resp.getResponseCode() === 200) {
          var parsed = JSON.parse(resp.getContentText());
          var rawOut = parsed &&
            parsed.candidates &&
            parsed.candidates[0] &&
            parsed.candidates[0].content &&
            parsed.candidates[0].content.parts &&
            parsed.candidates[0].content.parts[0] &&
            parsed.candidates[0].content.parts[0].text;

          if (rawOut) {
            var cleanJson = String(rawOut).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
            var jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              var receiptObj = JSON.parse(jsonMatch[0]);
              return {
                tipo: 'SAIDA',
                descricao: ValidationService.sanitizeText(receiptObj.descricao || receiptObj.estabelecimento || 'Cupom Fiscal', 120),
                valor_centavos: Number(receiptObj.valor_centavos) || 0,
                data: ValidationService.validateIsoDate(receiptObj.data, 'data', true) || SpreadsheetRepository.todayIso(),
                forma_pagamento: ValidationService.validateEnum(receiptObj.forma_pagamento || 'PIX', ValidationService.PAYMENT_METHODS, 'forma_pagamento'),
                categoria_sugerida: receiptObj.categoria_sugerida || 'Alimentação',
                subcategoria_sugerida: receiptObj.subcategoria_sugerida || 'Supermercado',
                provedor: currentModel
              };
            }
          }
        } else {
          lastError = 'HTTP_' + resp.getResponseCode() + ' (' + currentModel + ')';
        }
      } catch (err) {
        lastError = (err && err.message) ? err.message : String(err);
      }
    }

    throw new Error('RECEIPT_PARSER_FAILED: Não foi possível extrair dados do cupom fiscal (' + lastError + ').');
  }

  return {
    DEFAULT_MODEL: 'gemini-flash-lite-latest',
    getActiveModel: getActiveModel,
    getCandidateModels: getCandidateModels,
    computeOracleDeterministicFacts: computeOracleDeterministicFacts,
    askOracle: askOracle,
    transcribeAudioBytes: transcribeAudioBytes,
    extractReceiptFromImage: extractReceiptFromImage
  };
})();

