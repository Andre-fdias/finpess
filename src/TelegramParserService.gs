/**
 * @file TelegramParserService.gs
 * @description Interpretador determinístico e assistido por IA para mensagens de texto
 * e transcrições de áudio em português brasileiro no Telegram.
 * Impõe bloqueio estrito de escopo: permite apenas propostas de ENTRADA e SAIDA,
 * recusando investimentos, dívidas, empréstimos, contas recorrentes, contas bancárias
 * e instruções administrativas/de segurança.
 */

var TelegramParserService = (function () {
  var FORBIDDEN_RULES = [
    {
      categoria_bloqueio: 'SEGURANCA_INJECAO',
      regex: /(ignore\s+as\s+regras|ignore\s+todas\s+as\s+instru|fa[cç]a\s+uma\s+transfer[eê]ncia\s+banc[aá]ria|aprovar?\s+usu[aá]rio|conceder\s+acesso|alterar\s+permiss|comando\s+administrativo|bypass)/i,
      mensagem_recusa: 'Operação bloqueada por segurança: o bot do Telegram não executa transferências bancárias externas, comandos administrativos nem alteração de regras de autorização.'
    },
    {
      categoria_bloqueio: 'INVESTIMENTOS',
      regex: /\b(investimento|investimentos|investi|investir|carteira\s+de\s+invest|cadastrar\s+ativo|comprar?\s+a[cç][oõ]es|comprei\s+a[cç][oõ]es|aporte\s+em|aportar|resgate\s+de\s+invest|resgatar\s+do\s+cdb|tesouro\s+direto|tesouro\s+selic|fundo\s+imobili[aá]rio|fii|renda\s+fixa)\b/i,
      mensagem_recusa: 'Escopo não permitido no Telegram: o cadastro de ativos, aportes, resgates e movimentações da carteira de investimentos deve ser realizado exclusivamente no módulo "Investimentos" do sistema web.'
    },
    {
      categoria_bloqueio: 'DIVIDAS',
      regex: /\b(cadastrar\s+d[ií]vida|nova\s+d[ií]vida|renegociar\s+d[ií]vida|negociar\s+d[ií]vida|d[ií]vida\s+protestada|d[ií]vida\s+antiga|acordo\s+de\s+d[ií]vida|excluir\s+d[ií]vida|editar\s+d[ií]vida)\b/i,
      mensagem_recusa: 'Escopo não permitido no Telegram: o cadastro, edição e negociação de dívidas são realizados exclusivamente no módulo "Dívidas" do sistema web.'
    },
    {
      categoria_bloqueio: 'EMPRESTIMOS',
      regex: /\b(cadastrar\s+empr[eé]stimo|novo\s+empr[eé]stimo|fiz\s+um\s+empr[eé]stimo|contratar\s+empr[eé]stimo|peguei\s+um\s+empr[eé]stimo|empr[eé]stimo\s+consignado|empr[eé]stimo\s+pessoal|editar\s+empr[eé]stimo|excluir\s+empr[eé]stimo)\b/i,
      mensagem_recusa: 'Escopo não permitido no Telegram: o cadastro e gerenciamento de empréstimos pessoais ou consignados devem ser feitos exclusivamente no módulo "Empréstimos" do sistema web.'
    },
    {
      categoria_bloqueio: 'CONTAS_RECORRENTES',
      regex: /\b(cadastrar\s+conta\s+recorrente|criar\s+recorr[eê]ncia|nova\s+conta\s+recorrente|alterar\s+conta\s+recorrente|editar\s+recorr[eê]ncia|todo\s+m[eê]s\s+no\s+dia|despesa\s+fixa\s+mensal)\b/i,
      mensagem_recusa: 'Escopo não permitido no Telegram: o bot não cria nem altera regras de contas mensais recorrentes. Utilize o módulo "Contas Recorrentes" no sistema web.'
    },
    {
      categoria_bloqueio: 'CONTAS_BANCARIAS',
      regex: /\b(cadastrar\s+conta\s+banc[aá]ria|criar\s+conta\s+banc[aá]ria|novo\s+banco|alterar\s+saldo\s+inicial|excluir\s+conta\s+banc[aá]ria)\b/i,
      mensagem_recusa: 'Escopo não permitido no Telegram: o cadastro e alteração estrutural de contas bancárias devem ser feitos no módulo "Contas Bancárias" do sistema web.'
    }
  ];

  var PT_NUMBER_WORDS = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
    quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
    vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
    cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
    quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
    seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
    oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900
  };

  /**
   * Verifica se o texto ou transcrição tenta realizar alguma operação proibida no Telegram.
   */
  function detectForbiddenScope(text) {
    var clean = String(text || '').trim();
    for (var i = 0; i < FORBIDDEN_RULES.length; i++) {
      var rule = FORBIDDEN_RULES[i];
      if (rule.regex.test(clean)) {
        return {
          bloqueado: true,
          categoria_bloqueio: rule.categoria_bloqueio,
          mensagem: rule.mensagem_recusa
        };
      }
    }
    return { bloqueado: false };
  }

  /**
   * Converte uma sequência de palavras numéricas em português (ex: "quatrocentos e cinquenta")
   * para um inteiro determinístico.
   */
  function parsePortugueseWordsChunk(phrase) {
    if (!phrase) return null;
    var tokens = phrase
      .toLowerCase()
      .replace(/[.,;!?]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t && t !== 'e'; });

    var total = 0;
    var currentGroup = 0;
    var matchedAny = false;

    for (var i = 0; i < tokens.length; i++) {
      var w = tokens[i];
      if (PT_NUMBER_WORDS[w] !== undefined) {
        currentGroup += PT_NUMBER_WORDS[w];
        matchedAny = true;
      } else if (w === 'mil') {
        matchedAny = true;
        if (currentGroup === 0) currentGroup = 1;
        total += currentGroup * 1000;
        currentGroup = 0;
      }
    }
    total += currentGroup;
    return matchedAny ? total : null;
  }

  /**
   * Extrai valor monetário em centavos a partir de dígitos ("R$ 89,90", "3.500", "45,50")
   * ou por extenso em português brasileiro ("quarenta e cinco reais e cinquenta centavos",
   * "quatrocentos e cinquenta reais", "trezentos reais").
   */
  function extractAmountInCentavos(text) {
    var str = String(text || '');

    // 1. Verifica padrão numérico explícito (ex: R$ 3.500, 89,90, 4.200 reais, 120)
    var digitRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?:\s*reais?)?/gi;
    var matches = [];
    var m;
    while ((m = digitRegex.exec(str)) !== null) {
      // Ignora números que fazem parte de uma data DD/MM/YYYY
      var beforeChar = m.index > 0 ? str.charAt(m.index - 1) : '';
      var afterChar = str.charAt(m.index + m[0].length);
      if (beforeChar === '/' || afterChar === '/' || beforeChar === '-' || afterChar === '-') {
        continue;
      }
      var intPart = m[1].replace(/\./g, '');
      var decPart = m[2] ? (m[2] + '00').substring(0, 2) : '00';
      var cents = parseInt(intPart, 10) * 100 + parseInt(decPart, 10);
      if (cents > 0) {
        matches.push(cents);
      }
    }

    if (matches.length === 1) {
      return { valor_centavos: matches[0], ambiguidade: false };
    }
    if (matches.length > 1) {
      return { valor_centavos: matches[0], ambiguidade: true };
    }

    // 2. Verifica números por extenso em português com "reais" e opcionalmente "centavos"
    var lower = str.toLowerCase();
    var reaisMatch = lower.match(/([a-záéíóúâêôãõç\s]+?)\s+reais?(?:\s+e\s+([a-záéíóúâêôãõç\s]+?)\s+centavos?)?/i);
    if (reaisMatch) {
      var reaisVal = parsePortugueseWordsChunk(reaisMatch[1]);
      var centavosVal = reaisMatch[2] ? parsePortugueseWordsChunk(reaisMatch[2]) : 0;
      if (reaisVal !== null && reaisVal >= 0) {
        var totalCents = reaisVal * 100 + (centavosVal || 0);
        if (totalCents > 0) {
          return { valor_centavos: totalCents, ambiguidade: false };
        }
      }
    }

    // 3. Caso o usuário fale apenas o número por extenso sem a palavra "reais"
    var fallbackWords = parsePortugueseWordsChunk(lower);
    if (fallbackWords !== null && fallbackWords > 0) {
      return { valor_centavos: fallbackWords * 100, ambiguidade: false };
    }

    return { valor_centavos: null, ambiguidade: false };
  }

  function detectLaunchType(text) {
    var lower = String(text || '').toLowerCase();
    var isEntrada = /\b(recebi|ganhei|entrou|recebimento|receber|sal[aá]rio|renda\s+extra|reembolso|reembolsar|estorno|estornado|comiss[aã]o|venda|vendi|dividendo|rendimento|servi[cç]o\s+extra|por\s+um\s+servi[cç]o|dep[oó]sito\s+recebido|pix\s+recebido)\b/i.test(lower);
    var isSaida = /\b(gastei|paguei|pagamento|pagar|pago|comprei|compra|compras|custou|despesa|sa[ií]da|d[eé]bito|gasto|conta\s+de|mercado|supermercado|hipermercado|padaria|a[cç]ougue|feira|hortifruti|sacol[aã]o|almo[cç]o|restaurante|jantar|lanche|lanchonete|caf[eé]|pizza|pizzaria|hamb[uú]rguer|burguer|bar|churrasco|farm[aá]cia|drogaria|rem[eé]dio|medicamento|consulta|exame|m[eé]dico|dentista|hospital|cl[ií]nica|combust[ií]vel|gasolina|etanol|diesel|posto|abastecer|abasteci|uber|99|t[aá]xi|[oô]nibus|metr[oô]|passagem|ped[aá]gio|estacionamento|aluguel|condom[ií]nio|luz|energia|for[cç]a|[aá]gua|saneamento|g[aá]s|internet|telefone|celular|recarga|tv|streaming|netflix|spotify|amazon|prime|academia|escola|faculdade|curso|manuten[cç][aã]o|oficina|mec[aâ]nico|roupa|vestu[aá]rio|cal[cç]ado|pet\s*shop|veterin[aá]rio|ra[cç][aã]o)\b/i.test(lower);

    if (isEntrada && !isSaida) return 'ENTRADA';
    if (isSaida && !isEntrada) return 'SAIDA';
    if (isEntrada && isSaida) {
      // Desempate pela primeira palavra de ação
      var idxRec = lower.search(/\b(recebi|ganhei|entrou|recebimento|sal[aá]rio|renda\s+extra)\b/);
      var idxGas = lower.search(/\b(gastei|paguei|comprei|compra|pago|despesa)\b/);
      if (idxRec !== -1 && (idxGas === -1 || idxRec < idxGas)) return 'ENTRADA';
      return 'SAIDA';
    }
    return null;
  }

  function detectPaymentMethod(text, tipo) {
    var lower = String(text || '').toLowerCase();
    if (/\bpix\b/.test(lower)) return 'PIX';
    if (/\b(d[eé]bito|no\s+d[eé]bito)\b/.test(lower)) return 'DEBITO';
    if (/\b(cr[eé]dito|no\s+cart[aã]o|cart[aã]o)\b/.test(lower)) return 'CREDITO';
    if (/\b(dinheiro|em\s+esp[eé]cie)\b/.test(lower)) return 'DINHEIRO';
    if (/\bboleto\b/.test(lower)) return 'BOLETO';
    if (/\btransfer[eê]ncia\b/.test(lower)) return 'TRANSFERENCIA';
    return tipo === 'ENTRADA' ? 'TRANSFERENCIA' : 'PIX';
  }

  function extractDateIso(text, referenceDateIso) {
    var baseIso = referenceDateIso || SpreadsheetRepository.todayIso();
    var lower = String(text || '').toLowerCase();

    // 1. Data completa explícita dd/mm/aaaa
    var explicitBr = lower.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (explicitBr) {
      try {
        var dayStr = ('0' + explicitBr[1]).slice(-2);
        var monStr = ('0' + explicitBr[2]).slice(-2);
        return ValidationService.validateIsoDate(explicitBr[3] + '-' + monStr + '-' + dayStr, 'data', false);
      } catch (e) {}
    }

    // 2. Data abreviada dd/mm (ex: 15/11 ou 05/12)
    var dayMonthMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (dayMonthMatch) {
      try {
        var pYear = baseIso.substring(0, 4);
        var dStr = ('0' + dayMonthMatch[1]).slice(-2);
        var mStr = ('0' + dayMonthMatch[2]).slice(-2);
        var candidateIso = pYear + '-' + mStr + '-' + dStr;
        if (candidateIso < baseIso && parseInt(mStr, 10) < parseInt(baseIso.substring(5, 7), 10)) {
          candidateIso = (parseInt(pYear, 10) + 1) + '-' + mStr + '-' + dStr;
        }
        return ValidationService.validateIsoDate(candidateIso, 'data', false);
      } catch (e) {}
    }

    var parts = baseIso.split('-');
    var baseUtc = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));

    if (/\banteontem\b/.test(lower)) {
      return new Date(baseUtc.getTime() - 2 * 86400000).toISOString().substring(0, 10);
    }
    if (/\bontem\b/.test(lower)) {
      return new Date(baseUtc.getTime() - 86400000).toISOString().substring(0, 10);
    }
    if (/\bamanh[aã]\b/.test(lower)) {
      return new Date(baseUtc.getTime() + 86400000).toISOString().substring(0, 10);
    }
    if (/\bdepois\s+de\s+amanh[aã]\b/.test(lower)) {
      return new Date(baseUtc.getTime() + 2 * 86400000).toISOString().substring(0, 10);
    }

    // 3. Menção de dia do mês: "dia 15", "vence dia 20", "para o dia 10", "pro dia 5"
    var diaMatch = lower.match(/\b(?:vence\s+dia|vencimento\s+dia|para\s+(?:o\s+)?dia|pro\s+dia|dia)\s+(\d{1,2})\b/i);
    if (diaMatch) {
      var dNum = parseInt(diaMatch[1], 10);
      if (dNum >= 1 && dNum <= 31) {
        var curYear = parseInt(parts[0], 10);
        var curMonth = parseInt(parts[1], 10);
        var curDay = parseInt(parts[2], 10);

        var targetMonth = curMonth;
        var targetYear = curYear;
        if (dNum < curDay) {
          targetMonth++;
          if (targetMonth > 12) {
            targetMonth = 1;
            targetYear++;
          }
        }
        var mFormatted = ('0' + targetMonth).slice(-2);
        var dFormatted = ('0' + dNum).slice(-2);
        return targetYear + '-' + mFormatted + '-' + dFormatted;
      }
    }

    return baseIso;
  }

  function detectLaunchStatus(text, dataIso, todayIso) {
    var lower = String(text || '').toLowerCase();
    var hasPendingWord = /\b(a\s+vencer|vence|vencimento|para\s+pagar|a\s+pagar|previsto|previs[aã]o|agendado|programado|fatura|boleto\s+a\s+vencer|contas?\s+do\s+m[eê]s)\b/i.test(lower);
    if (hasPendingWord) {
      return 'PREVISTO';
    }
    if (dataIso && todayIso && dataIso > todayIso) {
      return 'PREVISTO';
    }
    return 'CONFIRMADO';
  }

  function suggestCategoryAndDescription(user, text, tipo) {
    var lower = String(text || '').toLowerCase();
    var categories = FinanceService.listCategoriesWithSubcategories(user);

    var keywordRules = [
      { regex: /\b(supermercado|mercado|feira|padaria)\b/i, cat: 'Alimentação', sub: 'Supermercado', desc: 'Supermercado' },
      { regex: /\b(almo[cç]o|restaurante|jantar|lanche)\b/i, cat: 'Alimentação', sub: 'Restaurante / Almoço', desc: 'Almoço' },
      { regex: /\b(farm[aá]cia|rem[eé]dio|medicamento)\b/i, cat: 'Saúde', sub: 'Farmácia', desc: 'Farmácia' },
      { regex: /\b(consulta|exame|m[eé]dico|hospital)\b/i, cat: 'Saúde', sub: 'Consultas e Exames', desc: 'Consulta / Saúde' },
      { regex: /\b([aá]gua|saneamento|sabesp|copasa)\b/i, cat: 'Moradia', sub: 'Água', desc: 'Água' },
      { regex: /\b(luz|energia|eletricidade)\b/i, cat: 'Moradia', sub: 'Energia', desc: 'Energia' },
      { regex: /\b(aluguel|condom[ií]nio)\b/i, cat: 'Moradia', sub: 'Aluguel / Condomínio', desc: 'Moradia' },
      { regex: /\b(combust[ií]vel|gasolina|etanol|posto)\b/i, cat: 'Transporte', sub: 'Combustível', desc: 'Combustível' },
      { regex: /\b(uber|99|t[aá]xi|[oô]nibus|metr[oô])\b/i, cat: 'Transporte', sub: 'Transporte Público / App', desc: 'Transporte' },
      { regex: /\b(sal[aá]rio)\b/i, cat: 'Salário', sub: 'Salário Mensal', desc: 'Salário' },
      { regex: /\b(servi[cç]o\s+extra|por\s+um\s+servi[cç]o|servi[cç]o|freelance|bico)\b/i, cat: 'Renda Extra', sub: 'Serviço Prestado', desc: 'Serviço extra' }
    ];

    var matchedRule = null;
    for (var i = 0; i < keywordRules.length; i++) {
      if (keywordRules[i].regex.test(lower)) {
        matchedRule = keywordRules[i];
        break;
      }
    }

    var foundCat = null;
    var foundSub = null;

    if (matchedRule) {
      for (var c = 0; c < categories.length; c++) {
        if (categories[c].nome.toLowerCase() === matchedRule.cat.toLowerCase()) {
          foundCat = categories[c];
          for (var s = 0; s < (foundCat.subcategorias || []).length; s++) {
            if (foundCat.subcategorias[s].nome.toLowerCase() === matchedRule.sub.toLowerCase()) {
              foundSub = foundCat.subcategorias[s];
              break;
            }
          }
          break;
        }
      }
    }

    // Fallback: procura nome de categoria diretamente no texto
    if (!foundCat) {
      for (var k = 0; k < categories.length; k++) {
        var catObj = categories[k];
        if (lower.indexOf(catObj.nome.toLowerCase()) !== -1) {
          foundCat = catObj;
          break;
        }
      }
    }

    // Fallback por tipo (ENTRADA vs SAIDA)
    if (!foundCat && categories.length > 0) {
      for (var f = 0; f < categories.length; f++) {
        if (categories[f].tipo === tipo || categories[f].tipo === 'AMBOS') {
          foundCat = categories[f];
          break;
        }
      }
    }

    // Extrai descrição limpa caso nenhuma palavra-chave padrão tenha definido
    var descricao = matchedRule ? matchedRule.desc : '';
    if (!descricao) {
      descricao = ValidationService.sanitizeText(
        text
          .replace(/^(hoje\s+eu\s+|hoje\s+|ontem\s+)?(gastei|paguei|recebi|comprei)\s+/i, '')
          .replace(/R\$\s*[\d.,]+/gi, '')
          .replace(/\b\d+[.,]?\d*\s*reais?\b/gi, '')
          .replace(/\b(hoje|ontem|no\s+pix|no\s+d[eé]bito|no\s+cart[aã]o|em\s+dinheiro)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim(),
        120
      );
      if (!descricao) {
        descricao = tipo === 'ENTRADA' ? 'Receita informada via Telegram' : 'Despesa informada via Telegram';
      }
    }

    return {
      descricao: descricao,
      categoria_sugerida: foundCat ? foundCat.nome : (matchedRule ? matchedRule.cat : null),
      categoria_id: foundCat ? foundCat.id : null,
      subcategoria_sugerida: foundSub ? foundSub.nome : (matchedRule ? matchedRule.sub : null),
      subcategoria_id: foundSub ? foundSub.id : null
    };
  }

  function matchBankAccount(user, text) {
    var lower = String(text || '').toLowerCase();
    var accounts = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id, function (a) {
      return a.situacao === 'ATIVA';
    });

    for (var i = 0; i < accounts.length; i++) {
      var acc = accounts[i];
      var nomeLower = String(acc.nome_identificacao || '').toLowerCase();
      var instLower = String(acc.instituicao || '').toLowerCase();
      if (
        (nomeLower && lower.indexOf(nomeLower) !== -1) ||
        (instLower && lower.indexOf(instLower) !== -1)
      ) {
        return {
          conta_bancaria_sugerida: acc.nome_identificacao,
          conta_bancaria_id: acc.id
        };
      }
    }

    // Se o usuário mencionou "conta principal" e tem conta padrão configurada
    if (lower.indexOf('conta principal') !== -1 && user.conta_padrao_id) {
      var padrao = SpreadsheetRepository.findById('CONTAS_BANCARIAS', user.conta_padrao_id, user.grupo_id);
      if (padrao && padrao.situacao === 'ATIVA') {
        return {
          conta_bancaria_sugerida: padrao.nome_identificacao,
          conta_bancaria_id: padrao.id
        };
      }
    }

    // Se o usuário usar regra de conta padrão automática (opcional na configuração)
    var configs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', user.grupo_id);
    var usarPadraoAutomatico = false;
    for (var c = 0; c < configs.length; c++) {
      if (configs[c].chave === 'USAR_CONTA_PADRAO_TELEGRAM' && String(configs[c].valor) === 'true') {
        usarPadraoAutomatico = true;
        break;
      }
    }

    if (usarPadraoAutomatico && user.conta_padrao_id) {
      var defAcc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', user.conta_padrao_id, user.grupo_id);
      if (defAcc && defAcc.situacao === 'ATIVA') {
        return {
          conta_bancaria_sugerida: defAcc.nome_identificacao,
          conta_bancaria_id: defAcc.id
        };
      }
    }

    return {
      conta_bancaria_sugerida: null,
      conta_bancaria_id: null
    };
  }

  /**
   * Interpreta mensagem em linguagem natural e produz o objeto estruturado da seção 7.6.
   */
  function parseNaturalLanguageLaunch(user, rawText, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var text = ValidationService.sanitizeText(rawText, 600);
    if (!text) {
      throw new Error('EMPTY_MESSAGE: Mensagem vazia.');
    }

    // 1. Verifica proibições expressas de escopo (Seção 7.1)
    var scopeCheck = detectForbiddenScope(text);
    if (scopeCheck.bloqueado) {
      var err = new Error(scopeCheck.mensagem);
      err.code = 'FORBIDDEN_SCOPE';
      err.categoria_bloqueio = scopeCheck.categoria_bloqueio;
      throw err;
    }

    // 2. Extrai tipo (ENTRADA / SAIDA) e valor em centavos
    var tipo = detectLaunchType(text);
    var amountResult = extractAmountInCentavos(text);
    var dataIso = extractDateIso(text, opts.referenceDateIso);
    var formaPagamento = detectPaymentMethod(text, tipo || 'SAIDA');
    var catDesc = suggestCategoryAndDescription(user, text, tipo || 'SAIDA');
    var accountMatch = matchBankAccount(user, text);

    // Inferência contextual caso o tipo não tenha sido capturado por verbo explícito
    if (!tipo && catDesc && catDesc.categoria_sugerida) {
      var catLower = String(catDesc.categoria_sugerida).toLowerCase();
      if (catLower.indexOf('salário') !== -1 || catLower.indexOf('renda extra') !== -1) {
        tipo = 'ENTRADA';
      } else {
        tipo = 'SAIDA';
      }
    } else if (!tipo && amountResult.valor_centavos) {
      // Se há um valor informado e nenhuma indicação de receita, trata como Saída
      tipo = 'SAIDA';
    }

    var camposPendentes = [];
    if (!tipo) {
      camposPendentes.push('tipo');
    }
    if (!amountResult.valor_centavos || amountResult.ambiguidade) {
      camposPendentes.push('valor_centavos');
    }
    if (!accountMatch.conta_bancaria_id) {
      camposPendentes.push('conta_bancaria');
    }

    var confianca = (camposPendentes.length === 0 || (camposPendentes.length === 1 && camposPendentes[0] === 'conta_bancaria'))
      ? 'alta'
      : 'baixa';

    var situacao = detectLaunchStatus(text, dataIso, opts.referenceDateIso || SpreadsheetRepository.todayIso());

    return {
      tipo: tipo,
      descricao: catDesc.descricao,
      valor_centavos: amountResult.valor_centavos,
      data: dataIso,
      situacao: situacao,
      categoria_sugerida: catDesc.categoria_sugerida,
      categoria_id: catDesc.categoria_id,
      subcategoria_sugerida: catDesc.subcategoria_sugerida,
      subcategoria_id: catDesc.subcategoria_id,
      conta_bancaria_sugerida: accountMatch.conta_bancaria_sugerida,
      conta_bancaria_id: accountMatch.conta_bancaria_id,
      forma_pagamento: formaPagamento,
      observacoes: null,
      campos_pendentes: camposPendentes,
      confianca: confianca
    };
  }

  return {
    detectForbiddenScope: detectForbiddenScope,
    parsePortugueseWordsChunk: parsePortugueseWordsChunk,
    extractAmountInCentavos: extractAmountInCentavos,
    parseNaturalLanguageLaunch: parseNaturalLanguageLaunch
  };
})();

