/**
 * @file SpreadsheetRepository.gs
 * @description Camada de persistência controlada para Google Sheets com 27 abas,
 * validação de esquema, migração segura, controle de concorrência (LockService),
 * operações em lote e backup/restauração preservando IDs e relacionamentos.
 */

var SpreadsheetRepository = (function () {
  var SCHEMA_VERSION = '1.3.1';
  var DEFAULT_SPREADSHEET_ID = '1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c';

  /**
   * Definição oficial das 28 abas obrigatórias e seus cabeçalhos estáveis.
   */
  var SHEETS_SCHEMA = {
    CONFIGURACOES: [
      'id', 'grupo_id', 'chave', 'valor', 'descricao', 'atualizado_em', 'atualizado_por'
    ],
    USUARIOS: [
      'id', 'email', 'nome', 'papel', 'status', 'grupo_id', 'tema_preferido',
      'conta_padrao_id', 'notificacoes_email_ativas', 'foto_url', 'criado_em', 'atualizado_em', 'aprovado_por',
      'hash_senha', 'salt', 'token_sessao',
      'token_sessao_expira_em', 'token_sessao_criado_em', 'token_sessao_ultima_atividade'
    ],
    GRUPOS_FINANCEIROS: [
      'id', 'nome', 'proprietario_id', 'tipo', 'situacao', 'criado_em', 'atualizado_em'
    ],
    CONTAS_BANCARIAS: [
      'id', 'grupo_id', 'instituicao', 'nome_identificacao', 'tipo_conta',
      'saldo_inicial_centavos', 'data_saldo_inicial', 'situacao', 'observacoes',
      'proprietario_id', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    CATEGORIAS: [
      'id', 'grupo_id', 'nome', 'tipo', 'orcamento_mensal_centavos',
      'icone', 'cor', 'situacao', 'criado_em'
    ],
    SUBCATEGORIAS: [
      'id', 'grupo_id', 'categoria_id', 'nome', 'situacao', 'criado_em'
    ],
    CONTAS_RECORRENTES: [
      'id', 'grupo_id', 'nome', 'tipo', 'categoria_id', 'subcategoria_id',
      'valor_previsto_centavos', 'natureza', 'recorrencia', 'dia_vencimento',
      'data_inicio', 'data_termino', 'conta_bancaria_padrao_id', 'forma_pagamento',
      'regra_competencia', 'notificacoes_ativas', 'antecedencia_lembrete_dias',
      'observacoes', 'situacao', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    LANCAMENTOS: [
      'id', 'grupo_id', 'tipo', 'natureza_operacao', 'transferencia_id',
      'descricao', 'valor_centavos', 'data_lancamento', 'data_competencia',
      'data_pagamento', 'categoria_id', 'subcategoria_id', 'conta_bancaria_id',
      'forma_pagamento', 'situacao', 'origem', 'referencia_recorrencia_id',
      'competencia_recorrencia', 'referencia_parcela_id', 'id_origem_externa',
      'observacoes', 'criado_em', 'atualizado_em', 'usuario_responsavel_id'
    ],
    DIVIDAS: [
      'id', 'grupo_id', 'credor', 'descricao', 'valor_original_centavos',
      'valor_atualizado_centavos', 'data_origem', 'vencimento_original', 'situacao',
      'proposta_negociacao', 'valor_negociado_centavos', 'quantidade_parcelas',
      'primeiro_vencimento_acordo', 'repercutir_fluxo_caixa', 'observacoes',
      'criado_em', 'atualizado_em', 'criado_por'
    ],
    EMPRESTIMOS: [
      'id', 'grupo_id', 'instituicao', 'descricao', 'tipo_emprestimo',
      'valor_contratado_centavos', 'taxa_juros_mensal_bps', 'numero_parcelas',
      'valor_parcela_centavos', 'data_inicial', 'dia_vencimento', 'saldo_devedor_centavos',
      'desconto_em_folha', 'desconto_em_folha_ja_deduzido_salario', 'conta_bancaria_id',
      'situacao', 'observacoes', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    PARCELAS: [
      'id', 'grupo_id', 'origem_tipo', 'origem_id', 'numero_parcela',
      'total_parcelas', 'valor_centavos', 'data_vencimento', 'data_pagamento',
      'situacao', 'lancamento_id', 'observacoes', 'criado_em', 'atualizado_em'
    ],
    INVESTIMENTOS: [
      'id', 'grupo_id', 'nome_ativo', 'classe_ativo', 'instituicao',
      'quantidade_milesimos', 'preco_medio_centavos', 'valor_aplicado_centavos',
      'valor_mercado_informado_centavos', 'data_referencia', 'rendimentos_acumulados_centavos',
      'situacao', 'observacoes', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    MOVIMENTOS_INVESTIMENTOS: [
      'id', 'grupo_id', 'investimento_id', 'tipo_movimento', 'quantidade_milesimos',
      'valor_centavos', 'data_movimento', 'conta_bancaria_id', 'lancamento_id',
      'observacoes', 'criado_em', 'criado_por'
    ],
    PROJECOES: [
      'id', 'grupo_id', 'competencia', 'saldo_inicial_realizado_centavos',
      'receitas_confirmadas_centavos', 'receitas_previstas_centavos',
      'despesas_confirmadas_centavos', 'despesas_previstas_centavos',
      'parcelas_compromissos_centavos', 'saldo_final_projetado_centavos',
      'premissas_json', 'gerado_em', 'gerado_por'
    ],
    AGENDA_SYNC: [
      'id', 'grupo_id', 'origem_tipo', 'origem_id', 'calendar_id',
      'external_event_id', 'titulo_evento', 'data_evento', 'valor_centavos',
      'status_sync', 'tentativas', 'ultimo_erro', 'ultima_sincronizacao_em'
    ],
    NOTIFICACOES: [
      'id', 'grupo_id', 'usuario_id', 'destinatario_email', 'tipo_notificacao',
      'referencia_id', 'idempotency_key', 'assunto', 'resumo_corpo',
      'status', 'tentativas', 'ultimo_erro', 'agendado_para', 'enviado_em', 'criado_em',
      'titulo', 'mensagem', 'prioridade', 'categoria', 'canais',
      'status_leitura', 'data_leitura', 'adiado_ate', 'contagem_adiamentos', 'referencia_modulo'
    ],
    ANALISES_IA: [
      'id', 'grupo_id', 'usuario_id', 'periodo_analisado', 'pergunta_usuario',
      'fatos_calculados_json', 'recomendacao_ia', 'provedor_modelo', 'criado_em'
    ],
    INTEGRACOES: [
      'id', 'grupo_id', 'servico', 'status', 'config_publica_json',
      'ultima_execucao_em', 'ultimo_status_msg', 'atualizado_em'
    ],
    TELEGRAM_VINCULOS: [
      'id', 'grupo_id', 'usuario_id', 'telegram_user_id', 'telegram_chat_id',
      'codigo_vinculacao_hash', 'codigo_expira_em', 'codigo_usado',
      'status_vinculo', 'vinculado_em', 'revogado_em', 'criado_em'
    ],
    TELEGRAM_PROCESSAMENTOS: [
      'id', 'grupo_id', 'usuario_id', 'telegram_update_id', 'telegram_message_id',
      'telegram_chat_id', 'tipo_entrada', 'estado', 'dados_extraidos_json',
      'campos_pendentes_json', 'preview_hash', 'lancamento_gerado_id',
      'expira_em', 'erro_msg', 'criado_em', 'atualizado_em'
    ],
    CARTOES_CREDITO: [
      'id', 'grupo_id', 'nome', 'emissor', 'bandeira', 'titular', 'ultimos_digitos',
      'limite_total_centavos', 'limite_adicional_centavos', 'dia_fechamento', 'dia_vencimento',
      'conta_bancaria_id', 'cor_cartao', 'ativo', 'observacoes', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    FATURAS_CARTAO: [
      'id', 'grupo_id', 'cartao_id', 'mes_competencia', 'data_fechamento', 'data_vencimento',
      'situacao', 'valor_total_centavos', 'valor_pago_centavos', 'data_pagamento',
      'lancamento_pagamento_id', 'observacoes', 'criado_em', 'atualizado_em'
    ],
    COMPRAS_CARTAO: [
      'id', 'grupo_id', 'cartao_id', 'fatura_inicial_id', 'data_compra', 'descricao',
      'categoria_id', 'subcategoria_id', 'valor_total_centavos', 'parcelas_total',
      'situacao', 'observacoes', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    PARCELAS_CARTAO: [
      'id', 'grupo_id', 'compra_id', 'cartao_id', 'fatura_id', 'numero_parcela',
      'total_parcelas', 'valor_centavos', 'mes_competencia', 'situacao',
      'observacoes', 'criado_em', 'atualizado_em'
    ],
    PAGAMENTOS_FATURA: [
      'id', 'grupo_id', 'fatura_id', 'cartao_id', 'conta_bancaria_id', 'lancamento_id',
      'data_pagamento', 'valor_pago_centavos', 'comprovante_url', 'observacoes', 'criado_em', 'criado_por'
    ],
    AJUSTES_CARTAO: [
      'id', 'grupo_id', 'fatura_id', 'cartao_id', 'tipo', 'descricao',
      'valor_centavos', 'data_ajuste', 'observacoes', 'criado_em', 'criado_por'
    ],
    METAS_FINANCEIRAS: [
      'id', 'grupo_id', 'nome', 'descricao', 'categoria_meta', 'valor_alvo_centavos',
      'valor_atual_centavos', 'data_limite', 'conta_bancaria_id', 'cor', 'icone',
      'situacao', 'observacoes', 'criado_em', 'atualizado_em', 'criado_por'
    ],
    AUDITORIA: [
      'id', 'grupo_id', 'usuario_id', 'acao', 'entidade', 'entidade_id',
      'origem', 'detalhes_resumo', 'criado_em'
    ]
  };

  var INTEGER_COLUMNS = {
    saldo_inicial_centavos: true,
    orcamento_mensal_centavos: true,
    valor_previsto_centavos: true,
    dia_vencimento: true,
    antecedencia_lembrete_dias: true,
    valor_centavos: true,
    limite_total_centavos: true,
    limite_adicional_centavos: true,
    valor_alvo_centavos: true,
    valor_atual_centavos: true,
    dia_fechamento: true,
    parcelas_total: true,
    valor_pago_centavos: true,
    valor_original_centavos: true,
    valor_atualizado_centavos: true,
    valor_negociado_centavos: true,
    quantidade_parcelas: true,
    valor_contratado_centavos: true,
    taxa_juros_mensal_bps: true,
    numero_parcelas: true,
    valor_parcela_centavos: true,
    saldo_devedor_centavos: true,
    numero_parcela: true,
    total_parcelas: true,
    quantidade_milesimos: true,
    preco_medio_centavos: true,
    valor_aplicado_centavos: true,
    valor_mercado_informado_centavos: true,
    rendimentos_acumulados_centavos: true,
    saldo_inicial_realizado_centavos: true,
    receitas_confirmadas_centavos: true,
    receitas_previstas_centavos: true,
    despesas_confirmadas_centavos: true,
    despesas_previstas_centavos: true,
    parcelas_compromissos_centavos: true,
    saldo_final_projetado_centavos: true,
    tentativas: true
  };

  var BOOLEAN_COLUMNS = {
    notificacoes_email_ativas: true,
    notificacoes_ativas: true,
    repercutir_fluxo_caixa: true,
    desconto_em_folha: true,
    desconto_em_folha_ja_deduzido_salario: true,
    codigo_usado: true,
    status_leitura: true,
    email_ativo: true,
    popup_ativo: true,
    central_ativo: true,
    investimentos_ativo: true,
    oraculo_ativo: true,
    ativo: true
  };

  var cachedSpreadsheet = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function todayIso(timeZone) {
    var tz = timeZone || 'America/Sao_Paulo';
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    }
    var d = new Date();
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function generateId(prefix) {
    var p = prefix || 'rec';
    var uuid = '';
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      uuid = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    } else {
      uuid = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    }
    return p + '_' + uuid;
  }

  function getSpreadsheet() {
    if (cachedSpreadsheet) {
      return cachedSpreadsheet;
    }
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var spreadsheetId = props ? props.getProperty('SPREADSHEET_ID') : null;
    if (spreadsheetId) {
      cachedSpreadsheet = SpreadsheetApp.openById(spreadsheetId);
      return cachedSpreadsheet;
    }
    try {
      cachedSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      cachedSpreadsheet = null;
    }
    if (cachedSpreadsheet) {
      return cachedSpreadsheet;
    }
    if (DEFAULT_SPREADSHEET_ID) {
      cachedSpreadsheet = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
      if (props && cachedSpreadsheet) {
        props.setProperty('SPREADSHEET_ID', DEFAULT_SPREADSHEET_ID);
      }
      return cachedSpreadsheet;
    }
    throw new Error('Planilha não configurada. Defina a propriedade SPREADSHEET_ID nas Propriedades do Script ou vincule o script a uma planilha Google Sheets.');
  }

  function resetSpreadsheetCache() {
    cachedSpreadsheet = null;
  }

  var isLockedLocally = false;

  function withLock(callback, timeoutMs) {
    if (isLockedLocally) {
      return callback();
    }
    var wait = timeoutMs || 10000;
    var lock = null;
    var acquired = false;
    try {
      if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
        lock = LockService.getScriptLock();
        acquired = lock.tryLock(wait);
      }
    } catch (e) {
      acquired = false;
    }

    if (!acquired && lock !== null) {
      // Fallback resiliente usando UserLock se ScriptLock estiver sob contenção
      try {
        if (LockService.getUserLock) {
          var userLock = LockService.getUserLock();
          if (userLock.tryLock(3000)) {
            lock = userLock;
            acquired = true;
          }
        }
      } catch (e2) {}
    }

    if (!acquired && lock !== null) {
      throw new Error('Sistema temporariamente ocupado processando outra transação financeira. Tente novamente em instantes.');
    }

    isLockedLocally = true;
    try {
      return callback();
    } finally {
      isLockedLocally = false;
      if (lock) {
        try {
          lock.releaseLock();
        } catch (errRelease) {}
      }
    }
  }

  /**
   * Garante que todas as 21 abas existem e possuem os cabeçalhos esperados.
   * Executa migração aditiva sem apagar dados existentes.
   */
  var schemaVerifiedInMemory = false;

  function ensureSchema(force) {
    if (!force) {
      if (schemaVerifiedInMemory) {
        return { version: SCHEMA_VERSION, createdSheets: [], migratedColumns: [], cached: true };
      }
      try {
        var propsCheck = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
        if (propsCheck && propsCheck.getProperty('SCHEMA_VERIFIED_VERSION') === SCHEMA_VERSION) {
          var ssCheck = getSpreadsheet();
          var allExist = true;
          var namesCheck = Object.keys(SHEETS_SCHEMA);
          for (var n = 0; n < namesCheck.length; n++) {
            if (!ssCheck.getSheetByName(namesCheck[n])) { allExist = false; break; }
          }
          if (allExist) {
            schemaVerifiedInMemory = true;
            return { version: SCHEMA_VERSION, createdSheets: [], migratedColumns: [], cached: true };
          }
        }
      } catch (eCheck) {}
    }
    var result = withLock(function () {
      var ss = getSpreadsheet();
      var sheetNames = Object.keys(SHEETS_SCHEMA);
      var report = {
        version: SCHEMA_VERSION,
        createdSheets: [],
        migratedColumns: []
      };

      for (var i = 0; i < sheetNames.length; i++) {
        var name = sheetNames[i];
        var expectedHeaders = SHEETS_SCHEMA[name];
        var sheet = ss.getSheetByName(name);
        if (!sheet) {
          sheet = ss.insertSheet(name);
          sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
          sheet.setFrozenRows(1);
          report.createdSheets.push(name);
        } else {
          var lastCol = sheet.getLastColumn();
          if (lastCol === 0) {
            sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
            sheet.setFrozenRows(1);
          } else {
            var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
            for (var c = 0; c < expectedHeaders.length; c++) {
              var colName = expectedHeaders[c];
              if (currentHeaders.indexOf(colName) === -1) {
                currentHeaders.push(colName);
                sheet.getRange(1, currentHeaders.length, 1, 1).setValues([[colName]]);
                report.migratedColumns.push(name + '.' + colName);
              }
            }
          }
        }
      }
      return report;
    });
    schemaVerifiedInMemory = true;
    try {
      if (typeof PropertiesService !== 'undefined') {
        PropertiesService.getScriptProperties().setProperty('SCHEMA_VERIFIED_VERSION', SCHEMA_VERSION);
      }
    } catch (eSet) {}
    return result;
  }

  function getSheetOrThrow(sheetName) {
    if (!SHEETS_SCHEMA[sheetName]) {
      throw new Error('Aba inválida ou não definida no esquema: ' + sheetName);
    }
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      ensureSchema();
      sheet = ss.getSheetByName(sheetName);
    }
    return sheet;
  }

  function coerceValueFromSheet(colName, rawVal) {
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      if (BOOLEAN_COLUMNS[colName]) return false;
      if (INTEGER_COLUMNS[colName]) return 0;
      return '';
    }
    if (BOOLEAN_COLUMNS[colName]) {
      if (typeof rawVal === 'boolean') return rawVal;
      var s = String(rawVal).toLowerCase().trim();
      return s === 'true' || s === '1' || s === 'sim';
    }
    if (INTEGER_COLUMNS[colName]) {
      var n = Number(rawVal);
      return isNaN(n) ? 0 : Math.round(n);
    }
    if (rawVal instanceof Date) {
      return rawVal.toISOString();
    }
    var strVal = String(rawVal);
    if (typeof DataSanitizationService !== 'undefined' && DataSanitizationService.unescapeFormula) {
      return DataSanitizationService.unescapeFormula(strVal);
    }
    return strVal;
  }

  function serializeValueForSheet(colName, val) {
    if (val === undefined || val === null) {
      return '';
    }
    if (BOOLEAN_COLUMNS[colName]) {
      return Boolean(val);
    }
    if (INTEGER_COLUMNS[colName]) {
      var n = Number(val);
      return isNaN(n) ? 0 : Math.round(n);
    }
    // Proteção centralizada contra injeção de fórmulas preservando números legítimos
    if (typeof DataSanitizationService !== 'undefined' && DataSanitizationService.escapeFormula) {
      return DataSanitizationService.escapeFormula(val);
    }
    return String(val);
  }

  function readAllRecords(sheetName) {
    var sheet = getSheetOrThrow(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) {
      return [];
    }
    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = data[0];
    var results = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row[0] && row.join('').trim() === '') {
        continue;
      }
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        var col = headers[c];
        obj[col] = coerceValueFromSheet(col, row[c]);
      }
      obj._rowIndex = r + 1;
      results.push(obj);
    }
    return results;
  }

  function findAll(sheetName, filterFn) {
    var all = readAllRecords(sheetName);
    if (!filterFn) return all;
    return all.filter(filterFn);
  }

  function findByGrupo(sheetName, grupoId, filterFn) {
    if (!grupoId) {
      throw new Error('grupo_id é obrigatório para consulta isolada em ' + sheetName);
    }
    return findAll(sheetName, function (item) {
      if (item.grupo_id !== grupoId) return false;
      return filterFn ? filterFn(item) : true;
    });
  }

  function findById(sheetName, id, grupoId) {
    if (!id) return null;
    var all = readAllRecords(sheetName);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        if (grupoId && all[i].grupo_id && all[i].grupo_id !== grupoId) {
          return null;
        }
        return all[i];
      }
    }
    return null;
  }

  function findOne(sheetName, predicateFn) {
    var all = readAllRecords(sheetName);
    for (var i = 0; i < all.length; i++) {
      if (predicateFn(all[i])) {
        return all[i];
      }
    }
    return null;
  }

  function getActualSheetHeaders(sheet, sheetName) {
    var expectedHeaders = SHEETS_SCHEMA[sheetName];
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
      sheet.setFrozenRows(1);
      return expectedHeaders.slice();
    }
    var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var needsAppend = false;
    for (var i = 0; i < expectedHeaders.length; i++) {
      var h = expectedHeaders[i];
      if (currentHeaders.indexOf(h) === -1) {
        currentHeaders.push(h);
        needsAppend = true;
      }
    }
    if (needsAppend) {
      sheet.getRange(1, 1, 1, currentHeaders.length).setValues([currentHeaders]);
    }
    return currentHeaders;
  }

  var _memSyncVersion = Date.now();

  function bumpSyncVersion(grupoId) {
    var v = Date.now();
    _memSyncVersion = v;
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        var cache = CacheService.getScriptCache();
        if (cache) {
          cache.put('FINPESS_SYNC_VERSION_GLOBAL', String(v), 21600);
          if (grupoId) {
            cache.put('FINPESS_SYNC_VERSION_' + String(grupoId).trim(), String(v), 21600);
          }
        }
      }
    } catch (e) {}
    try {
      if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
        var props = PropertiesService.getScriptProperties();
        if (props) {
          props.setProperty('FINPESS_SYNC_VERSION_GLOBAL', String(v));
          if (grupoId) {
            props.setProperty('FINPESS_SYNC_VERSION_' + String(grupoId).trim(), String(v));
          }
        }
      }
    } catch (e2) {}
    return v;
  }

  function getSyncVersion(grupoId) {
    var gId = grupoId ? String(grupoId).trim() : '';
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        var cache = CacheService.getScriptCache();
        if (cache) {
          var val = gId ? cache.get('FINPESS_SYNC_VERSION_' + gId) : null;
          if (!val) val = cache.get('FINPESS_SYNC_VERSION_GLOBAL');
          if (val) return parseInt(val, 10);
        }
      }
    } catch (e) {}
    try {
      if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
        var props = PropertiesService.getScriptProperties();
        if (props) {
          var pVal = gId ? props.getProperty('FINPESS_SYNC_VERSION_' + gId) : null;
          if (!pVal) pVal = props.getProperty('FINPESS_SYNC_VERSION_GLOBAL');
          if (pVal) return parseInt(pVal, 10);
        }
      }
    } catch (e2) {}
    return _memSyncVersion || Date.now();
  }

  var _onlinePresences = {};

  var PRESENCE_PALETTE = [
    '#2563eb', // Azul
    '#7c3aed', // Roxo
    '#059669', // Esmeralda / Verde
    '#d97706', // Âmbar / Laranja
    '#db2777', // Rosa / Pink
    '#0891b2', // Ciano
    '#4f46e5', // Índigo
    '#ea580c'  // Coral
  ];

  function getInitials(name) {
    if (!name) return '??';
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getDeterministicColor(str) {
    if (!str) return PRESENCE_PALETTE[0];
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var index = Math.abs(hash) % PRESENCE_PALETTE.length;
    return PRESENCE_PALETTE[index];
  }

  var MODULE_LABELS = {
    'dashboard': 'Dashboard Principal',
    'launches': 'Lançamentos',
    'recurring': 'Contas Recorrentes',
    'banks': 'Contas e Cartões',
    'debts': 'Gestão de Dívidas',
    'loans': 'Empréstimos',
    'investments': 'Investimentos',
    'calendar': 'Calendário Financeiro',
    'planning': 'Planejamento e Projeções',
    'reports': 'Relatórios Gerenciais',
    'oraculo': 'Oráculo IA',
    'oracle': 'Oráculo IA',
    'settings': 'Configurações'
  };

  function recordUserPresence(user, currentModule) {
    if (!user || !user.id || !user.grupo_id) return [];
    var now = Date.now();
    var gId = String(user.grupo_id).trim();

    var groupPresences = _onlinePresences[gId];
    if (!groupPresences) {
      groupPresences = {};
      try {
        if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
          var cache = CacheService.getScriptCache();
          var cachedJson = cache.get('FINPESS_PRESENCE_' + gId);
          if (cachedJson) {
            groupPresences = JSON.parse(cachedJson);
          }
        }
      } catch (eCache) {}
    }

    var modKey = currentModule ? String(currentModule).toLowerCase().trim() : 'dashboard';
    groupPresences[user.id] = {
      id: user.id,
      nome: user.nome || user.email.split('@')[0],
      email: user.email,
      papel: user.papel || 'MEMBRO',
      foto_url: user.foto_url || '',
      iniciais: getInitials(user.nome || user.email),
      cor: getDeterministicColor(user.email || user.id),
      modulo: modKey,
      modulo_label: MODULE_LABELS[modKey] || 'Navegando no Sistema',
      lastSeen: now
    };

    var activeOtherUsers = [];
    var cleanedGroupPresences = {};
    for (var uid in groupPresences) {
      var p = groupPresences[uid];
      if (now - p.lastSeen <= 45000) {
        cleanedGroupPresences[uid] = p;
        if (uid !== user.id) {
          activeOtherUsers.push(p);
        }
      }
    }

    _onlinePresences[gId] = cleanedGroupPresences;

    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        var c = CacheService.getScriptCache();
        if (c) {
          c.put('FINPESS_PRESENCE_' + gId, JSON.stringify(cleanedGroupPresences), 60);
        }
      }
    } catch (eSave) {}

    return activeOtherUsers;
  }

  function insert(sheetName, record) {
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var headers = getActualSheetHeaders(sheet, sheetName);
      var copy = {};
      for (var k in record) {
        if (Object.prototype.hasOwnProperty.call(record, k)) {
          copy[k] = record[k];
        }
      }
      if (!copy.id) {
        copy.id = generateId(sheetName.substring(0, 3).toLowerCase());
      }
      var now = nowIso();
      if (headers.indexOf('criado_em') !== -1 && !copy.criado_em) {
        copy.criado_em = now;
      }
      if (headers.indexOf('atualizado_em') !== -1 && !copy.atualizado_em) {
        copy.atualizado_em = now;
      }

      var rowValues = [];
      for (var i = 0; i < headers.length; i++) {
        var col = headers[i];
        var serialized = serializeValueForSheet(col, copy[col]);
        copy[col] = coerceValueFromSheet(col, serialized);
        rowValues.push(serialized);
      }

      var targetRow = sheet.getLastRow() + 1;
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      copy._rowIndex = targetRow;
      if (sheetName !== 'AUDITORIA' && sheetName !== 'NOTIFICACOES_FILA') {
        bumpSyncVersion(copy.grupo_id);
      }
      return copy;
    });
  }

  function insertBatch(sheetName, records) {
    if (!records || records.length === 0) return [];
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var headers = getActualSheetHeaders(sheet, sheetName);
      var now = nowIso();
      var rowsToInsert = [];
      var insertedObjects = [];

      for (var r = 0; r < records.length; r++) {
        var copy = {};
        var src = records[r];
        for (var k in src) {
          if (Object.prototype.hasOwnProperty.call(src, k)) {
            copy[k] = src[k];
          }
        }
        if (!copy.id) {
          copy.id = generateId(sheetName.substring(0, 3).toLowerCase());
        }
        if (headers.indexOf('criado_em') !== -1 && !copy.criado_em) {
          copy.criado_em = now;
        }
        if (headers.indexOf('atualizado_em') !== -1 && !copy.atualizado_em) {
          copy.atualizado_em = now;
        }
        var rowValues = [];
        for (var c = 0; c < headers.length; c++) {
          var col = headers[c];
          var serialized = serializeValueForSheet(col, copy[col]);
          copy[col] = coerceValueFromSheet(col, serialized);
          rowValues.push(serialized);
        }
        rowsToInsert.push(rowValues);
        insertedObjects.push(copy);
      }

      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToInsert.length, headers.length).setValues(rowsToInsert);
      if (sheetName !== 'AUDITORIA' && sheetName !== 'NOTIFICACOES_FILA') {
        var gId = insertedObjects.length > 0 ? insertedObjects[0].grupo_id : '';
        bumpSyncVersion(gId);
      }
      return insertedObjects;
    });
  }

  function updateBatch(sheetName, updatesById, grupoId) {
    if (!updatesById || Object.keys(updatesById).length === 0) return [];
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var headers = getActualSheetHeaders(sheet, sheetName);
      var idColIdx = headers.indexOf('id');
      var grupoColIdx = headers.indexOf('grupo_id');
      var dataRange = sheet.getDataRange();
      var values = dataRange.getValues();
      if (values.length <= 1) return [];

      var now = nowIso();
      var atualizadoColIdx = headers.indexOf('atualizado_em');
      var updatedList = [];
      var modified = false;

      for (var r = 1; r < values.length; r++) {
        var row = values[r];
        var rowId = String(row[idColIdx] || '');
        var patch = updatesById[rowId];
        if (!patch) continue;

        if (grupoId && grupoColIdx !== -1 && String(row[grupoColIdx] || '') !== String(grupoId)) {
          continue;
        }

        for (var c = 0; c < headers.length; c++) {
          var colName = headers[c];
          if (patch[colName] !== undefined && colName !== 'id' && colName !== 'grupo_id' && colName !== 'criado_em') {
            row[c] = serializeValueForSheet(colName, patch[colName]);
          }
        }
        if (atualizadoColIdx !== -1) {
          row[atualizadoColIdx] = now;
        }
        modified = true;
        updatedList.push(rowId);
      }

      if (modified) {
        sheet.getRange(1, 1, values.length, headers.length).setValues(values);
        if (sheetName !== 'AUDITORIA' && sheetName !== 'NOTIFICACOES_FILA') {
          bumpSyncVersion(grupoId);
        }
      }
      return updatedList;
    });
  }

  function updateById(sheetName, id, patch, grupoId) {
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var headers = getActualSheetHeaders(sheet, sheetName);
      var existing = findById(sheetName, id, grupoId);
      if (!existing) {
        throw new Error('Registro não encontrado ou acesso não autorizado em ' + sheetName + ': ' + id);
      }
      var updated = {};
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i];
        updated[h] = existing[h];
      }
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k) && k !== 'id' && k !== 'grupo_id' && k !== 'criado_em') {
          updated[k] = patch[k];
        }
      }
      if (headers.indexOf('atualizado_em') !== -1) {
        updated.atualizado_em = nowIso();
      }
      var rowValues = [];
      for (var c = 0; c < headers.length; c++) {
        var col = headers[c];
        var serialized = serializeValueForSheet(col, updated[col]);
        updated[col] = coerceValueFromSheet(col, serialized);
        rowValues.push(serialized);
      }
      sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([rowValues]);
      updated._rowIndex = existing._rowIndex;
      if (sheetName !== 'AUDITORIA' && sheetName !== 'NOTIFICACOES_FILA') {
        bumpSyncVersion(updated.grupo_id || grupoId);
      }
      return updated;
    });
  }

  function deleteById(sheetName, id, grupoId) {
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var existing = findById(sheetName, id, grupoId);
      if (!existing) {
        throw new Error('Registro não encontrado para exclusão em ' + sheetName + ': ' + id);
      }
      sheet.deleteRow(existing._rowIndex);
      if (sheetName !== 'AUDITORIA' && sheetName !== 'NOTIFICACOES_FILA') {
        bumpSyncVersion(existing.grupo_id || grupoId);
      }
      return { ok: true, id: id };
    });
  }

  /**
   * Exporta um backup estruturado JSON de todas as abas pertencentes ao grupo financeiro,
   * preservando IDs e relacionamentos.
   */
  function exportBackup(grupoId, usuarioId) {
    if (!grupoId) {
      throw new Error('grupo_id é obrigatório para exportar backup.');
    }
    var sheetNames = Object.keys(SHEETS_SCHEMA);
    var tables = {};
    for (var i = 0; i < sheetNames.length; i++) {
      var name = sheetNames[i];
      if (name === 'GRUPOS_FINANCEIROS') {
        tables[name] = findAll(name, function (g) { return g.id === grupoId; });
      } else {
        tables[name] = findByGrupo(name, grupoId);
      }
      // Remover metadado interno _rowIndex da exportação e redigir credenciais sensíveis
      tables[name] = tables[name].map(function (row) {
        var clean = {};
        var cols = SHEETS_SCHEMA[name];
        for (var c = 0; c < cols.length; c++) {
          var colName = cols[c];
          if (name === 'USUARIOS') {
            if (colName === 'token_sessao' || colName === 'token_sessao_expira_em' || colName === 'token_sessao_criado_em' || colName === 'token_sessao_ultima_atividade') {
              clean[colName] = '';
            } else if (colName === 'hash_senha' || colName === 'salt') {
              clean[colName] = '[PROTECTED_CREDENTIAL]';
            } else {
              clean[colName] = row[colName];
            }
          } else {
            clean[colName] = row[colName];
          }
        }
        return clean;
      });
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowIso(),
      exportedBy: usuarioId || 'SISTEMA',
      grupoId: grupoId,
      tables: tables
    };
  }

  /**
   * Restaura registros de um backup JSON para o grupo financeiro de forma idempotente,
   * preservando IDs originais e integridade de relacionamentos.
   */
  function restoreBackup(backupPayload, grupoId) {
    if (!backupPayload || typeof backupPayload !== 'object' || !backupPayload.tables || !grupoId) {
      throw new Error('Payload de backup inválido.');
    }
    if (!backupPayload.schemaVersion) {
      throw new Error('Versão de esquema do backup ausente ou incompatível.');
    }
    if (backupPayload.grupoId && backupPayload.grupoId !== grupoId) {
      throw new Error('Não é permitido restaurar backup de outro grupo financeiro.');
    }
    return withLock(function () {
      ensureSchema();
      var summary = {
        inserted: 0,
        updated: 0,
        sheetsProcessed: []
      };
      var sheetNames = Object.keys(SHEETS_SCHEMA);
      for (var i = 0; i < sheetNames.length; i++) {
        var name = sheetNames[i];
        var incomingRows = backupPayload.tables[name];
        if (!incomingRows || !Array.isArray(incomingRows) || incomingRows.length === 0) {
          continue;
        }
        summary.sheetsProcessed.push(name);

        // Otimização em lote: carrega registros existentes uma única vez por aba
        var existingRows = findAll(name);
        var existingMap = {};
        for (var ex = 0; ex < existingRows.length; ex++) {
          existingMap[existingRows[ex].id] = existingRows[ex];
        }

        var newRowsToInsert = [];
        for (var r = 0; r < incomingRows.length; r++) {
          var rec = incomingRows[r];
          if (!rec.id) continue;
          if (name !== 'GRUPOS_FINANCEIROS') {
            rec.grupo_id = grupoId;
          }
          var existing = existingMap[rec.id];
          if (existing) {
            // Em USUARIOS, preserva credenciais locais se o backup contiver marcador protegido
            if (name === 'USUARIOS') {
              if (rec.hash_senha === '[PROTECTED_CREDENTIAL]' || !rec.hash_senha) {
                rec.hash_senha = existing.hash_senha;
                rec.salt = existing.salt;
              }
              if (!rec.token_sessao) {
                rec.token_sessao = existing.token_sessao;
                rec.token_sessao_expira_em = existing.token_sessao_expira_em;
                rec.token_sessao_criado_em = existing.token_sessao_criado_em;
                rec.token_sessao_ultima_atividade = existing.token_sessao_ultima_atividade;
              }
            }
            updateById(name, rec.id, rec, name === 'GRUPOS_FINANCEIROS' ? null : grupoId);
            summary.updated++;
          } else {
            if (name === 'USUARIOS' && rec.hash_senha === '[PROTECTED_CREDENTIAL]') {
              rec.hash_senha = '';
              rec.salt = '';
            }
            newRowsToInsert.push(rec);
            summary.inserted++;
          }
        }
        if (newRowsToInsert.length > 0) {
          insertBatch(name, newRowsToInsert);
        }
      }
      return summary;
    });
  }

  /**
   * Limpa todas as linhas de dados de uma aba específica, preservando integralmente a linha 1 (cabeçalhos).
   */
  function clearSheetData(sheetName) {
    return withLock(function () {
      var sheet = getSheetOrThrow(sheetName);
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        if (typeof sheet.deleteRows === 'function') {
          sheet.deleteRows(2, lastRow - 1);
        } else {
          for (var r = lastRow; r >= 2; r--) {
            sheet.deleteRow(r);
          }
        }
      }
      return { ok: true, sheetName: sheetName, clearedRows: Math.max(0, lastRow - 1) };
    });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    SHEETS_SCHEMA: SHEETS_SCHEMA,
    nowIso: nowIso,
    todayIso: todayIso,
    generateId: generateId,
    resetSpreadsheetCache: resetSpreadsheetCache,
    withLock: withLock,
    ensureSchema: ensureSchema,
    findAll: findAll,
    findByGrupo: findByGrupo,
    findById: findById,
    findOne: findOne,
    insert: insert,
    insertBatch: insertBatch,
    updateById: updateById,
    updateBatch: updateBatch,
    deleteById: deleteById,
    clearSheetData: clearSheetData,
    bumpSyncVersion: bumpSyncVersion,
    getSyncVersion: getSyncVersion,
    recordUserPresence: recordUserPresence,
    exportBackup: exportBackup,
    restoreBackup: restoreBackup
  };
})();

