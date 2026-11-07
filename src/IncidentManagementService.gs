/**
 * @file IncidentManagementService.gs
 * @description Gestão do ciclo de vida de incidentes operacionais e de segurança
 * (DETECTADO -> REGISTRADO -> NOTIFICADO -> AGUARDANDO_ACAO -> EM_CORRECAO -> RESOLVIDO).
 * Conecta eventos acionáveis do SecurityLogger e AnomalyDetectionService diretamente
 * à Central Inteligente de Notificações, Pop-ups e Alertas por E-mail.
 */

var IncidentManagementService = (function () {
  var STATUS_LIFECYCLE = {
    DETECTADO: 'DETECTADO',
    REGISTRADO: 'REGISTRADO',
    NOTIFICADO: 'NOTIFICADO',
    AGUARDANDO_ACAO: 'AGUARDANDO_ACAO',
    EM_CORRECAO: 'EM_CORRECAO',
    RESOLVIDO: 'RESOLVIDO',
    IGNORADO: 'IGNORADO'
  };

  var PREFIX_KEY = 'incident_';

  /**
   * Trata um evento do SecurityLogger que requer intervenção do usuário.
   */
  function handleActionableEvent(structuredEvent) {
    if (!structuredEvent) return null;

    var incidentType = structuredEvent.event_type === 'ANOMALY' ? 'ANOMALIA_DETECTADA' : (structuredEvent.action || 'INCIDENTE_SEGURANCA');
    var severity = structuredEvent.severity || 'HIGH';
    var description = structuredEvent.description || 'Incidente requer atenção do usuário.';
    var recAction = structuredEvent.recommended_action || 'Revise as permissões e configurações.';

    return createOrUpdateIncident({
      incident_type: incidentType,
      severity: severity,
      module: structuredEvent.module || 'SISTEMA',
      description: description,
      actor_id: structuredEvent.actor_id || 'SISTEMA',
      grupo_id: structuredEvent.grupo_id || 'GLOBAL',
      recommended_action: recAction,
      requires_user_action: true,
      reference_module: (structuredEvent.module || 'settings').toLowerCase(),
      trigger_event_id: structuredEvent.event_id || ''
    });
  }

  /**
   * Cria ou atualiza um incidente mantendo idempotência de incidentes em aberto.
   */
  function createOrUpdateIncident(payload) {
    if (!payload) return null;

    var now = new Date().toISOString();
    var incidentType = String(payload.incident_type || 'INCIDENTE_GERAL');
    var module = String(payload.module || 'SISTEMA');
    var actorId = String(payload.actor_id || 'SISTEMA');
    var grupoId = payload.grupo_id || 'GLOBAL';
    var severity = String(payload.severity || 'HIGH').toUpperCase();
    var description = String(payload.description || '');
    var recommendedAction = String(payload.recommended_action || 'Verifique o painel administrativo.');

    // Chave de desduplicação para evitar múltiplos incidentes abertos idênticos
    var dedupKey = 'dedup_inc_' + incidentType + '_' + module + '_' + actorId;
    var existingInc = null;

    try {
      var allConfigs = SpreadsheetRepository.findAll('CONFIGURACOES', function (c) {
        return c.chave && c.chave.indexOf(PREFIX_KEY) === 0;
      });

      for (var i = 0; i < allConfigs.length; i++) {
        var rawVal = allConfigs[i].valor;
        if (!rawVal) continue;
        try {
          var parsed = JSON.parse(rawVal);
          if (parsed && parsed.dedup_key === dedupKey && parsed.status !== 'RESOLVIDO' && parsed.status !== 'IGNORADO') {
            existingInc = { configRow: allConfigs[i], data: parsed };
            break;
          }
        } catch (e) {}
      }
    } catch (findErr) {}

    var incidentRecord = null;
    var notifId = '';

    if (existingInc) {
      // Atualiza incidente existente em aberto
      incidentRecord = existingInc.data;
      incidentRecord.ocorrencias = (incidentRecord.ocorrencias || 1) + 1;
      incidentRecord.updated_at = now;
      incidentRecord.description = description;
      incidentRecord.status = STATUS_LIFECYCLE.AGUARDANDO_ACAO;

      try {
        SpreadsheetRepository.updateById('CONFIGURACOES', existingInc.configRow.id, {
          valor: JSON.stringify(incidentRecord),
          atualizado_por: actorId
        });
      } catch (upErr) {}
    } else {
      // Novo incidente
      var incId = 'inc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
      incidentRecord = {
        id: incId,
        dedup_key: dedupKey,
        incident_type: incidentType,
        severity: severity,
        module: module,
        description: description,
        actor_id: actorId,
        grupo_id: grupoId,
        status: STATUS_LIFECYCLE.DETECTADO,
        ocorrencias: 1,
        created_at: now,
        updated_at: now,
        resolved_at: '',
        resolved_by: '',
        resolution_notes: '',
        recommended_action: recommendedAction,
        reference_module: payload.reference_module || 'settings',
        trigger_event_id: payload.trigger_event_id || '',
        notification_id: ''
      };

      // Conexão imediata com NotificationService para acionar Sino, Pop-up e E-mail
      try {
        if (typeof NotificationService !== 'undefined' && NotificationService.enqueueNotification) {
          var sysUser = {
            id: actorId !== 'SISTEMA' && actorId !== 'ANONIMO' ? actorId : 'admin',
            email: actorId.indexOf('@') > 0 ? actorId : 'admin@finpess.local',
            grupo_id: grupoId
          };

          var notifPrio = (severity === 'CRITICAL') ? 'CRITICA' : (severity === 'HIGH' ? 'ALTA' : 'MEDIA');
          var notif = NotificationService.enqueueNotification(sysUser, {
            tipo_notificacao: 'ALERTA_SEGURANCA',
            titulo: 'Incidente Detectado: ' + incidentType,
            mensagem: description + (recommendedAction ? '\nRecomendação: ' + recommendedAction : ''),
            prioridade: notifPrio,
            categoria: 'SISTEMA',
            canais: (severity === 'CRITICAL' || severity === 'HIGH') ? 'CENTRAL,POPUP,EMAIL' : 'CENTRAL,POPUP',
            referencia_modulo: 'settings',
            referencia_id: incId,
            idempotency_key: 'notif_inc_' + incId
          });

          if (notif && notif.id) {
            notifId = notif.id;
            incidentRecord.notification_id = notifId;
          }
        }
      } catch (notifErr) {}

      // Transição para AGUARDANDO_ACAO
      incidentRecord.status = STATUS_LIFECYCLE.AGUARDANDO_ACAO;

      try {
        SpreadsheetRepository.insert('CONFIGURACOES', {
          id: SpreadsheetRepository.generateId('cfg'),
          grupo_id: grupoId,
          chave: PREFIX_KEY + incId,
          valor: JSON.stringify(incidentRecord),
          descricao: 'Incidente de segurança: ' + incidentType,
          atualizado_por: actorId
        });
      } catch (insErr) {}
    }

    return incidentRecord;
  }

  /**
   * Resolve um incidente, atualizando seu ciclo de vida e marcando a notificação associada como lida/resolvida.
   */
  function resolveIncident(user, incidentId, notes) {
    if (!user) throw new Error('Usuário autenticado obrigatório.');
    if (!incidentId) throw new Error('ID do incidente obrigatório.');

    var now = new Date().toISOString();
    var key = PREFIX_KEY + incidentId;
    var row = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.chave === key;
    });

    if (!row) {
      throw new Error('Incidente não encontrado: ' + incidentId);
    }

    var record = {};
    try {
      record = JSON.parse(row.valor);
    } catch (e) {
      record = { id: incidentId };
    }

    record.status = STATUS_LIFECYCLE.RESOLVIDO;
    record.resolved_at = now;
    record.resolved_by = user.email || user.id;
    record.resolution_notes = notes || 'Incidente analisado e marcado como resolvido pelo gestor.';
    record.updated_at = now;

    SpreadsheetRepository.updateById('CONFIGURACOES', row.id, {
      valor: JSON.stringify(record),
      atualizado_por: user.id
    }, row.grupo_id);

    // Se houver notificação vinculada, marca como lida
    if (record.notification_id) {
      try {
        if (typeof NotificationService !== 'undefined' && NotificationService.markAsRead) {
          NotificationService.markAsRead(user, record.notification_id);
        }
      } catch (e) {}
    }

    // Registra log do encerramento do incidente
    try {
      if (typeof SecurityLogger !== 'undefined' && SecurityLogger.logSuccess) {
        SecurityLogger.logSuccess(
          'INCIDENTES',
          'RESOLVE_INCIDENT',
          'Incidente ' + incidentId + ' resolvido com sucesso por ' + (user.email || user.id),
          { incident_id: incidentId, notes: notes },
          user.id
        );
      }
    } catch (logErr) {}

    return record;
  }

  /**
   * Lista incidentes com suporte a filtros de status e severidade.
   */
  function listIncidents(user, options) {
    if (!user) throw new Error('Usuário autenticado obrigatório.');

    var opts = options || {};
    var statusFilter = opts.status || 'ATIVOS'; // ATIVOS, RESOLVIDOS, TODOS
    var severityFilter = opts.severity || '';

    var rows = SpreadsheetRepository.findAll('CONFIGURACOES', function (c) {
      return c.chave && c.chave.indexOf(PREFIX_KEY) === 0;
    });

    var incidents = [];
    for (var i = 0; i < rows.length; i++) {
      try {
        var data = JSON.parse(rows[i].valor);
        if (!data || !data.id) continue;

        if (statusFilter === 'ATIVOS' && (data.status === 'RESOLVIDO' || data.status === 'IGNORADO')) {
          continue;
        }
        if (statusFilter === 'RESOLVIDOS' && data.status !== 'RESOLVIDO') {
          continue;
        }
        if (severityFilter && data.severity !== severityFilter) {
          continue;
        }

        incidents.push(data);
      } catch (e) {}
    }

    // Ordenação decrescente por data de atualização/criação
    incidents.sort(function (a, b) {
      return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '');
    });

    return incidents;
  }

  return {
    STATUS_LIFECYCLE: STATUS_LIFECYCLE,
    handleActionableEvent: handleActionableEvent,
    createOrUpdateIncident: createOrUpdateIncident,
    resolveIncident: resolveIncident,
    listIncidents: listIncidents
  };
})();
