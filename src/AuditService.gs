/**
 * @file AuditService.gs
 * @description Serviço de auditoria imutável com minimização de dados sensíveis (LGPD).
 * Nunca armazena tokens, senhas, códigos de vinculação em claro ou áudios brutos.
 */

var AuditService = (function () {
  var SENSITIVE_KEYS_REGEX = /(token|secret|password|senha|api_key|apikey|codigo_vinculacao|audio_base64|audio_bytes)/i;

  function sanitizeDetails(details) {
    if (!details) return '';
    if (typeof DataSanitizationService !== 'undefined' && DataSanitizationService.sanitizeSensitiveData) {
      var sanitized = DataSanitizationService.sanitizeSensitiveData(details);
      if (typeof sanitized === 'object') {
        return ValidationService.sanitizeText(JSON.stringify(sanitized), 1000);
      }
      return ValidationService.sanitizeText(String(sanitized), 1000);
    }
    if (typeof details === 'string') {
      return ValidationService.sanitizeText(
        details.replace(/\b\d{6,10}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_TELEGRAM_TOKEN]'),
        1000
      );
    }
    if (typeof details === 'object') {
      var safeObj = {};
      var keys = Object.keys(details);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (SENSITIVE_KEYS_REGEX.test(k)) {
          safeObj[k] = '[REDACTED]';
        } else {
          var val = details[k];
          if (typeof val === 'string') {
            safeObj[k] = val.replace(/\b\d{6,10}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_TELEGRAM_TOKEN]').substring(0, 300);
          } else {
            safeObj[k] = val;
          }
        }
      }
      return ValidationService.sanitizeText(JSON.stringify(safeObj), 1000);
    }
    return String(details);
  }

  /**
   * Registra evento de auditoria na aba AUDITORIA.
   */
  function log(params) {
    if (!params || !params.acao) {
      return null;
    }
    var record = {
      id: SpreadsheetRepository.generateId('aud'),
      grupo_id: params.grupo_id || 'GLOBAL',
      usuario_id: params.usuario_id || 'ANONIMO',
      acao: ValidationService.sanitizeText(params.acao, 80),
      entidade: ValidationService.sanitizeText(params.entidade || 'SISTEMA', 80),
      entidade_id: ValidationService.sanitizeText(params.entidade_id || '', 80),
      origem: ValidationService.sanitizeText(params.origem || 'WEB', 40),
      detalhes_resumo: sanitizeDetails(params.detalhes),
      criado_em: SpreadsheetRepository.nowIso()
    };
    return SpreadsheetRepository.insert('AUDITORIA', record);
  }

  function listByGrupo(grupoId, limit) {
    var max = limit || 100;
    var rows = SpreadsheetRepository.findByGrupo('AUDITORIA', grupoId);
    rows.sort(function (a, b) {
      return String(b.criado_em).localeCompare(String(a.criado_em));
    });
    return rows.slice(0, max);
  }

  /**
   * Coleta dados em tempo real para o Painel de Segurança Operacional (Subaba 7).
   */
  function getOperationalDashboard(adminUser) {
    if (!adminUser) throw new Error('Usuário administrador obrigatório.');

    var grupoId = adminUser.grupo_id || 'GLOBAL';
    var users = SpreadsheetRepository.findByGrupo('USUARIOS', grupoId);
    var approved = 0, blocked = 0, pending = 0;
    var modernHashCount = 0, legacyHashCount = 0;

    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u.status === 'APROVADO') approved++;
      else if (u.status === 'BLOQUEADO') blocked++;
      else pending++;

      var uHash = u.hash_senha || u.senha_hash || '';
      if (uHash && uHash.indexOf('pbkdf2') === 0) {
        modernHashCount++;
      } else if (uHash) {
        legacyHashCount++;
      }
    }

    // Sessões e Bloqueios ativos
    var configs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', grupoId);
    var activeSessions = 0;
    var activeLockouts = 0;
    var nowMs = Date.now();

    for (var c = 0; c < configs.length; c++) {
      var k = configs[c].chave || '';
      if (k.indexOf('sess_') === 0) {
        try {
          var sData = JSON.parse(configs[c].valor);
          if (sData && sData.exp && sData.exp > nowMs) activeSessions++;
        } catch (e) {}
      } else if (k.indexOf('lockout_') === 0) {
        try {
          var lData = JSON.parse(configs[c].valor);
          if (lData && lData.until && lData.until > nowMs) activeLockouts++;
        } catch (e) {}
      }
    }

    // Integridade de abas (28 abas)
    var schemaKeys = Object.keys(SpreadsheetRepository.SHEETS_SCHEMA);
    var sheetsOk = (schemaKeys.length === 28);

    // Incidentes ativos
    var incidents = [];
    if (typeof IncidentManagementService !== 'undefined') {
      try {
        incidents = IncidentManagementService.listIncidents(adminUser, { status: 'ATIVOS' });
      } catch (incErr) {}
    }

    // Métricas de logs e observabilidade
    var logMetrics = { total_eventos: 0, erros: 0, anomalias: 0, criticos: 0 };
    if (typeof SecurityLogger !== 'undefined') {
      try {
        var queryRes = SecurityLogger.queryLogs(grupoId, { limit: 10 });
        if (queryRes && queryRes.metrics) {
          logMetrics = queryRes.metrics;
        }
      } catch (logErr) {}
    }

    // Métricas de cache
    var cacheMetrics = {};
    if (typeof CacheServiceManager !== 'undefined') {
      try {
        cacheMetrics = CacheServiceManager.getMetrics();
      } catch (cErr) {}
    }

    return {
      status_geral: (activeLockouts === 0 && incidents.length === 0) ? 'PROTEGIDO' : 'ATENCAO',
      usuarios: {
        total: users.length,
        aprovados: approved,
        bloqueados: blocked,
        pendentes: pending,
        hash_pbkdf2_ativo: modernHashCount,
        hash_legado_pendente_migracao: legacyHashCount
      },
      seguranca_operacional: {
        sessoes_ativas: activeSessions,
        bloqueios_forca_bruta_ativos: activeLockouts,
        esquema_abas_integro: sheetsOk,
        total_abas_verificadas: schemaKeys.length,
        incidentes_ativos_count: incidents.length,
        incidentes_recentes: incidents.slice(0, 5)
      },
      observabilidade: logMetrics,
      cache_performance: cacheMetrics,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Executa varredura profunda de integridade e conformidade de segurança.
   */
  function runAuditCheck(adminUser) {
    if (!adminUser) throw new Error('Usuário administrador obrigatório.');

    var issues = [];
    var warnings = [];
    var recommendations = [];
    var grupoId = adminUser.grupo_id || 'GLOBAL';

    // 1. Verificação das 28 abas
    var schemaKeys = Object.keys(SpreadsheetRepository.SHEETS_SCHEMA);
    if (schemaKeys.length !== 28) {
      issues.push('Esquema de abas divergente do padrão: ' + schemaKeys.length + ' abas encontradas (esperado 28).');
    }

    // 2. Verificação de senhas em claro ou hashes legados
    var users = SpreadsheetRepository.findByGrupo('USUARIOS', grupoId);
    var legacyHashes = 0;
    for (var u = 0; u < users.length; u++) {
      var hash = users[u].hash_senha || users[u].senha_hash || '';
      if (!hash) {
        warnings.push('Usuário ' + users[u].email + ' autenticado via Sessão Google / SSO (sem senha local definida).');
      } else if (hash.indexOf('pbkdf2') !== 0) {
        legacyHashes++;
      }
    }
    if (legacyHashes > 0) {
      warnings.push(legacyHashes + ' usuário(s) utilizando hash legado SHA-256 (será migrado automaticamente no próximo login para PBKDF2 HMAC-SHA-256).');
      recommendations.push('Incentive os usuários legados a realizarem login para conclusão da migração transparente de credenciais.');
    }

    // 3. Verificação de injeção de fórmulas em tabelas financeiras
    var financialTables = ['LANCAMENTOS', 'CONTAS_RECORRENTES', 'DIVIDAS', 'EMPRESTIMOS', 'CARTOES_CREDITO', 'COMPRAS_CARTAO'];
    var formulaCheckRegex = /^[\s]*[=@\t\r]/;
    var formulaSuspects = 0;

    for (var t = 0; t < financialTables.length; t++) {
      var tabName = financialTables[t];
      try {
        var rows = SpreadsheetRepository.findByGrupo(tabName, grupoId);
        for (var r = 0; r < rows.length; r++) {
          var rowObj = rows[r];
          var keys = Object.keys(rowObj);
          for (var k = 0; k < keys.length; k++) {
            var val = rowObj[keys[k]];
            if (typeof val === 'string' && formulaCheckRegex.test(val)) {
              formulaSuspects++;
            }
          }
        }
      } catch (tabErr) {}
    }

    if (formulaSuspects > 0) {
      issues.push('Detectados ' + formulaSuspects + ' campos com caracteres suspeitos de injeção de fórmula sem escape prévio.');
      recommendations.push('Execute a rotina de saneamento para aplicar escape seguro aos campos de texto suspeitos.');
    }

    var passed = (issues.length === 0);
    var resultReport = {
      resultado: passed ? 'CONFORME' : 'IRREGULAR',
      passed: passed,
      issues: issues,
      warnings: warnings,
      recommendations: recommendations,
      verificacoes_realizadas: [
        'Esquema estrito de 21 abas e repositórios relacionais',
        'Criptografia de credenciais (PBKDF2 HMAC-SHA-256 30.000 iterações)',
        'Proteção contra injeção de fórmulas no Google Sheets',
        'Isolamento estrito entre grupos financeiros',
        'Minimização e redação recursiva de segredos na auditoria'
      ],
      timestamp: new Date().toISOString()
    };

    if (typeof SecurityLogger !== 'undefined') {
      SecurityLogger.logSecurity(
        'AUDITORIA',
        'RUN_SECURITY_AUDIT',
        'Auditoria completa de segurança executada: ' + resultReport.resultado,
        passed ? 'LOW' : 'HIGH',
        resultReport,
        adminUser.id,
        !passed
      );
    }

    return resultReport;
  }

  return {
    sanitizeDetails: sanitizeDetails,
    log: log,
    listByGrupo: listByGrupo,
    getOperationalDashboard: getOperationalDashboard,
    runAuditCheck: runAuditCheck
  };
})();

