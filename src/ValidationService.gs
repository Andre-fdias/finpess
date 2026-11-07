/**
 * @file ValidationService.gs
 * @description Validações determinísticas de valores em centavos, datas, enums,
 * relacionamentos financeiros e sanitização contra XSS e Formula Injection no Google Sheets.
 */

var ValidationService = (function () {
  var LAUNCH_TYPES = ['ENTRADA', 'SAIDA'];
  var LAUNCH_STATUSES = ['PREVISTO', 'PENDENTE', 'CONFIRMADO', 'CANCELADO'];
  var LAUNCH_ORIGINS = ['MANUAL', 'RECORRENCIA', 'TELEGRAM', 'INTEGRACAO'];
  var PAYMENT_METHODS = ['PIX', 'DEBITO', 'CREDITO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA', 'FOLHA', 'AUTOMATICO', 'OUTRO'];
  var USER_STATUSES = ['PENDENTE', 'APROVADO', 'BLOQUEADO', 'REVOGADO'];
  var USER_ROLES = ['OWNER', 'ADMIN', 'MEMBRO', 'USUARIO'];
  var THEMES = ['light', 'dark', 'auto'];

  /**
   * Sanitiza texto removendo tags HTML e prevenindo Formula Injection no Google Sheets.
   */
  function sanitizeText(value, maxLength) {
    if (value === undefined || value === null) return '';
    var str = String(value)
      .replace(/<[^>]*>?/gm, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .trim();

    // Prevenção contra CSV / Spreadsheet Formula Injection (=, +, -, @ no início)
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    var limit = maxLength || 500;
    if (str.length > limit) {
      str = str.substring(0, limit);
    }
    return str;
  }

  /**
   * Valida que o valor é um número inteiro em centavos dentro do intervalo permitido.
   */
  function validateCentavos(value, fieldName, allowZero) {
    var label = fieldName || 'valor_centavos';
    if (value === undefined || value === null || value === '') {
      throw new Error('Campo obrigatório ausente: ' + label);
    }
    var num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) !== num) {
      throw new Error('O campo ' + label + ' deve ser um número inteiro em centavos (recebido: ' + value + ').');
    }
    if (allowZero) {
      if (num < 0) {
        throw new Error('O campo ' + label + ' não pode ser negativo.');
      }
    } else {
      if (num <= 0) {
        throw new Error('O campo ' + label + ' deve ser maior que zero centavos.');
      }
    }
    if (num > 99999999999) {
      throw new Error('O campo ' + label + ' excede o limite máximo permitido.');
    }
    return num;
  }

  /**
   * Converte string monetária brasileira ("R$ 1.234,56" ou "45,50" ou "120") em centavos inteiros.
   */
  function parseCurrencyToCentavos(input) {
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        throw new Error('Valor numérico inválido.');
      }
      return Math.round(input * 100);
    }
    if (typeof input !== 'string') {
      throw new Error('Formato de valor monetário inválido.');
    }
    var cleaned = input
      .replace(/R\$/gi, '')
      .replace(/\s+/g, '')
      .trim();

    if (!cleaned) {
      throw new Error('Valor monetário vazio.');
    }

    // Formato brasileiro com vírgula decimal: "1.234,56" ou "89,90"
    if (cleaned.indexOf(',') !== -1) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      // Ex: "3.500" ou "4.200" (milhares sem centavos)
      cleaned = cleaned.replace(/\./g, '');
    }

    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new Error('Valor monetário em formato inválido: ' + input);
    }

    var parts = cleaned.split('.');
    var negative = parts[0].charAt(0) === '-';
    var reaisStr = negative ? parts[0].substring(1) : parts[0];
    var centavosStr = parts[1] ? (parts[1] + '00').substring(0, 2) : '00';
    var total = parseInt(reaisStr, 10) * 100 + parseInt(centavosStr, 10);
    return negative ? -total : total;
  }

  /**
   * Formata valor inteiro em centavos para moeda brasileira "R$ 1.234,56".
   */
  function formatCentavosToBrl(centavos) {
    var num = Number(centavos);
    if (!Number.isFinite(num)) num = 0;
    var isNeg = num < 0;
    var abs = Math.abs(Math.round(num));
    var reais = Math.floor(abs / 100);
    var cents = abs % 100;
    var reaisFormatted = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var centsFormatted = String(cents).padStart(2, '0');
    return (isNeg ? '-R$ ' : 'R$ ') + reaisFormatted + ',' + centsFormatted;
  }

  /**
   * Valida e normaliza datas YYYY-MM-DD ou DD/MM/YYYY para YYYY-MM-DD.
   */
  function validateIsoDate(value, fieldName, allowEmpty) {
    var label = fieldName || 'data';
    if (!value || String(value).trim() === '') {
      if (allowEmpty) return '';
      throw new Error('Data obrigatória ausente no campo ' + label + '.');
    }
    var str = String(value).trim();

    // Suporte a DD/MM/YYYY
    var brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      str = brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1];
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
      str = str.substring(0, 10);
    }

    var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoMatch) {
      throw new Error('Data inválida para ' + label + ' (esperado YYYY-MM-DD ou DD/MM/YYYY): ' + value);
    }
    var year = parseInt(isoMatch[1], 10);
    var month = parseInt(isoMatch[2], 10);
    var day = parseInt(isoMatch[3], 10);
    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error('Data fora de intervalo válido em ' + label + ': ' + str);
    }
    var checkDate = new Date(Date.UTC(year, month - 1, day));
    if (
      checkDate.getUTCFullYear() !== year ||
      checkDate.getUTCMonth() + 1 !== month ||
      checkDate.getUTCDate() !== day
    ) {
      throw new Error('Dia calendário inexistente em ' + label + ': ' + str);
    }
    return str;
  }

  function formatDateBr(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '';
    var m = isoDate.substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return isoDate;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function validateEnum(value, allowedList, fieldName) {
    var val = String(value || '').toUpperCase().trim();
    if (allowedList.indexOf(val) === -1) {
      throw new Error('Valor inválido para ' + fieldName + ': "' + value + '". Valores permitidos: ' + allowedList.join(', '));
    }
    return val;
  }

  function validateLaunchPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados do lançamento não informados.');
    }
    var tipo = validateEnum(payload.tipo, LAUNCH_TYPES, 'tipo');
    var descricao = sanitizeText(payload.descricao, 200);
    if (!descricao) {
      throw new Error('A descrição do lançamento é obrigatória.');
    }
    var valorCentavos = validateCentavos(payload.valor_centavos, 'valor_centavos', false);
    var dataLancamento = validateIsoDate(payload.data_lancamento, 'data_lancamento', false);
    var dataCompetencia = payload.data_competencia
      ? validateIsoDate(payload.data_competencia, 'data_competencia', true)
      : dataLancamento;
    var situacao = validateEnum(payload.situacao || 'CONFIRMADO', LAUNCH_STATUSES, 'situacao');
    var origem = validateEnum(payload.origem || 'MANUAL', LAUNCH_ORIGINS, 'origem');
    var formaPagamento = validateEnum(payload.forma_pagamento || 'PIX', PAYMENT_METHODS, 'forma_pagamento');

    if (!payload.conta_bancaria_id) {
      throw new Error('A conta bancária é obrigatória para registrar um lançamento financeiro.');
    }
    if (!payload.categoria_id) {
      throw new Error('A categoria é obrigatória para registrar um lançamento financeiro.');
    }

    return {
      tipo: tipo,
      natureza_operacao: payload.natureza_operacao || 'PADRAO',
      transferencia_id: payload.transferencia_id ? sanitizeText(payload.transferencia_id, 64) : '',
      descricao: descricao,
      valor_centavos: valorCentavos,
      data_lancamento: dataLancamento,
      data_competencia: dataCompetencia,
      data_pagamento: situacao === 'CONFIRMADO' ? (payload.data_pagamento ? validateIsoDate(payload.data_pagamento, 'data_pagamento', true) : dataLancamento) : '',
      categoria_id: sanitizeText(payload.categoria_id, 64),
      subcategoria_id: payload.subcategoria_id ? sanitizeText(payload.subcategoria_id, 64) : '',
      conta_bancaria_id: sanitizeText(payload.conta_bancaria_id, 64),
      forma_pagamento: formaPagamento,
      situacao: situacao,
      origem: origem,
      referencia_recorrencia_id: payload.referencia_recorrencia_id ? sanitizeText(payload.referencia_recorrencia_id, 64) : '',
      competencia_recorrencia: payload.competencia_recorrencia ? sanitizeText(payload.competencia_recorrencia, 16) : '',
      referencia_parcela_id: payload.referencia_parcela_id ? sanitizeText(payload.referencia_parcela_id, 64) : '',
      id_origem_externa: payload.id_origem_externa ? sanitizeText(payload.id_origem_externa, 120) : '',
      observacoes: sanitizeText(payload.observacoes || '', 500)
    };
  }

  return {
    LAUNCH_TYPES: LAUNCH_TYPES,
    LAUNCH_STATUSES: LAUNCH_STATUSES,
    LAUNCH_ORIGINS: LAUNCH_ORIGINS,
    PAYMENT_METHODS: PAYMENT_METHODS,
    USER_STATUSES: USER_STATUSES,
    USER_ROLES: USER_ROLES,
    THEMES: THEMES,
    sanitizeText: sanitizeText,
    validateCentavos: validateCentavos,
    parseCurrencyToCentavos: parseCurrencyToCentavos,
    formatCentavosToBrl: formatCentavosToBrl,
    validateIsoDate: validateIsoDate,
    formatDateBr: formatDateBr,
    validateEnum: validateEnum,
    validateLaunchPayload: validateLaunchPayload
  };
})();

