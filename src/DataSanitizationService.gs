/**
 * @file DataSanitizationService.gs
 * @description Central de sanitização recursiva de dados sensíveis (LGPD/OWASP),
 * proteção contra injeção de fórmulas (CSV / Formula Injection) no Google Sheets
 * e validação estrita de tipos de dados.
 */

var DataSanitizationService = (function () {
  var SENSITIVE_KEYS_REGEX = /^(token|session_token|token_sessao|secret|password|senha|hash_senha|salt|api_key|apikey|gemini_key|bot_token|telegram_token|access_token|refresh_token|private_key|auth|auth_header)$/i;

  var TELEGRAM_TOKEN_REGEX = /\b\d{6,10}:[A-Za-z0-9_-]{30,}\b/g;
  var GOOGLE_API_KEY_REGEX = /\bAIza[0-9A-Za-z-_]{35}\b/g;
  var CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
  var CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;

  /**
   * Protege contra injeção de fórmulas no Google Sheets / Excel.
   * Não aplica apóstrofo a números ou valores que começam com - ou + quando são numéricos puros.
   * Aplica apenas a strings de texto que contenham fórmulas ou operadores perigosos no início.
   */
  function escapeFormula(val) {
    if (val === undefined || val === null) {
      return '';
    }
    // Preserva tipos primitivos numéricos e booleanos intactos
    if (typeof val === 'number') {
      return isNaN(val) ? 0 : val;
    }
    if (typeof val === 'boolean') {
      return val;
    }

    var str = String(val);
    if (!str) return '';

    // Verifica se a string é estritamente um número válido (ex: "-150", "+50", "123.45", "-0.05")
    // Se for um número puro, NÃO deve ser prefixado com apóstrofo!
    var trimmed = str.trim();
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
      return str;
    }

    // Se começar com caracteres executáveis pelo Sheets/Excel (=, +, -, @, tab, retorno de carro)
    if (/^\s*[=+\-@\t\r]/.test(str)) {
      // Evita duplicar apóstrofo se já tiver sido escapado
      if (str.charAt(0) === "'") {
        return str;
      }
      return "'" + str;
    }

    return str;
  }

  /**
   * Remove o apóstrofo protetor de injeção de fórmulas ao ler valores da planilha.
   */
  function unescapeFormula(val) {
    if (typeof val !== 'string' || !val) {
      return val;
    }
    if (val.charAt(0) === "'" && /^[=+\-@\t\r]/.test(val.substring(1))) {
      return val.substring(1);
    }
    return val;
  }

  /**
   * Sanitização recursiva e profunda de estruturas de dados (objetos, arrays e strings).
   * Redige tokens, senhas, chaves de API, CPFs e cartões de crédito.
   */
  function sanitizeSensitiveData(input, maxDepth) {
    var depth = (maxDepth !== undefined) ? maxDepth : 10;
    if (depth <= 0 || input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      return input
        .replace(TELEGRAM_TOKEN_REGEX, '[REDACTED_TELEGRAM_TOKEN]')
        .replace(GOOGLE_API_KEY_REGEX, '[REDACTED_API_KEY]')
        .replace(CPF_REGEX, '***.***.***-**')
        .replace(CREDIT_CARD_REGEX, '****-****-****-****');
    }

    if (typeof input === 'number' || typeof input === 'boolean') {
      return input;
    }

    if (Array.isArray(input)) {
      var safeArr = [];
      for (var i = 0; i < input.length; i++) {
        safeArr.push(sanitizeSensitiveData(input[i], depth - 1));
      }
      return safeArr;
    }

    if (typeof input === 'object') {
      var safeObj = {};
      var keys = Object.keys(input);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (SENSITIVE_KEYS_REGEX.test(key)) {
          safeObj[key] = '[REDACTED]';
        } else {
          safeObj[key] = sanitizeSensitiveData(input[key], depth - 1);
        }
      }
      return safeObj;
    }

    return input;
  }

  /**
   * Validação estrita por tipo de campo.
   */
  function validateFieldType(type, value, options) {
    var opts = options || {};
    var fieldName = opts.fieldName || 'Campo';

    switch (type) {
      case 'TEXT':
        if (typeof value !== 'string') {
          return { ok: false, error: fieldName + ' deve ser uma string de texto.' };
        }
        var minLen = opts.min !== undefined ? opts.min : 0;
        var maxLen = opts.max !== undefined ? opts.max : 5000;
        if (value.length < minLen || value.length > maxLen) {
          return { ok: false, error: fieldName + ' deve ter entre ' + minLen + ' e ' + maxLen + ' caracteres.' };
        }
        return { ok: true, value: value.trim() };

      case 'NUMBER':
        var num = Number(value);
        if (isNaN(num)) {
          return { ok: false, error: fieldName + ' deve ser um valor numérico válido.' };
        }
        if (opts.min !== undefined && num < opts.min) {
          return { ok: false, error: fieldName + ' não pode ser menor que ' + opts.min + '.' };
        }
        if (opts.max !== undefined && num > opts.max) {
          return { ok: false, error: fieldName + ' não pode ser maior que ' + opts.max + '.' };
        }
        return { ok: true, value: num };

      case 'CURRENCY_CENTS':
        var cents = Number(value);
        if (isNaN(cents) || !Number.isInteger(cents)) {
          return { ok: false, error: fieldName + ' deve ser um valor inteiro em centavos.' };
        }
        if (opts.allowNegative === false && cents < 0) {
          return { ok: false, error: fieldName + ' não pode ser negativo.' };
        }
        return { ok: true, value: cents };

      case 'DATE_ISO':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { ok: false, error: fieldName + ' deve estar no formato ISO AAAA-MM-DD.' };
        }
        var d = new Date(value + 'T00:00:00Z');
        if (isNaN(d.getTime())) {
          return { ok: false, error: fieldName + ' possui data de calendário inválida.' };
        }
        return { ok: true, value: value };

      case 'EMAIL':
        if (typeof value !== 'string') {
          return { ok: false, error: fieldName + ' deve ser um endereço de e-mail.' };
        }
        var cleanEmail = value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          return { ok: false, error: fieldName + ' possui formato de e-mail inválido.' };
        }
        return { ok: true, value: cleanEmail };

      case 'ENUM':
        var allowed = opts.allowed || [];
        if (allowed.indexOf(value) === -1) {
          return { ok: false, error: fieldName + ' deve ser um dos valores permitidos: ' + allowed.join(', ') + '.' };
        }
        return { ok: true, value: value };

      default:
        return { ok: true, value: value };
    }
  }

  return {
    escapeFormula: escapeFormula,
    unescapeFormula: unescapeFormula,
    sanitizeSensitiveData: sanitizeSensitiveData,
    validateFieldType: validateFieldType
  };
})();

