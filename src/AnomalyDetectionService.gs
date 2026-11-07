/**
 * @file AnomalyDetectionService.gs
 * @description Motor de detecção automática de anomalias baseado em regras determinísticas:
 * picos de tentativas de login, operações financeiras de valor atípico, surtos de exclusão
 * e falhas recorrentes de integração externa.
 */

var AnomalyDetectionService = (function () {
  var ANOMALY_THRESHOLDS = {
    HIGH_VALUE_TRANSACTION_CENTS: 5000000, // R$ 50.000,00
    CONSECUTIVE_LOGIN_FAILURES: 3,
    RAPID_DELETIONS_COUNT: 3,
    RAPID_DELETIONS_WINDOW_MS: 300000, // 5 minutos
    REPEATED_INTEGRATION_FAILURES: 3
  };

  /**
   * Avalia um evento estruturado recém-gerado contra as regras determinísticas.
   */
  function evaluateEvent(event) {
    if (!event) return;

    var action = event.action || '';
    var module = event.module || '';

    // 1. Regra: Falhas repetidas de autenticação
    if (action === 'LOGIN_FALHA_SENHA_INCORRETA') {
      var fails = (event.details && event.details.tentativas_consecutivas) ? Number(event.details.tentativas_consecutivas) : 1;
      if (fails >= ANOMALY_THRESHOLDS.CONSECUTIVE_LOGIN_FAILURES) {
        triggerAnomalyAlert(
          'AUTH_BURST_FAILURES',
          'Múltiplas falhas consecutivas de login (' + fails + ' tentativas) detectadas para a conta.',
          'HIGH',
          'AUTH',
          event.actor_id,
          'Verifique se você esqueceu sua senha ou se houve tentativa de acesso não autorizado.',
          event
        );
      }
    }

    // 2. Regra: Lançamento financeiro com valor atípico / muito elevado
    if (module === 'LANCAMENTOS' && (action === 'CREATE_TRANSACTION' || action === 'LANCAMENTO_CRIADO')) {
      var valorCentavos = (event.details && event.details.valor_centavos) ? Number(event.details.valor_centavos) : 0;
      if (valorCentavos >= ANOMALY_THRESHOLDS.HIGH_VALUE_TRANSACTION_CENTS) {
        var valorFormatado = (valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        triggerAnomalyAlert(
          'FIN_HIGH_VALUE_TRANSACTION',
          'Lançamento financeiro de valor atípico registrado: ' + valorFormatado + '.',
          'MEDIUM',
          'LANCAMENTOS',
          event.actor_id,
          'Confirme se o valor de ' + valorFormatado + ' está correto e possui comprovante idôneo.',
          event
        );
      }
    }

    // 3. Regra: Falhas repetidas de integração externa (Telegram / IA / Quotas)
    if (event.event_type === 'ERROR' && (module === 'TELEGRAM' || module === 'GEMINI' || module === 'ORACULO')) {
      var errCode = event.error_code || '';
      if (errCode === 'QUOTA_EXCEEDED' || errCode === 'INVALID_TOKEN' || errCode === 'AUTH_FAILED') {
        triggerAnomalyAlert(
          'INTEGRATION_CRITICAL_ERROR',
          'Falha crítica de comunicação com o serviço ' + module + ' (' + errCode + ').',
          'HIGH',
          module,
          event.actor_id,
          'Acesse Configurações > Integrações e restabeleça a conexão ou a chave de API.',
          event
        );
      }
    }
  }

  function triggerAnomalyAlert(ruleId, description, severity, moduleName, actorId, recommendedAction, triggerEvent) {
    if (typeof IncidentManagementService !== 'undefined' && IncidentManagementService.createOrUpdateIncident) {
      IncidentManagementService.createOrUpdateIncident({
        incident_type: ruleId,
        severity: severity,
        module: moduleName,
        description: description,
        actor_id: actorId,
        grupo_id: triggerEvent ? (triggerEvent.grupo_id || 'GLOBAL') : 'GLOBAL',
        recommended_action: recommendedAction,
        requires_user_action: true,
        reference_module: moduleName.toLowerCase(),
        trigger_event_id: triggerEvent ? triggerEvent.event_id : ''
      });
    }
  }

  return {
    ANOMALY_THRESHOLDS: ANOMALY_THRESHOLDS,
    evaluateEvent: evaluateEvent,
    triggerAnomalyAlert: triggerAnomalyAlert
  };
})();
