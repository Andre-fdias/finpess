/**
 * @file SecurityLogger.gs
 * @description Infraestrutura central de logs estruturados, auditoria, observabilidade
 * e rastreabilidade para o Finanças Inteligentes.
 * Classifica eventos por tipo e severidade, correlaciona operações e protege dados via DataSanitizationService.
 */

var SecurityLogger = (function () {
  var VALID_EVENT_TYPES = {
    SUCCESS: true,
    ERROR: true,
    WARNING: true,
    INFO: true,
    SECURITY: true,
    AUDIT: true,
    ANOMALY: true,
    SYSTEM: true
  };

  var VALID_SEVERITIES = {
    DEBUG: 1,
    LOW: 2,
    MEDIUM: 3,
    HIGH: 4,
    CRITICAL: 5
  };

  function generateCorrelationId(prefix) {
    var p = prefix || 'req';
    var rnd = '';
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      rnd = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    } else {
      rnd = Math.random().toString(36).substring(2, 14);
    }
    return p + '_' + Date.now().toString(36) + '_' + rnd;
  }

  /**
   * Registra um evento estruturado de forma atômica e padronizada.
   */
  function logEvent(eventData) {
    if (!eventData) return null;

    var now = new Date().toISOString();
    var eventType = String(eventData.event_type || 'INFO').toUpperCase();
    if (!VALID_EVENT_TYPES[eventType]) eventType = 'INFO';

    var severity = String(eventData.severity || 'LOW').toUpperCase();
    if (!VALID_SEVERITIES[severity]) severity = 'LOW';

    var eventId = eventData.event_id || ('evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8));
    var correlationId = eventData.correlation_id || generateCorrelationId('corr');
    var executionId = eventData.execution_id || ('exec_' + Date.now().toString(36));

    // Determina se o evento exige ação do usuário
    var requiresAction = Boolean(eventData.requires_user_action);
    if (eventData.requires_user_action === undefined) {
      requiresAction = (severity === 'CRITICAL' || severity === 'HIGH' || eventType === 'ANOMALY' || eventType === 'SECURITY');
    }

    var action = ValidationService ? ValidationService.sanitizeText(eventData.action || 'OPERACAO', 80) : String(eventData.action || 'OPERACAO').substring(0, 80);
    var moduleName = ValidationService ? ValidationService.sanitizeText(eventData.module || 'SISTEMA', 60) : String(eventData.module || 'SISTEMA').substring(0, 60);
    var description = ValidationService ? ValidationService.sanitizeText(eventData.description || '', 500) : String(eventData.description || '').substring(0, 500);
    var recommendedAction = ValidationService ? ValidationService.sanitizeText(eventData.recommended_action || '', 300) : String(eventData.recommended_action || '').substring(0, 300);

    // Sanitização recursiva e profunda de detalhes técnicos
    var rawDetails = eventData.details || {};
    var safeDetails = rawDetails;
    if (typeof DataSanitizationService !== 'undefined' && DataSanitizationService.sanitizeSensitiveData) {
      safeDetails = DataSanitizationService.sanitizeSensitiveData(rawDetails);
    }

    var structuredPayload = {
      event_id: eventId,
      timestamp: now,
      event_type: eventType,
      severity: severity,
      module: moduleName,
      action: action,
      description: description,
      result: String(eventData.result || 'COMPLETED').toUpperCase(),
      actor_id: eventData.actor_id || eventData.usuario_id || 'ANONIMO',
      execution_id: executionId,
      correlation_id: correlationId,
      source: String(eventData.source || 'WEB').toUpperCase(),
      target_type: eventData.target_type || '',
      target_id: eventData.target_id || '',
      error_code: eventData.error_code || '',
      duration_ms: Number(eventData.duration_ms || 0),
      requires_user_action: requiresAction,
      recommended_action: recommendedAction,
      details: safeDetails
    };

    var record = {
      id: eventId,
      grupo_id: eventData.grupo_id || 'GLOBAL',
      usuario_id: structuredPayload.actor_id,
      acao: action,
      entidade: moduleName,
      entidade_id: eventData.target_id || '',
      origem: structuredPayload.source,
      detalhes_resumo: JSON.stringify(structuredPayload),
      criado_em: now
    };

    // Persistência segura sem quebrar o fluxo financeiro em caso de erro transitório
    try {
      SpreadsheetRepository.insert('AUDITORIA', record);
    } catch (err) {
      // Contingência para não travar a transação primária
    }

    // 1. Avaliação de regras pelo motor de anomalias
    try {
      if (typeof AnomalyDetectionService !== 'undefined' && AnomalyDetectionService.evaluateEvent) {
        AnomalyDetectionService.evaluateEvent(structuredPayload);
      }
    } catch (anomErr) {}

    // 2. Encaminhamento para gestão de incidentes se exigir intervenção
    try {
      if (requiresAction && typeof IncidentManagementService !== 'undefined' && IncidentManagementService.handleActionableEvent) {
        IncidentManagementService.handleActionableEvent(structuredPayload);
      }
    } catch (incErr) {}

    return structuredPayload;
  }

  function logSuccess(moduleName, action, description, details, actorId, correlationId) {
    return logEvent({
      event_type: 'SUCCESS',
      severity: 'LOW',
      module: moduleName,
      action: action,
      description: description,
      result: 'SUCCESS',
      actor_id: actorId,
      correlation_id: correlationId,
      requires_user_action: false,
      details: details
    });
  }

  function logError(moduleName, action, description, errorObj, actorId, correlationId, requiresAction, recommendedAction) {
    var errMsg = (errorObj && errorObj.message) ? errorObj.message : String(errorObj || '');
    var errCode = (errorObj && errorObj.code) ? errorObj.code : 'GENERIC_ERROR';
    return logEvent({
      event_type: 'ERROR',
      severity: requiresAction ? 'HIGH' : 'MEDIUM',
      module: moduleName,
      action: action,
      description: description + (errMsg ? ': ' + errMsg : ''),
      error_code: errCode,
      result: 'FAILED',
      actor_id: actorId,
      correlation_id: correlationId,
      requires_user_action: Boolean(requiresAction),
      recommended_action: recommendedAction || 'Verifique as configurações do módulo ou consulte os logs detalhados.',
      details: {
        error_message: errMsg,
        error_code: errCode,
        stack: (errorObj && errorObj.stack) ? String(errorObj.stack).substring(0, 500) : ''
      }
    });
  }

  function logSecurity(moduleName, action, description, severity, details, actorId, requiresAction, recommendedAction) {
    return logEvent({
      event_type: 'SECURITY',
      severity: severity || 'HIGH',
      module: moduleName,
      action: action,
      description: description,
      result: 'TRIGGERED',
      actor_id: actorId,
      requires_user_action: (requiresAction !== undefined) ? requiresAction : true,
      recommended_action: recommendedAction || 'Revise imediatamente as permissões e sessões de acesso do usuário.',
      details: details
    });
  }

  function logAnomaly(moduleName, ruleName, description, severity, details, actorId, recommendedAction) {
    return logEvent({
      event_type: 'ANOMALY',
      severity: severity || 'HIGH',
      module: moduleName,
      action: 'ANOMALY_TRIGGERED',
      description: '[' + ruleName + '] ' + description,
      result: 'DETECTED',
      actor_id: actorId,
      requires_user_action: true,
      recommended_action: recommendedAction || 'Inspecione a atividade financeira ou de integração anômala detectada.',
      details: details
    });
  }

  /**
   * Consulta centralizada de logs com filtros e ordenação decrescente por data.
   */
  function queryLogs(grupoId, options) {
    var opts = options || {};
    var rows = SpreadsheetRepository.findByGrupo('AUDITORIA', grupoId || 'GLOBAL');

    rows.sort(function (a, b) {
      return String(b.criado_em).localeCompare(String(a.criado_em));
    });

    var filtered = [];
    var totalSuccess = 0;
    var totalErrors = 0;
    var totalSecurity = 0;
    var totalAnomalies = 0;
    var totalCritical = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var structured = null;
      try {
        if (r.detalhes_resumo && r.detalhes_resumo.charAt(0) === '{') {
          structured = JSON.parse(r.detalhes_resumo);
        }
      } catch (e) {}

      var eventType = structured ? structured.event_type : 'AUDIT';
      var severity = structured ? structured.severity : 'LOW';
      var mod = structured ? structured.module : r.entidade;
      var actor = structured ? structured.actor_id : r.usuario_id;
      var corrId = structured ? structured.correlation_id : '';

      // Contadores estatísticos
      if (eventType === 'SUCCESS') totalSuccess++;
      if (eventType === 'ERROR') totalErrors++;
      if (eventType === 'SECURITY') totalSecurity++;
      if (eventType === 'ANOMALY') totalAnomalies++;
      if (severity === 'CRITICAL') totalCritical++;

      // Aplicação dos filtros
      if (opts.event_type && opts.event_type !== 'ALL' && eventType !== opts.event_type) continue;
      if (opts.severity && opts.severity !== 'ALL' && severity !== opts.severity) continue;
      if (opts.module && opts.module !== 'ALL' && mod !== opts.module) continue;
      if (opts.actor_id && actor !== opts.actor_id) continue;
      if (opts.correlation_id && corrId.indexOf(opts.correlation_id) === -1) continue;

      filtered.push({
        event_id: r.id,
        timestamp: r.criado_em,
        event_type: eventType,
        severity: severity,
        module: mod,
        action: r.acao,
        description: structured ? structured.description : r.acao,
        result: structured ? structured.result : 'OK',
        actor_id: actor,
        correlation_id: corrId,
        requires_user_action: structured ? Boolean(structured.requires_user_action) : false,
        recommended_action: structured ? (structured.recommended_action || '') : '',
        details: structured ? structured.details : r.detalhes_resumo
      });
    }

    var limit = opts.limit || 100;
    var paged = filtered.slice(0, limit);

    return {
      total: filtered.length,
      limit: limit,
      metrics: {
        total_eventos: rows.length,
        sucessos: totalSuccess,
        erros: totalErrors,
        seguranca: totalSecurity,
        anomalias: totalAnomalies,
        criticos: totalCritical,
        taxa_erros_pct: rows.length > 0 ? Number(((totalErrors / rows.length) * 100).toFixed(1)) : 0
      },
      events: paged
    };
  }

  return {
    generateCorrelationId: generateCorrelationId,
    logEvent: logEvent,
    logSuccess: logSuccess,
    logError: logError,
    logSecurity: logSecurity,
    logAnomaly: logAnomaly,
    queryLogs: queryLogs
  };
})();

