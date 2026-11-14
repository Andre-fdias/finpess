/**
 * @file LicenseService.gs
 * @description Gestão descentralizada de licenciamento, período de avaliação de 14 dias,
 * verificação de integridade de instalação e proteção contra cópia desautorizada (anti-clone).
 * 
 * Regra Arquitetural Absoluta:
 * - O comprador é proprietário perpétuo da sua planilha e dos seus dados.
 * - Uma licença expirada ou revogada NUNCA apaga dados e NUNCA bloqueia visualização ou exportação.
 * - O bloqueio atua exclusivamente sobre operações de escrita (inclusão, edição, exclusão e rotinas de automação).
 */

var LicenseService = (function () {
  var TRIAL_DURATION_DAYS = 14;
  var OFFLINE_GRACE_PERIOD_DAYS = 7;
  var SERIAL_REGEX = /^FINP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

  function getProps() {
    return typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  }

  /**
   * Obtém ou inicializa o identificador único e imutável da instalação.
   */
  function getInstallationId() {
    var props = getProps();
    var instId = props ? props.getProperty('FINPESS_INSTALLATION_ID') : null;
    if (!instId) {
      instId = SpreadsheetRepository.generateId('inst');
      if (props) {
        props.setProperty('FINPESS_INSTALLATION_ID', instId);
      }
    }
    return instId;
  }

  /**
   * Retorna o ID da planilha vinculada a esta instalação.
   */
  function getBoundSpreadsheetId() {
    var props = getProps();
    var sheetId = props ? props.getProperty('SPREADSHEET_ID') : null;
    if (!sheetId) {
      try {
        if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
          var activeSs = SpreadsheetApp.getActiveSpreadsheet();
          if (activeSs && activeSs.getId) {
            sheetId = activeSs.getId();
            if (props) props.setProperty('SPREADSHEET_ID', sheetId);
          }
        }
      } catch (e) {}
    }
    return sheetId || '';
  }

  /**
   * Diagnostica o estado atual da licença desta instalação.
   */
  function getLicenseInfo() {
    var props = getProps();
    var instId = getInstallationId();
    var boundSheetId = getBoundSpreadsheetId();

    var currentActiveId = '';
    try {
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
        var actSs = SpreadsheetApp.getActiveSpreadsheet();
        if (actSs && actSs.getId) currentActiveId = actSs.getId();
      }
    } catch (e) {}

    // Detecção de Clonagem de Planilha
    if (boundSheetId && currentActiveId && boundSheetId !== currentActiveId) {
      return {
        ok: true,
        status: 'CLONED',
        can_write: false,
        can_read: true,
        can_export: true,
        is_trial: false,
        is_active: false,
        is_expired: true,
        plan: 'BLOQUEADO',
        installation_id: instId,
        spreadsheet_id: currentActiveId,
        bound_spreadsheet_id: boundSheetId,
        mensagem: 'Esta cópia da planilha foi duplicada a partir de outra instalação. Para cadastrar e editar dados, ative uma licença comercial ou inicie um novo teste nesta cópia.'
      };
    }

    var status = props ? (props.getProperty('LICENSE_STATUS') || 'UNREGISTERED') : 'UNREGISTERED';
    var plan = props ? (props.getProperty('LICENSE_PLAN') || 'TRIAL') : 'TRIAL';
    var serial = props ? (props.getProperty('LICENSE_SERIAL') || '') : '';
    var buyerEmail = props ? (props.getProperty('LICENSE_BUYER_EMAIL') || '') : '';
    var trialStart = props ? props.getProperty('LICENSE_TRIAL_START') : null;
    var trialEnd = props ? props.getProperty('LICENSE_TRIAL_END') : null;
    var validUntil = props ? props.getProperty('LICENSE_VALID_UNTIL') : null;

    var now = Date.now();
    var daysRemaining = 0;
    var canWrite = false;
    var mensagem = '';

    if (status === 'ACTIVE') {
      if (!validUntil || validUntil === 'LIFETIME') {
        canWrite = true;
        mensagem = 'Licença Comercial Vitalícia Ativa.';
      } else {
        var expTs = new Date(validUntil).getTime();
        if (now <= expTs) {
          canWrite = true;
          var diffDays = Math.ceil((expTs - now) / (1000 * 60 * 60 * 24));
          mensagem = 'Licença Ativa — ' + diffDays + ' dias restantes.';
        } else {
          status = 'EXPIRED';
          canWrite = false;
          mensagem = 'Sua licença anual do Finpess expirou. Seus dados estão seguros. Renove para continuar editando.';
        }
      }
    } else if (status === 'TRIAL') {
      if (trialEnd) {
        var endTs = new Date(trialEnd).getTime();
        if (now <= endTs) {
          canWrite = true;
          daysRemaining = Math.max(0, Math.ceil((endTs - now) / (1000 * 60 * 60 * 24)));
          mensagem = 'Período de Avaliação Gratuita — ' + daysRemaining + ' dias restantes.';
        } else {
          status = 'EXPIRED';
          canWrite = false;
          daysRemaining = 0;
          mensagem = 'Seu período de teste de 14 dias do Finpess terminou. Seus dados continuam preservados nesta planilha. Adquira uma licença para continuar editando.';
        }
      } else {
        // Trial ainda não iniciado formalmente
        canWrite = true;
        daysRemaining = TRIAL_DURATION_DAYS;
        mensagem = 'Bem-vindo ao Finpess! Inicie seu teste gratuito de 14 dias para explorar todos os recursos.';
      }
    } else if (status === 'EXPIRED') {
      canWrite = false;
      daysRemaining = 0;
      mensagem = 'Seu período de utilização do Finpess expirou. Seus dados continuam preservados nesta planilha. Adquira ou renove sua licença para continuar editando.';
    } else if (status === 'CLONED') {
      canWrite = false;
      mensagem = 'Esta cópia da planilha foi duplicada a partir de outra instalação. Ative uma nova licença nesta cópia para habilitar edições.';
    } else if (status === 'REVOKED') {
      canWrite = false;
      mensagem = 'Licença revogada pelo administrador. Apenas consulta e exportação permitidas.';
    } else if (status === 'SUSPENDED') {
      canWrite = false;
      mensagem = 'Licença temporariamente suspensa. Regularize sua assinatura.';
    } else {
      // UNREGISTERED: Permite iniciar trial de 14 dias
      canWrite = true;
      daysRemaining = TRIAL_DURATION_DAYS;
      mensagem = 'Instalação nova do Finpess. Clique em Iniciar Teste de 14 Dias.';
    }

    return {
      ok: true,
      status: status,
      plan: plan,
      serial_mascarado: serial ? serial.substring(0, 9) + '****-' + serial.substring(serial.length - 4) : '',
      buyer_email: buyerEmail,
      installation_id: instId,
      spreadsheet_id: boundSheetId || currentActiveId,
      trial_days_remaining: daysRemaining,
      trial_end_date: trialEnd,
      valid_until: validUntil,
      can_write: canWrite,
      can_read: true,
      can_export: true,
      is_trial: status === 'TRIAL' || status === 'UNREGISTERED',
      is_active: status === 'ACTIVE',
      is_expired: status === 'EXPIRED',
      mensagem: mensagem
    };
  }

  /**
   * Barreira de autorização mandatória para operações de mutação (inserção, edição, exclusão).
   * Lança exceção amigável e explicativa caso a licença não permita escrita.
   */
  function assertCanWrite(operationDescription) {
    var info = getLicenseInfo();
    if (!info.can_write) {
      var op = operationDescription ? ' para ' + operationDescription : '';
      if (info.status === 'CLONED') {
        throw new Error('OPERACAO_BLOQUEADA_CLONE: Cópia não autorizada da planilha. Ative sua licença nesta cópia para habilitar o cadastro' + op + '. Seus dados atuais permanecem acessíveis para visualização.');
      }
      if (info.status === 'EXPIRED') {
        throw new Error('OPERACAO_BLOQUEADA_EXPIRADO: Período de utilização encerrado. Para continuar cadastrando ou editando' + op + ', adquira ou renove sua licença do Finpess. Seus dados continuam 100% seguros nesta planilha.');
      }
      throw new Error('OPERACAO_BLOQUEADA_LICENCA: ' + (info.mensagem || 'Acesso de escrita bloqueado.') + ' (Operação: ' + (operationDescription || 'gravação') + ')');
    }
    return true;
  }

  /**
   * Inicia o período de teste de 14 dias para esta instalação.
   */
  function startTrial(buyerEmail) {
    var props = getProps();
    var instId = getInstallationId();
    var boundId = getBoundSpreadsheetId();

    var existingStatus = props ? props.getProperty('LICENSE_STATUS') : null;
    if (existingStatus === 'ACTIVE') {
      return { ok: true, message: 'Instalação já possui licença comercial ativa.', license: getLicenseInfo() };
    }
    if (existingStatus === 'TRIAL' && props.getProperty('LICENSE_TRIAL_END')) {
      return { ok: true, message: 'Teste já em andamento.', license: getLicenseInfo() };
    }

    var now = new Date();
    var endDate = new Date(now.getTime() + (TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000));

    if (props) {
      props.setProperty('LICENSE_STATUS', 'TRIAL');
      props.setProperty('LICENSE_PLAN', 'TRIAL');
      props.setProperty('LICENSE_TRIAL_START', now.toISOString());
      props.setProperty('LICENSE_TRIAL_END', endDate.toISOString());
      if (buyerEmail) props.setProperty('LICENSE_BUYER_EMAIL', String(buyerEmail).trim().toLowerCase());
    }

    // Persiste também no registro de configurações locais
    try {
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_LICENSE_STATUS',
        valor: 'TRIAL',
        descricao: 'Período de avaliação de 14 dias do Finpess'
      }, 'chave');
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_TRIAL_END',
        valor: endDate.toISOString(),
        descricao: 'Data de término do período de teste'
      }, 'chave');
    } catch (eRepo) {}

    return {
      ok: true,
      message: 'Período de teste de 14 dias iniciado com sucesso!',
      license: getLicenseInfo()
    };
  }

  /**
   * Ativa a instalação utilizando um serial comercial exclusivo emitido pelo vendedor.
   */
  function activateLicense(serial, buyerEmail, tokenPayload) {
    var cleanSerial = String(serial || '').trim().toUpperCase();
    if (!SERIAL_REGEX.test(cleanSerial)) {
      throw new Error('SERIAL_INVALIDO: O formato do serial informado é inválido. Utilize o formato FINP-XXXX-XXXX-XXXX.');
    }

    var props = getProps();
    var instId = getInstallationId();
    var boundId = getBoundSpreadsheetId();

    var plan = (tokenPayload && tokenPayload.plan) || 'COMPLETO';
    var validUntil = (tokenPayload && tokenPayload.valid_until) || 'LIFETIME';

    if (props) {
      props.setProperty('LICENSE_STATUS', 'ACTIVE');
      props.setProperty('LICENSE_PLAN', plan);
      props.setProperty('LICENSE_SERIAL', cleanSerial);
      props.setProperty('LICENSE_VALID_UNTIL', validUntil);
      if (buyerEmail) {
        props.setProperty('LICENSE_BUYER_EMAIL', String(buyerEmail).trim().toLowerCase());
      }
      props.setProperty('LICENSE_ACTIVATED_AT', new Date().toISOString());
    }

    // Persiste em CONFIGURACOES da planilha para redundância offline
    try {
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_LICENSE_STATUS',
        valor: 'ACTIVE',
        descricao: 'Licença comercial Finpess ativa'
      }, 'chave');
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_LICENSE_SERIAL',
        valor: cleanSerial,
        descricao: 'Serial de ativação do cliente'
      }, 'chave');
    } catch (eRepo) {}

    return {
      ok: true,
      message: 'Licença comercial do Finpess ativada com sucesso! Todos os recursos estão liberados.',
      license: getLicenseInfo()
    };
  }

  /**
   * Utilitário para administradores ou testes: simula expiração ou redefinição de licença.
   */
  function simulateLicenseState(newStatus, daysOffset) {
    var props = getProps();
    if (!props) return;
    if (newStatus === 'RESET') {
      props.deleteProperty('LICENSE_STATUS');
      props.deleteProperty('LICENSE_PLAN');
      props.deleteProperty('LICENSE_SERIAL');
      props.deleteProperty('LICENSE_TRIAL_START');
      props.deleteProperty('LICENSE_TRIAL_END');
      props.deleteProperty('LICENSE_VALID_UNTIL');
      return getLicenseInfo();
    }
    props.setProperty('LICENSE_STATUS', newStatus);
    if (newStatus === 'TRIAL') {
      var d = typeof daysOffset === 'number' ? daysOffset : 14;
      var end = new Date(Date.now() + (d * 24 * 60 * 60 * 1000));
      props.setProperty('LICENSE_TRIAL_END', end.toISOString());
    }
    return getLicenseInfo();
  }

  return {
    TRIAL_DURATION_DAYS: TRIAL_DURATION_DAYS,
    OFFLINE_GRACE_PERIOD_DAYS: OFFLINE_GRACE_PERIOD_DAYS,
    getInstallationId: getInstallationId,
    getBoundSpreadsheetId: getBoundSpreadsheetId,
    getLicenseInfo: getLicenseInfo,
    assertCanWrite: assertCanWrite,
    startTrial: startTrial,
    activateLicense: activateLicense,
    simulateLicenseState: simulateLicenseState
  };
})();
