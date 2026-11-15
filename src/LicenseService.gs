/**
 * @file LicenseService.gs
 * @description Gestão descentralizada de licenciamento, período de avaliação de 14 dias,
 * verificação de integridade de instalação, proteção contra cópia desautorizada (anti-clone)
 * e validação assimétrica de tokens RSA-2048 sem exposição de segredos no cliente.
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

  // Chave Pública Oficial RSA-2048 do Servidor Finpess (PKCS#1 v1.5 com SHA-256)
  // Apenas a chave pública fica embutida no cliente. A chave privada permanece 100% restrita ao servidor.
  var RSA_PUBLIC_KEY = {
    n: '6kFVAxGgReducqEAV16HhrTM2F_oSVZgRW-e7hrqtZ6U6T_piZZ51NpkeY67gjXTDsQs4HUanofmtuMLvv9XwvegcF7gy6lWUJmNYYeB6qpmOBJMWsYSKqu5gyexGGpd_01C7ZGLu5v5TPWozlT2mBZbnWB30_wwUim54aWdh_qk2Q9TgILRtJUoZuKf882iM88HLVqRQnnOShjANtDgOMmeLzLtpGogCnueJnKkmicoTPBLfdG28AJDvgWppjORgXkIiz5mS6T-sneVzU13TGc6kI8I1NFhRMqkXYMNsQDvjNENbhQuaYYBQEn-0z5Hfz6PsQ7UDg3fCXHVN9FeQQ',
    e: BigInt(65537)
  };

  function getProps() {
    return typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  }

  function base64urlToHex(b64url) {
    var b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    if (typeof Utilities !== 'undefined' && Utilities.base64Decode) {
      var bytes = Utilities.base64Decode(b64);
      return bytes.map(function (b) {
        var v = b < 0 ? b + 256 : b;
        return ('0' + v.toString(16)).slice(-2);
      }).join('');
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64url, 'base64url').toString('hex');
    }
    return '';
  }

  function modPow(base, exponent, modulus) {
    var zero = BigInt(0);
    var one = BigInt(1);
    var two = BigInt(2);
    if (modulus === one) return zero;
    var result = one;
    base = base % modulus;
    while (exponent > zero) {
      if (exponent % two === one) {
        result = (result * base) % modulus;
      }
      exponent = exponent / two;
      base = (base * base) % modulus;
    }
    return result;
  }

  function computeSha256Hex(str) {
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
      return digest.map(function (b) {
        var v = b < 0 ? b + 256 : b;
        return ('0' + v.toString(16)).slice(-2);
      }).join('');
    }
    if (typeof require !== 'undefined') {
      var crypto = require('crypto');
      return crypto.createHash('sha256').update(str).digest('hex');
    }
    return '';
  }

  /**
   * Verifica a integridade e assinatura digital de um token assimétrico emitido pelo servidor oficial.
   */
  function verifyAsymmetricToken(tokenString) {
    if (!tokenString || typeof tokenString !== 'string' || tokenString.indexOf('.') === -1) {
      throw new Error('TOKEN_INVALIDO: Formato do token assinado inválido.');
    }
    var parts = tokenString.split('.');
    var b64Payload = parts[0];
    var sigHex = parts[1];
    if (!b64Payload || !sigHex || sigHex.length !== 512) {
      throw new Error('TOKEN_INVALIDO: Assinatura assimétrica corrompida ou truncada.');
    }

    var payloadJson = '';
    if (typeof Utilities !== 'undefined' && Utilities.base64DecodeWebSafe) {
      payloadJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64Payload)).getDataAsString('UTF-8');
    } else if (typeof Buffer !== 'undefined') {
      payloadJson = Buffer.from(b64Payload, 'base64url').toString('utf8');
    }

    var payloadObj;
    try {
      payloadObj = JSON.parse(payloadJson);
    } catch (e) {
      throw new Error('TOKEN_INVALIDO: Payload JSON corrompido.');
    }

    // Validação criptográfica com a Chave Pública RSA-2048 via BigInt modular exponentiation
    var nHex = base64urlToHex(RSA_PUBLIC_KEY.n);
    var n = BigInt('0x' + nHex);
    var e = RSA_PUBLIC_KEY.e;
    var sigBigInt;
    try {
      sigBigInt = BigInt('0x' + sigHex);
    } catch (eSig) {
      throw new Error('TOKEN_INVALIDO: Assinatura hexadecimal inválida.');
    }

    var decryptedBigInt = modPow(sigBigInt, e, n);
    var decryptedHex = decryptedBigInt.toString(16);
    if (decryptedHex.length % 2 !== 0) decryptedHex = '0' + decryptedHex;
    while (decryptedHex.length < 512) {
      decryptedHex = '0' + decryptedHex;
    }

    // Em PKCS#1 v1.5 com SHA-256, os últimos 32 bytes (64 caracteres hex) são o hash SHA-256 do payload JSON
    var extractedHashHex = decryptedHex.slice(-64).toLowerCase();
    var expectedHashHex = computeSha256Hex(payloadJson).toLowerCase();

    if (extractedHashHex !== expectedHashHex) {
      throw new Error('TOKEN_ASSINATURA_FORJADA: A assinatura digital do token não corresponde à chave pública oficial do Finpess.');
    }

    return payloadObj;
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
   * Retorna o ID da planilha vinculado à instalação original.
   */
  function getOriginalSpreadsheetId() {
    var props = getProps();
    var origId = props ? props.getProperty('FINPESS_ORIGINAL_SPREADSHEET_ID') : null;
    if (!origId) {
      try {
        var recs = SpreadsheetRepository.queryRecords('CONFIGURACOES', function (r) {
          return r && r.chave === 'FINPESS_ORIGINAL_SPREADSHEET_ID';
        });
        if (recs && recs.length > 0 && recs[0].valor) {
          origId = recs[0].valor;
          if (props) props.setProperty('FINPESS_ORIGINAL_SPREADSHEET_ID', origId);
        }
      } catch (eConf) {}
    }
    if (!origId) {
      origId = getBoundSpreadsheetId();
      if (origId && props) {
        props.setProperty('FINPESS_ORIGINAL_SPREADSHEET_ID', origId);
      }
    }
    return origId || '';
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
   * Verifica se o trial já foi consumido nesta instalação ou cópia.
   */
  function isTrialConsumed() {
    var props = getProps();
    if (props) {
      if (props.getProperty('LICENSE_TRIAL_CONSUMED') === 'true') return true;
      if (props.getProperty('LICENSE_TRIAL_START')) return true;
    }
    try {
      var recs = SpreadsheetRepository.queryRecords('CONFIGURACOES', function (r) {
        return r && (r.chave === 'FINPESS_TRIAL_CONSUMED' || r.chave === 'FINPESS_TRIAL_END');
      });
      if (recs && recs.length > 0 && recs[0].valor) return true;
    } catch (eConf) {}
    return false;
  }

  /**
   * Diagnostica o estado atual da licença desta instalação.
   */
  function getLicenseInfo() {
    var props = getProps();
    var instId = getInstallationId();
    var boundSheetId = getBoundSpreadsheetId();
    var origSheetId = getOriginalSpreadsheetId();

    var currentActiveId = '';
    try {
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
        var actSs = SpreadsheetApp.getActiveSpreadsheet();
        if (actSs && actSs.getId) currentActiveId = actSs.getId();
      }
    } catch (e) {}

    // Detecção Rigorosa de Clonagem de Planilha
    var isCloned = false;
    if (origSheetId && currentActiveId && origSheetId !== currentActiveId) {
      isCloned = true;
    } else if (props && props.getProperty('LICENSE_STATUS') === 'CLONED') {
      isCloned = true;
    }

    if (isCloned) {
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
        bound_spreadsheet_id: origSheetId,
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
      // UNREGISTERED
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
      if (info.status === 'REVOKED') {
        throw new Error('OPERACAO_BLOQUEADA_REVOGADA: Licença revogada por estorno ou cancelamento comercial. Apenas consulta e exportação permitidas' + op + '.');
      }
      throw new Error('OPERACAO_BLOQUEADA_LICENCA: ' + (info.mensagem || 'Acesso de escrita bloqueado.') + ' (Operação: ' + (operationDescription || 'gravação') + ')');
    }
    return true;
  }

  /**
   * Inicia o período de teste de 14 dias para esta instalação.
   * Impede estritamente reinicialização após expiração ou primeiro consumo.
   */
  function startTrial(buyerEmail) {
    var props = getProps();
    var instId = getInstallationId();

    var existingStatus = props ? props.getProperty('LICENSE_STATUS') : null;
    if (existingStatus === 'ACTIVE') {
      return { ok: true, message: 'Instalação já possui licença comercial ativa.', license: getLicenseInfo() };
    }
    if (existingStatus === 'TRIAL' && props.getProperty('LICENSE_TRIAL_END')) {
      var curEnd = new Date(props.getProperty('LICENSE_TRIAL_END')).getTime();
      if (Date.now() <= curEnd) {
        return { ok: true, message: 'Teste já em andamento.', license: getLicenseInfo() };
      }
    }

    if (isTrialConsumed() || existingStatus === 'EXPIRED') {
      throw new Error('TRIAL_JA_UTILIZADO: O período de avaliação gratuita de 14 dias já foi utilizado nesta instalação. Para continuar cadastrando e editando, adquira uma licença comercial.');
    }

    var now = new Date();
    var endDate = new Date(now.getTime() + (TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000));

    if (props) {
      props.setProperty('LICENSE_STATUS', 'TRIAL');
      props.setProperty('LICENSE_PLAN', 'TRIAL');
      props.setProperty('LICENSE_TRIAL_START', now.toISOString());
      props.setProperty('LICENSE_TRIAL_END', endDate.toISOString());
      props.setProperty('LICENSE_TRIAL_CONSUMED', 'true');
      if (buyerEmail) props.setProperty('LICENSE_BUYER_EMAIL', String(buyerEmail).trim().toLowerCase());
    }

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
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_TRIAL_CONSUMED',
        valor: 'true',
        descricao: 'Indicador permanente de consumo do trial'
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
   * Realiza verificação criptográfica assimétrica RSA-2048 do token recebido ou obtido do servidor.
   */
  function activateLicense(serial, buyerEmail, tokenOrPayload, maybeToken) {
    var cleanSerial = String(serial || '').trim().toUpperCase();
    if (!SERIAL_REGEX.test(cleanSerial)) {
      throw new Error('SERIAL_INVALIDO: O formato do serial informado é inválido. Utilize o formato FINP-XXXX-XXXX-XXXX.');
    }

    var props = getProps();
    var instId = getInstallationId();
    var boundId = getBoundSpreadsheetId();
    var email = String(buyerEmail || (props ? props.getProperty('LICENSE_BUYER_EMAIL') : '') || '').trim().toLowerCase();

    var tokenString = '';
    if (typeof tokenOrPayload === 'string' && tokenOrPayload.indexOf('.') !== -1) {
      tokenString = tokenOrPayload;
    } else if (typeof maybeToken === 'string' && maybeToken.indexOf('.') !== -1) {
      tokenString = maybeToken;
    } else if (tokenOrPayload && tokenOrPayload.token && typeof tokenOrPayload.token === 'string') {
      tokenString = tokenOrPayload.token;
    }

    var tokenPayload = null;

    if (tokenString) {
      // 1. Verificação Criptográfica Assimétrica RSA-2048
      tokenPayload = verifyAsymmetricToken(tokenString);

      // 2. Validação de Vínculo com a Instalação e Planilha
      if (tokenPayload.serial !== cleanSerial) {
        throw new Error('TOKEN_SERIAL_DIVERGENTE: O token fornecido pertence a outro serial (' + tokenPayload.serial + ').');
      }
      if (tokenPayload.installation_id && tokenPayload.installation_id !== instId) {
        throw new Error('TOKEN_INSTALACAO_DIVERGENTE: O token fornecido foi emitido para outra instalação.');
      }
      if (tokenPayload.spreadsheet_id && boundId && tokenPayload.spreadsheet_id !== boundId) {
        throw new Error('TOKEN_PLANILHA_DIVERGENTE: O token fornecido foi emitido para outra planilha Google.');
      }
      if (tokenPayload.status === 'REVOKED') {
        throw new Error('LICENCA_REVOGADA: Esta licença foi revogada (reembolso ou cancelamento de pagamento).');
      }
      if (tokenPayload.valid_until && tokenPayload.valid_until !== 'LIFETIME') {
        var expTs = new Date(tokenPayload.valid_until).getTime();
        if (Date.now() > expTs) {
          throw new Error('LICENCA_EXPIRADA: A validade deste token de ativação expirou.');
        }
      }
    } else {
      // Ativação remota por HTTPS ou via LicensingServer local
      var serverUrl = props ? props.getProperty('LICENSING_SERVER_URL') : null;
      var activationResponse = null;

      if (serverUrl && typeof UrlFetchApp !== 'undefined') {
        try {
          var resp = UrlFetchApp.fetch(serverUrl + (serverUrl.indexOf('?') === -1 ? '?' : '&') + 'action=license.activate', {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
              action: 'license.activate',
              serial: cleanSerial,
              installation_id: instId,
              spreadsheet_id: boundId,
              email: email
            }),
            muteHttpExceptions: true
          });
          activationResponse = JSON.parse(resp.getContentText());
        } catch (eFetch) {
          throw new Error('FALHA_CONEXAO_SERVIDOR: Não foi possível conectar ao servidor de licenciamento para validar o serial. ' + eFetch.message);
        }
      } else if (typeof LicensingServer !== 'undefined') {
        activationResponse = LicensingServer.handleActivate({
          serial: cleanSerial,
          installation_id: instId,
          spreadsheet_id: boundId,
          email: email
        });
      }

      if (!activationResponse) {
        throw new Error('SERIAL_NAO_ENCONTRADO: O serial informado não existe ou não foi emitido pelo sistema oficial.');
      }
      if (!activationResponse.ok) {
        throw new Error(activationResponse.error || 'FALHA_ATIVACAO: Não foi possível ativar a licença.');
      }

      tokenString = activationResponse.token;
      if (!tokenString) {
        throw new Error('RESPOSTA_SERVIDOR_INVALIDA: O servidor de licenciamento não retornou um token assinado válido.');
      }

      tokenPayload = verifyAsymmetricToken(tokenString);
    }

    var plan = (tokenPayload && tokenPayload.plan) || 'COMPLETO';
    var validUntil = (tokenPayload && tokenPayload.valid_until) || 'LIFETIME';

    if (props) {
      props.setProperty('LICENSE_STATUS', 'ACTIVE');
      props.setProperty('LICENSE_PLAN', plan);
      props.setProperty('LICENSE_SERIAL', cleanSerial);
      props.setProperty('LICENSE_VALID_UNTIL', validUntil);
      props.setProperty('LICENSE_TOKEN', tokenString);
      if (email) {
        props.setProperty('LICENSE_BUYER_EMAIL', email);
      }
      props.setProperty('LICENSE_ACTIVATED_AT', new Date().toISOString());
    }

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
      SpreadsheetRepository.upsertRecord('CONFIGURACOES', {
        chave: 'FINPESS_LICENSE_TOKEN',
        valor: tokenString,
        descricao: 'Token criptográfico assinado assimetricamente'
      }, 'chave');
    } catch (eRepo) {}

    return {
      ok: true,
      message: 'Licença comercial do Finpess ativada com sucesso! Todos os recursos estão liberados.',
      license: getLicenseInfo()
    };
  }

  /**
   * Utilitário para testes: simula diferentes estados da licença.
   */
  function simulateLicenseState(newStatus, daysOffset) {
    var props = getProps();
    if (!props) return;
    if (newStatus === 'RESET') {
      props.deleteProperty('LICENSE_STATUS');
      props.deleteProperty('LICENSE_PLAN');
      props.deleteProperty('LICENSE_SERIAL');
      props.deleteProperty('LICENSE_TOKEN');
      props.deleteProperty('LICENSE_TRIAL_START');
      props.deleteProperty('LICENSE_TRIAL_END');
      props.deleteProperty('LICENSE_TRIAL_CONSUMED');
      props.deleteProperty('LICENSE_VALID_UNTIL');
      return getLicenseInfo();
    }
    props.setProperty('LICENSE_STATUS', newStatus);
    if (newStatus === 'TRIAL') {
      var d = typeof daysOffset === 'number' ? daysOffset : 14;
      var end = new Date(Date.now() + (d * 24 * 60 * 60 * 1000));
      props.setProperty('LICENSE_TRIAL_END', end.toISOString());
    } else if (newStatus === 'EXPIRED') {
      props.setProperty('LICENSE_VALID_UNTIL', new Date(Date.now() - 100000).toISOString());
    }
    return getLicenseInfo();
  }

  return {
    TRIAL_DURATION_DAYS: TRIAL_DURATION_DAYS,
    OFFLINE_GRACE_PERIOD_DAYS: OFFLINE_GRACE_PERIOD_DAYS,
    getInstallationId: getInstallationId,
    getBoundSpreadsheetId: getBoundSpreadsheetId,
    getOriginalSpreadsheetId: getOriginalSpreadsheetId,
    getLicenseInfo: getLicenseInfo,
    assertCanWrite: assertCanWrite,
    startTrial: startTrial,
    activateLicense: activateLicense,
    verifyAsymmetricToken: verifyAsymmetricToken,
    simulateLicenseState: simulateLicenseState
  };
})();
