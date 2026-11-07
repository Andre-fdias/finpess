/**
 * @file CalendarService.gs
 * @description Calendário financeiro (mensal, semanal e diário) e sincronização
 * controlada com Google Calendar (AGENDA_SYNC) com prevenção de duplicidade,
 * atualização/cancelamento de eventos vinculados e modo seguro de simulação (dry-run).
 */

var CalendarService = (function () {
  var MAX_SYNC_RETRIES = 3;

  /**
   * Normaliza qualquer formato de data (Date, DD/MM/YYYY, ISO completo) para YYYY-MM-DD
   */
  function normalizeDateIso(d) {
    if (!d) return '';
    if (d instanceof Date) {
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyy-MM-dd');
      }
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      var day = d.getDate();
      return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }
    var s = String(d).trim();
    var brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1];
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.substring(0, 10);
    }
    return s;
  }

  /**
   * Consulta eventos do calendário financeiro interno com suporte a visão MENSAL, SEMANAL, DIARIA e ANUAL
   * e filtros por tipo, categoria, conta e situação.
   */
  function getFinancialCalendar(user, params) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var p = params || {};
    var viewMode = String(p.visao || 'MENSAL').toUpperCase();
    var today = SpreadsheetRepository.todayIso();
    var refDate = p.data_referencia
      ? ValidationService.validateIsoDate(p.data_referencia, 'data_referencia', false)
      : today;

    var startIso = refDate;
    var endIso = refDate;

    if (viewMode === 'DIARIA') {
      startIso = refDate;
      endIso = refDate;
    } else if (viewMode === 'SEMANAL') {
      var parts = refDate.split('-');
      var dt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
      var dow = dt.getUTCDay(); // 0 = Domingo
      var startDt = new Date(dt.getTime() - dow * 86400000);
      var endDt = new Date(startDt.getTime() + 6 * 86400000);
      startIso = startDt.toISOString().substring(0, 10);
      endIso = endDt.toISOString().substring(0, 10);
    } else if (viewMode === 'ANUAL') {
      var y = (p.ano && /^\d{4}$/.test(p.ano)) ? p.ano : refDate.substring(0, 4);
      startIso = y + '-01-01';
      endIso = y + '-12-31';
    } else {
      // MENSAL
      var ym = p.mes && /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : refDate.substring(0, 7);
      var mParts = ym.split('-');
      var lastDay = new Date(Date.UTC(parseInt(mParts[0], 10), parseInt(mParts[1], 10), 0)).getUTCDate();
      startIso = ym + '-01';
      endIso = ym + '-' + (lastDay < 10 ? '0' + lastDay : lastDay);
    }

    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      var d = normalizeDateIso(l.data_lancamento);
      if (!d || d < startIso || d > endIso) return false;
      if (!p.incluirCancelados && l.situacao === 'CANCELADO') return false;
      if (p.tipo && l.tipo !== p.tipo) return false;
      if (p.categoria_id && l.categoria_id !== p.categoria_id) return false;
      if (p.conta_bancaria_id && l.conta_bancaria_id !== p.conta_bancaria_id) return false;
      if (p.situacao && l.situacao !== p.situacao) return false;
      if (p.origem) {
        if (p.origem === 'LANCAMENTOS') {
          if (l.origem && l.origem !== 'MANUAL') return false;
        } else if (l.origem !== p.origem) {
          return false;
        }
      }
      return true;
    });

    var loansList = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id);
    var loansMap = {};
    for (var k = 0; k < loansList.length; k++) {
      loansMap[loansList[k].id] = loansList[k];
    }

    var parcelas = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (par) {
      var d = normalizeDateIso(par.data_vencimento);
      if (!d || d < startIso || d > endIso) return false;
      if (par.situacao === 'CANCELADA') return false;
      if (par.lancamento_id) return false; // Já representado pelo lançamento
      if (p.origem) {
        if (p.origem === 'EMPRESTIMO' && par.origem_tipo !== 'EMPRESTIMO') return false;
        if (p.origem === 'DIVIDA' && par.origem_tipo !== 'DIVIDA') return false;
        if (p.origem !== 'EMPRESTIMO' && p.origem !== 'DIVIDA') return false;
      }
      return true;
    });

    var events = [];
    for (var i = 0; i < launches.length; i++) {
      var l = launches[i];
      var d = normalizeDateIso(l.data_lancamento);
      var isOverdue = l.tipo === 'SAIDA' && (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE') && d < today;
      var isUpcoming = l.tipo === 'SAIDA' && (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE') && d >= today;
      events.push({
        id: l.id,
        origem_tipo: 'LANCAMENTO',
        origem: l.origem || 'MANUAL',
        referencia_parcela_id: l.referencia_parcela_id || '',
        afeta_saldo: true,
        is_consignado: false,
        data: d,
        titulo: l.descricao,
        tipo: l.tipo,
        situacao: l.situacao,
        valor_centavos: l.valor_centavos,
        categoria_id: l.categoria_id,
        conta_bancaria_id: l.conta_bancaria_id,
        alerta_vencimento: isOverdue ? 'VENCIDO' : (isUpcoming ? 'A_VENCER' : 'OK')
      });
    }

    for (var j = 0; j < parcelas.length; j++) {
      var par = parcelas[j];
      var dPar = normalizeDateIso(par.data_vencimento);
      var parOverdue = par.situacao !== 'PAGA' && dPar < today;
      var isConsignado = false;
      if (par.origem_tipo === 'EMPRESTIMO') {
        var emp = loansMap[par.origem_id];
        if (emp && emp.desconto_em_folha) {
          isConsignado = true;
        }
      }

      var evTipo = isConsignado ? 'CONSIGNADO_FOLHA' : 'SAIDA';
      if (p.tipo && p.tipo !== evTipo) {
        continue;
      }

      events.push({
        id: par.id,
        origem_tipo: 'PARCELA',
        origem: isConsignado ? 'CONSIGNADO' : (par.origem_tipo || 'PARCELA'),
        referencia_parcela_id: par.id,
        afeta_saldo: !isConsignado,
        is_consignado: isConsignado,
        data: dPar,
        titulo: (isConsignado ? '🏢 ' : '') + (par.observacoes || ('Parcela ' + par.numero_parcela + '/' + par.total_parcelas)),
        tipo: evTipo,
        situacao: par.situacao === 'PAGA' ? 'CONFIRMADO' : 'PREVISTO',
        valor_centavos: par.valor_centavos,
        categoria_id: '',
        conta_bancaria_id: '',
        alerta_vencimento: parOverdue ? 'VENCIDO' : (par.situacao === 'PAGA' ? 'OK' : 'A_VENCER')
      });
    }

    // Faturas de Cartão de Crédito com vencimento no período
    var cardInvoices = SpreadsheetRepository.findByGrupo('FATURAS_CARTAO', user.grupo_id, function (inv) {
      var d = normalizeDateIso(inv.data_vencimento);
      return d && d >= startIso && d <= endIso && inv.situacao !== 'PAGA' && Number(inv.valor_total_centavos || 0) > 0;
    });
    var cardsList = SpreadsheetRepository.findByGrupo('CARTOES_CREDITO', user.grupo_id);
    var cardMap = {};
    for (var cd = 0; cd < cardsList.length; cd++) cardMap[cardsList[cd].id] = cardsList[cd];

    for (var fi = 0; fi < cardInvoices.length; fi++) {
      var finv = cardInvoices[fi];
      var crd = cardMap[finv.cartao_id];
      var dVenc = normalizeDateIso(finv.data_vencimento);
      var invOverdue = dVenc < today;
      events.push({
        id: finv.id,
        origem_tipo: 'FATURA_CARTAO',
        origem: 'CARTAO_CREDITO',
        referencia_parcela_id: '',
        afeta_saldo: true,
        is_consignado: false,
        data: dVenc,
        titulo: '💳 Fatura ' + (crd ? crd.nome : 'Cartão') + ' (' + finv.mes_competencia + ')',
        tipo: 'SAIDA',
        situacao: 'PREVISTO',
        valor_centavos: Math.max(0, Number(finv.valor_total_centavos || 0) - Number(finv.valor_pago_centavos || 0)),
        categoria_id: '',
        conta_bancaria_id: crd ? crd.conta_bancaria_id : '',
        alerta_vencimento: invOverdue ? 'VENCIDO' : 'A_VENCER'
      });
    }

    // Eventos do Calendário Econômico e de Mercado (se ativado)
    if (p.incluir_eventos_mercado !== false && (!p.origem || p.origem === 'MERCADO') && (!p.tipo || p.tipo === 'INFORMATIVO')) {
      if (typeof MarketDataService !== 'undefined' && MarketDataService.getEconomicCalendar) {
        try {
          var ecoEvents = MarketDataService.getEconomicCalendar() || [];
          for (var k = 0; k < ecoEvents.length; k++) {
            var eco = ecoEvents[k];
            var ecoD = normalizeDateIso(eco.data);
            if (ecoD >= startIso && ecoD <= endIso) {
              events.push({
                id: 'eco_' + k + '_' + ecoD,
                origem_tipo: 'ECONOMICO',
                origem: 'MERCADO',
                referencia_parcela_id: '',
                afeta_saldo: false,
                is_consignado: false,
                data: ecoD,
                titulo: '📊 ' + eco.evento,
                tipo: 'INFORMATIVO',
                situacao: 'AGENDA',
                valor_centavos: 0,
                categoria_id: '',
                conta_bancaria_id: '',
                alerta_vencimento: eco.importancia || 'OK',
                detalhes_agenda: {
                  orgao: eco.orgao,
                  impacto: eco.impacto_esperado
                }
              });
            }
          }
        } catch (eEco) {
          // ignore
        }
      }
    }

    events.sort(function (a, b) {
      return String(a.data).localeCompare(String(b.data));
    });

    return {
      visao: viewMode,
      periodo: { inicio: startIso, fim: endIso },
      total_eventos: events.length,
      eventos: events
    };
  }

  /**
   * Sincroniza um registro financeiro com o Google Calendar mantendo o vínculo em AGENDA_SYNC.
   * Por segurança, não cria eventos reais em calendários externos se dryRun = true ou se
   * a sincronização externa não tiver sido explicitamente autorizada pelo administrador.
   */
  function syncFinancialItemToCalendar(user, item, options) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var opts = options || {};
    var configs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', user.grupo_id);
    var syncEnabled = false;
    for (var i = 0; i < configs.length; i++) {
      if (configs[i].chave === 'CALENDARIO_SYNC_ATIVO' && String(configs[i].valor) === 'true') {
        syncEnabled = true;
        break;
      }
    }

    var isDryRun = opts.dryRun !== undefined ? Boolean(opts.dryRun) : !syncEnabled;
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var calendarId = (props && props.getProperty('GOOGLE_CALENDAR_ID')) || 'primary';

    var existingSync = SpreadsheetRepository.findOne('AGENDA_SYNC', function (s) {
      return (
        s.grupo_id === user.grupo_id &&
        s.origem_tipo === item.origem_tipo &&
        s.origem_id === item.id
      );
    });

    if (existingSync && Number(existingSync.tentativas || 0) >= MAX_SYNC_RETRIES && existingSync.status_sync === 'ERRO' && !opts.forceRetry) {
      return existingSync;
    }

    var titlePrefix = item.tipo === 'ENTRADA' ? '[Receita] ' : (item.tipo === 'CONSIGNADO_FOLHA' ? '[Consignado Folha] ' : (item.tipo === 'INFORMATIVO' ? '[Agenda Mercado] ' : '[Vencimento] '));
    var formattedVal = ValidationService.formatCentavosToBrl(item.valor_centavos);
    var eventTitle = titlePrefix + item.titulo + ' - ' + formattedVal;
    var isCanceled = item.situacao === 'CANCELADO' || item.situacao === 'CANCELADA';

    try {
      var externalEventId = existingSync ? existingSync.external_event_id : '';

      if (isDryRun) {
        // Modo seguro de desenvolvimento/teste: simula ID determinístico sem tocar no Google Calendar real
        if (!externalEventId) {
          externalEventId = 'dryrun_cal_' + item.origem_tipo.toLowerCase() + '_' + item.id;
        }
      } else if (typeof CalendarApp !== 'undefined') {
        var cal = calendarId === 'primary'
          ? CalendarApp.getDefaultCalendar()
          : CalendarApp.getCalendarById(calendarId);
        if (!cal) {
          throw new Error('Calendário Google não encontrado ou sem permissão de acesso: ' + calendarId);
        }
        var parts = String(item.data).split('-');
        var eventDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));

        if (externalEventId && externalEventId.indexOf('dryrun_') !== 0) {
          var existingCalEvent = cal.getEventById(externalEventId);
          if (existingCalEvent) {
            if (isCanceled) {
              existingCalEvent.setTitle('[CANCELADO] ' + eventTitle);
            } else {
              existingCalEvent.setTitle(eventTitle);
              existingCalEvent.setAllDayDate(eventDate);
            }
          } else if (!isCanceled) {
            var recreated = cal.createAllDayEvent(eventTitle, eventDate, {
              description: 'Registro Finanças Inteligentes ID: ' + item.id
            });
            externalEventId = recreated.getId();
          }
        } else if (!isCanceled) {
          var createdEv = cal.createAllDayEvent(eventTitle, eventDate, {
            description: 'Registro Finanças Inteligentes ID: ' + item.id
          });
          externalEventId = createdEv.getId();
        }
      }

      var targetStatus = isCanceled ? 'CANCELADO' : 'SINCRONIZADO';
      if (existingSync) {
        return SpreadsheetRepository.updateById('AGENDA_SYNC', existingSync.id, {
          calendar_id: calendarId,
          external_event_id: externalEventId,
          titulo_evento: eventTitle,
          data_evento: item.data,
          valor_centavos: item.valor_centavos,
          status_sync: targetStatus,
          ultimo_erro: '',
          ultima_sincronizacao_em: SpreadsheetRepository.nowIso()
        }, user.grupo_id);
      } else {
        return SpreadsheetRepository.insert('AGENDA_SYNC', {
          id: SpreadsheetRepository.generateId('ags'),
          grupo_id: user.grupo_id,
          origem_tipo: item.origem_tipo,
          origem_id: item.id,
          calendar_id: calendarId,
          external_event_id: externalEventId,
          titulo_evento: eventTitle,
          data_evento: item.data,
          valor_centavos: item.valor_centavos,
          status_sync: targetStatus,
          tentativas: 1,
          ultimo_erro: '',
          ultima_sincronizacao_em: SpreadsheetRepository.nowIso()
        });
      }
    } catch (err) {
      var errMsg = ValidationService.sanitizeText(err && err.message ? err.message : String(err), 300);
      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'ERRO_SYNC_CALENDARIO',
        entidade: 'AGENDA_SYNC',
        entidade_id: item.id,
        origem: 'SISTEMA',
        detalhes: { erro: errMsg }
      });

      if (existingSync) {
        return SpreadsheetRepository.updateById('AGENDA_SYNC', existingSync.id, {
          status_sync: 'ERRO',
          tentativas: Number(existingSync.tentativas || 0) + 1,
          ultimo_erro: errMsg,
          ultima_sincronizacao_em: SpreadsheetRepository.nowIso()
        }, user.grupo_id);
      } else {
        return SpreadsheetRepository.insert('AGENDA_SYNC', {
          id: SpreadsheetRepository.generateId('ags'),
          grupo_id: user.grupo_id,
          origem_tipo: item.origem_tipo,
          origem_id: item.id,
          calendar_id: calendarId,
          external_event_id: '',
          titulo_evento: eventTitle,
          data_evento: item.data,
          valor_centavos: item.valor_centavos,
          status_sync: 'ERRO',
          tentativas: 1,
          ultimo_erro: errMsg,
          ultima_sincronizacao_em: SpreadsheetRepository.nowIso()
        });
      }
    }
  }

  /**
   * Conecta e sincroniza todos os lançamentos ativos com uma agenda própria do Google Calendar
   * intitulada 'Finanças Inteligentes'. Se a agenda ainda não existir, cria-a automaticamente.
   */
  function syncAllToGoogleCalendar(user, params) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var calName = 'Finanças Inteligentes';
    var targetCalendarId = 'primary';
    var isMock = false;

    if (typeof CalendarApp !== 'undefined') {
      try {
        var existingCals = CalendarApp.getCalendarsByName(calName);
        if (existingCals && existingCals.length > 0) {
          targetCalendarId = existingCals[0].getId();
        } else {
          var newCal = CalendarApp.createCalendar(calName, {
            summary: 'Agenda financeira integrada do Finanças Inteligentes',
            color: CalendarApp.Color.BLUE
          });
          targetCalendarId = newCal.getId();
        }
      } catch (e) {
        targetCalendarId = 'primary';
      }
    } else {
      isMock = true;
      targetCalendarId = 'mock_cal_financas';
    }

    // Busca todos os lançamentos ativos do grupo
    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.situacao !== 'CANCELADO';
    });

    var count = 0;
    for (var i = 0; i < launches.length; i++) {
      var l = launches[i];
      var dIso = normalizeDateIso(l.data_lancamento);
      if (!dIso) continue;
      syncFinancialItemToCalendar(user, {
        id: l.id,
        origem_tipo: 'LANCAMENTO',
        titulo: l.descricao,
        tipo: l.tipo,
        situacao: l.situacao,
        valor_centavos: l.valor_centavos,
        data: dIso
      }, {
        forceSync: true,
        dryRun: isMock,
        targetCalendarId: targetCalendarId
      });
      count++;
    }

    return {
      ok: true,
      calendarName: calName,
      calendarId: targetCalendarId,
      sincronizados: count,
      link: 'https://calendar.google.com/calendar/u/0/r'
    };
  }

  return {
    MAX_SYNC_RETRIES: MAX_SYNC_RETRIES,
    getFinancialCalendar: getFinancialCalendar,
    syncFinancialItemToCalendar: syncFinancialItemToCalendar,
    syncAllToGoogleCalendar: syncAllToGoogleCalendar
  };
})();

