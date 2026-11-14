/**
 * @file LicensingServer.gs
 * @description Servidor Central de Licenciamento, Emissão de Seriais CSPRNG, Assinatura Assimétrica (RSA-2048),
 * Gestão de Período de Teste e Webhooks de Pagamento Seguros (Mercado Pago / Kiwify / Hotmart).
 * 
 * Hospedagem: Google Apps Script Web App Privado (Conta do Vendedor)
 * Configuração de Deploy: Execute as: Me | Access: Anyone
 * Regra de Ouro (LGPD): Nenhum dado financeiro de comprador trafega ou é armazenado neste servidor.
 */

var LicensingServer = (function () {
  var BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem 0, O, 1, I para evitar ambiguidade

  // Chave Privada RSA-2048 exclusiva do Servidor (NUNCA distribuída ao cliente)
  var DEFAULT_RSA_PRIVATE_KEY_PEM = 
    "-----BEGIN PRIVATE KEY-----\n" +
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDqQVUDEaBF525y\n" +
    "oQBXXoeGtMzYX+hJVmBFb57uGuq1npTpP+mJlnnU2mR5jruCNdMOxCzgdRqeh+a2\n" +
    "4wu+/1fC96BwXuDLqVZQmY1hh4HqqmY4EkxaxhIqq7mDJ7EYal3/TULtkYu7m/lM\n" +
    "9ajOVPaYFludYHfT/DBSKbnhpZ2H+qTZD1OAgtG0lShm4p/zzaIzzwctWpFCec5K\n" +
    "GMA20OA4yZ4vMu2kaiAKe54mcqSaJyhM8Et90bbwAkO+BammM5GBeQiLPmZLpP6y\n" +
    "d5XNTXdMZzqQjwjU0WFEyqRdgw2xAO+M0Q1uFC5phgFASf7TPkd/Po+xDtQODd8J\n" +
    "cdU30V5BAgMBAAECggEAARzSuUZoWzMJ/qcdPV4O1g9I1tm21B6box0ORXOjJIri\n" +
    "vcXuIwZJmoMifqGSctEjj4y6CyvwA22s4OnkFNuMrTml3EtNd31cvPyYYcZE66C9\n" +
    "Sp0m1a/NaVpWguP1TbPqj5LbXg2fP0buTXTwK5PFunUxQpnCOhJjsbJXCZqXCDdt\n" +
    "V92KaPkovWDJHAEuD0GeTJqO0wfZRWK5ALrWTXLBJKX5oFjNy5gdX6u/AW9Cwps+\n" +
    "vvslPlwVlvbfY2VafRkXV6+/sW0h2MILi6wNrMu/oSzLdtU3sXBFtZDdevaVa0eO\n" +
    "40CZ0HCgyJ9T8g59PE4fLRL9MSPuGEO8ICywzR/oEQKBgQD+cH9zpZX+JxRRURXw\n" +
    "39UCQKeWLrbltQEzejob3P4MWQr924QVHgtdfkN+ZXAWbbbL/cmOrZ8FoF3FQGNn\n" +
    "Icc9LClLrnBgAx9lc15oGd4gXEcKzHXnKCaG60j++WplybsJq7WCpZy5Mn/uB8P4\n" +
    "RPeutKToE9sECviHpl1zEPZiPQKBgQDrsSR0rdNY5TzHhYYevIIsn+4tEe8kUHNn\n" +
    "xvRT9IGTuI3EMeIMq2Y+QWNEV1pzorPJEeLWjTNWXQZLY08Deb95CF12Qyat0tYq\n" +
    "/0cBP49y6MItHIav91+5a58NNxVTaeVssm3zh3Vo5D+sNV6jC2ChBOm04thv9Gtg\n" +
    "kDDqK/nAVQKBgQDzlJcvC1JwoNDemBW9J0swgNzu9YG6nnGr6lM+4W2EPKo9JK1p\n" +
    "2f1fX8UVd966WgYpe6g9oxEdvcyHTYDb9oZalbBi93g1MkgYQz4ZwsnXiP+p4trs\n" +
    "lI9tkkmrbvLgxyL7uxplHE7RLPsz0NNXFg9XfTBxzLBbSnVqx2WnBpIYsQKBgBwi\n" +
    "Tha7dSIEYyfx8VuT5voKsTSiEmjETbJSlnG7GwiWHB4SUkhu4UqHJaFPyBVLk6hp\n" +
    "wSkZO8qQWiL/nLvueYOqEvX9+A0BwNzrEf+9JZNy41LdN9qjbcLFbPv32kzVtDQw\n" +
    "bF2IiuRVcqBM0polzogJ/RfBiFJ826BwNdaOH0btAoGBAKq65nYIEj3p15RjsD7q\n" +
    "zvzvavUPRzR0TVle7Wggz5BRduWVWyli+li55teCePS04fI/NnAZshPyTuEDXIr4\n" +
    "o5I+F+ZnHQp7p0ByVf6gztXZ48+vV5Axgbfm2gZ/8z/Zkc+4KEBD1vovNXpDxYOV\nwIWgFnD4GyJKHnT2WcgezDGk\n" +
    "-----END PRIVATE KEY-----\n";

  function getProps() {
    return typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  }

  function getPrivateKeyPem() {
    var props = getProps();
    return (props && props.getProperty('FINPESS_RSA_PRIVATE_KEY')) || DEFAULT_RSA_PRIVATE_KEY_PEM;
  }

  function getWebhookSecret(gatewayName) {
    var props = getProps();
    var key = 'WEBHOOK_SECRET_' + String(gatewayName || '').toUpperCase();
    return (props && props.getProperty(key)) || ('secret_' + String(gatewayName || '').toLowerCase() + '_prod');
  }

  /**
   * Gera um serial aleatório e não previsível no formato FINP-XXXX-XXXX-XXXX
   * Utiliza CSPRNG (crypto.randomBytes ou Utilities.getRandomBytes).
   */
  function generateRandomSerial() {
    var bytes = [];
    if (typeof Utilities !== 'undefined' && Utilities.getRandomBytes) {
      bytes = Utilities.getRandomBytes(12);
    } else {
      var crypto = require('crypto');
      bytes = crypto.randomBytes(12);
    }

    var chars = '';
    for (var i = 0; i < 12; i++) {
      var byteVal = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      chars += BASE32_ALPHABET.charAt(byteVal % BASE32_ALPHABET.length);
    }
    return 'FINP-' + chars.substring(0, 4) + '-' + chars.substring(4, 8) + '-' + chars.substring(8, 12);
  }

  /**
   * Assina criptograficamente o payload com RSA-SHA256 (Criptografia Assimétrica).
   * Somente o servidor possui a chave privada; o cliente verifica usando a chave pública.
   */
  function signPayloadAsymmetric(payloadObj) {
    var privKey = getPrivateKeyPem();
    var jsonStr = JSON.stringify(payloadObj);
    var signatureHex = '';

    if (typeof Utilities !== 'undefined' && Utilities.computeRsaSha256Signature) {
      var sigBytes = Utilities.computeRsaSha256Signature(jsonStr, privKey);
      signatureHex = sigBytes.map(function (b) {
        var byteVal = b < 0 ? b + 256 : b;
        return ('0' + byteVal.toString(16)).slice(-2);
      }).join('');
    } else {
      var crypto = require('crypto');
      var sign = crypto.sign('sha256', Buffer.from(jsonStr), privKey);
      signatureHex = sign.toString('hex');
    }

    var b64Payload = (typeof Utilities !== 'undefined' && Utilities.base64EncodeWebSafe)
      ? Utilities.base64EncodeWebSafe(jsonStr)
      : Buffer.from(jsonStr).toString('base64url');

    return b64Payload + '.' + signatureHex;
  }

  /**
   * Repositório comercial em memória para testes ou fallback do Google Sheets.
   */
  var inMemoryStore = {
    licenses: {
      'FINP-9876-5432-ABCD': {
        serial: 'FINP-9876-5432-ABCD',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      },
      'FINP-7K9M-2X5Q-8R4A': {
        serial: 'FINP-7K9M-2X5Q-8R4A',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      }
    },
    orders: {},
    installations: {}
  };

  function addLicenseToStore(lic) {
    if (!lic || !lic.serial) return;
    inMemoryStore.licenses[lic.serial] = lic;
  }

  function getLicenseFromStore(serial) {
    return inMemoryStore.licenses[serial] || null;
  }

  function resetInMemoryStore() {
    inMemoryStore.licenses = {
      'FINP-9876-5432-ABCD': {
        serial: 'FINP-9876-5432-ABCD',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      },
      'FINP-7K9M-2X5Q-8R4A': {
        serial: 'FINP-7K9M-2X5Q-8R4A',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      }
    };
    inMemoryStore.orders = {};
    inMemoryStore.installations = {};
  }

  /**
   * Ativação de serial para uma instalação do cliente
   */
  function handleActivate(params, customRepo) {
    var serial = String(params.serial || '').trim().toUpperCase();
    var instId = String(params.installation_id || '').trim();
    var sheetId = String(params.spreadsheet_id || '').trim();
    var email = String(params.email || '').trim().toLowerCase();

    if (!serial || !instId || !sheetId) {
      throw new Error('PARAMETROS_INVALIDOS: serial, installation_id e spreadsheet_id são obrigatórios.');
    }

    var repo = customRepo || {
      findLicense: function (s) { return inMemoryStore.licenses[s] || null; },
      saveInstallation: function (inst) { inMemoryStore.installations[inst.installation_id] = inst; }
    };

    var lic = repo.findLicense(serial);
    if (!lic) {
      // Se não cadastrado no banco comercial, o serial é desconhecido
      throw new Error('SERIAL_NAO_ENCONTRADO: O serial informado não existe ou não foi emitido pelo sistema oficial.');
    }

    if (lic.status === 'REVOKED') {
      throw new Error('LICENCA_REVOGADA: Este serial comercial foi revogado (reembolso ou cancelamento de pagamento).');
    }
    if (lic.status === 'EXPIRED') {
      throw new Error('LICENCA_EXPIRADA: A validade deste serial expirou.');
    }

    // Prevenção de reutilização de serial em múltiplas planilhas
    if (lic.spreadsheet_id && lic.spreadsheet_id !== sheetId) {
      throw new Error('SERIAL_JA_VINCULADO: Este serial já está ativado em outra planilha Google (' + lic.spreadsheet_id.substring(0, 8) + '...). Para transferir, solicite autorização de suporte.');
    }

    var tokenPayload = {
      serial: serial,
      installation_id: instId,
      spreadsheet_id: sheetId,
      email: email || lic.comprador_email || '',
      plan: lic.plano_codigo || 'COMPLETO',
      valid_until: lic.valido_ate || 'LIFETIME',
      issued_at: new Date().toISOString(),
      nonce: Math.random().toString(36).substring(2, 10)
    };

    var signedToken = signPayloadAsymmetric(tokenPayload);

    lic.status = 'ACTIVE';
    lic.spreadsheet_id = sheetId;
    lic.installation_id = instId;
    lic.primeira_ativacao_em = lic.primeira_ativacao_em || new Date().toISOString();

    repo.saveInstallation({
      serial: serial,
      installation_id: instId,
      spreadsheet_id: sheetId,
      comprador_email: email,
      status: 'ACTIVE'
    });

    return {
      ok: true,
      status: 'ACTIVE',
      plan: tokenPayload.plan,
      valid_until: tokenPayload.valid_until,
      token: signedToken,
      mensagem: 'Serial ativado com sucesso.'
    };
  }

  /**
   * Validação de autenticidade da assinatura de webhooks de provedores de pagamento.
   */
  function verifyWebhookSignature(gatewayName, rawBody, headers, queryParams) {
    var gw = String(gatewayName || '').toLowerCase();
    var secret = getWebhookSecret(gw);
    var h = headers || {};
    var q = queryParams || {};

    if (gw === 'mercadopago' || gw === 'mercado_pago') {
      var xSig = h['x-signature'] || h['X-Signature'] || '';
      var xReqId = h['x-request-id'] || h['X-Request-Id'] || '';
      if (!xSig) return { valid: false, error: 'WEBHOOK_ASSINATURA_AUSENTE: Cabeçalho x-signature ausente.' };

      var parts = {};
      xSig.split(',').forEach(function (part) {
        var kv = part.split('=');
        if (kv.length === 2) parts[kv[0].trim()] = kv[1].trim();
      });

      var ts = parts.ts;
      var v1 = parts.v1;
      if (!ts || !v1) return { valid: false, error: 'WEBHOOK_ASSINATURA_MALFORMADA: ts ou v1 ausentes.' };

      var bodyObj = typeof rawBody === 'string' ? JSON.parse(rawBody || '{}') : (rawBody || {});
      var dataId = (bodyObj.data && bodyObj.data.id) || bodyObj.id || '';
      var template = 'id:' + dataId + ';request-id:' + xReqId + ';ts:' + ts + ';';

      var expectedSig = '';
      if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
        var bytes = Utilities.computeHmacSha256Signature(template, secret);
        expectedSig = bytes.map(function (b) {
          var val = b < 0 ? b + 256 : b;
          return ('0' + val.toString(16)).slice(-2);
        }).join('');
      } else {
        var crypto = require('crypto');
        expectedSig = crypto.createHmac('sha256', secret).update(template).digest('hex');
      }

      if (v1 !== expectedSig) {
        return { valid: false, error: 'WEBHOOK_ASSINATURA_INVALIDA: Assinatura do Mercado Pago não confere.' };
      }
      return { valid: true };
    }

    if (gw === 'kiwify') {
      var kiwifySig = h['x-kiwify-signature'] || h['X-Kiwify-Signature'] || q.token || q.signature || '';
      if (!kiwifySig) return { valid: false, error: 'WEBHOOK_TOKEN_AUSENTE: Token Kiwify ausente.' };
      if (kiwifySig !== secret) return { valid: false, error: 'WEBHOOK_TOKEN_INVALIDO: Token Kiwify não confere.' };
      return { valid: true };
    }

    if (gw === 'hotmart') {
      var hotmartTok = h['x-hotmart-hottok'] || h['X-Hotmart-Hottok'] || (typeof rawBody === 'object' && rawBody.hottok) || '';
      if (!hotmartTok) return { valid: false, error: 'WEBHOOK_HOTTOK_AUSENTE: Hottok Hotmart ausente.' };
      if (hotmartTok !== secret) return { valid: false, error: 'WEBHOOK_HOTTOK_INVALIDO: Hottok Hotmart não confere.' };
      return { valid: true };
    }

    return { valid: false, error: 'GATEWAY_NAO_SUPORTADO: Provedor ' + gw + ' não reconhecido.' };
  }

  /**
   * Processamento protegido de Webhook de Pagamento com Idempotência e Tratamento de Estorno.
   */
  function handlePaymentWebhook(payload, headers, queryParams, customRepo) {
    var p = payload || {};
    var gateway = p.gateway || p.provider || (queryParams && (queryParams.gateway || queryParams.provider)) || 'mercadopago';

    // 1. Validação de Assinatura do Provedor
    var authCheck = verifyWebhookSignature(gateway, JSON.stringify(p), headers, queryParams);
    if (!authCheck.valid) {
      throw new Error(authCheck.error || 'WEBHOOK_NAO_AUTORIZADO');
    }

    var orderId = String(p.order_id || p.id || (p.data && p.data.id) || '').trim();
    if (!orderId) {
      throw new Error('PEDIDO_SEM_ID: Identificador do pedido ausente no payload.');
    }

    var repo = customRepo || {
      findOrder: function (oid) { return inMemoryStore.orders[oid] || null; },
      saveOrder: function (ord) { inMemoryStore.orders[ord.order_id] = ord; },
      saveLicense: function (lic) { inMemoryStore.licenses[lic.serial] = lic; },
      findLicenseBySerial: function (s) { return inMemoryStore.licenses[s] || null; }
    };

    var status = String(p.status || p.event || p.order_status || 'approved').toLowerCase();

    // 2. Tratamento de Estorno / Reembolso / Chargeback
    if (status === 'refunded' || status === 'charged_back' || status === 'cancelled' || status === 'reversed') {
      var existingOrder = repo.findOrder(orderId);
      if (existingOrder && existingOrder.serial) {
        var revLic = repo.findLicenseBySerial(existingOrder.serial);
        if (revLic) {
          revLic.status = 'REVOKED';
          revLic.motivo_revogacao = 'ESTORNO_OU_CHARGEBACK';
          revLic.revogado_em = new Date().toISOString();
        }
      }
      return {
        ok: true,
        action: 'REVOKE_PROCESSED',
        order_id: orderId,
        status: 'REVOKED'
      };
    }

    // 3. Validação de Status Positivo de Pagamento
    if (status !== 'approved' && status !== 'paid' && status !== 'complete') {
      return {
        ok: true,
        action: 'IGNORED_PENDING_STATUS',
        order_id: orderId,
        status: status
      };
    }

    // 4. Validação de Valor Monetário
    var amountCentavos = Number(p.amount_centavos || p.payment_amount || (p.transaction_amount ? Math.round(p.transaction_amount * 100) : 0));
    if (amountCentavos <= 0) {
      throw new Error('VALOR_PAGAMENTO_INVALIDO: O valor do pedido deve ser maior que zero.');
    }

    // 5. Garantia de Idempotência
    var existingOrderApproved = repo.findOrder(orderId);
    if (existingOrderApproved && existingOrderApproved.serial) {
      return {
        ok: true,
        idempotent: true,
        message: 'Pedido já processado anteriormente. Retornando serial existente.',
        order_id: orderId,
        serial: existingOrderApproved.serial,
        buyer_email: existingOrderApproved.email,
        plan: existingOrderApproved.plan_code
      };
    }

    var email = String((p.buyer && p.buyer.email) || (p.customer && p.customer.email) || (p.Comprador && p.Comprador.email) || (p.comprador && p.comprador.email) || p.email || '').trim().toLowerCase();
    if (!email) {
      throw new Error('EMAIL_COMPRADOR_AUSENTE: E-mail do comprador obrigatório para emissão de licença.');
    }

    var planCode = p.plan_code || (p.product && p.product.code) || 'COMPLETO';
    var serial = generateRandomSerial();

    var orderRecord = {
      order_id: orderId,
      gateway: gateway,
      email: email,
      plan_code: planCode,
      amount_centavos: amountCentavos,
      serial: serial,
      status: 'PAID',
      created_at: new Date().toISOString()
    };
    repo.saveOrder(orderRecord);

    var licenseRecord = {
      serial: serial,
      order_id: orderId,
      comprador_email: email,
      plano_codigo: planCode,
      status: 'AVAILABLE',
      valido_ate: planCode === 'ANNUAL' ? new Date(Date.now() + 365 * 86400000).toISOString() : 'LIFETIME',
      max_instalacoes: 1,
      instalacoes_ativas: 0,
      created_at: new Date().toISOString()
    };
    repo.saveLicense(licenseRecord);

    return {
      ok: true,
      idempotent: false,
      message: 'Pagamento autenticado com sucesso e serial comercial emitido.',
      order_id: orderId,
      serial: serial,
      buyer_email: email,
      plan: planCode
    };
  }

  /**
   * Seed de licença pré-aprovada para testes automatizados.
   */
  function seedTestLicense(serial, plan, validUntil, sheetId) {
    var lic = {
      serial: serial,
      plano_codigo: plan || 'COMPLETO',
      status: 'AVAILABLE',
      valido_ate: validUntil || 'LIFETIME',
      spreadsheet_id: sheetId || '',
      comprador_email: 'comprador@gmail.com',
      created_at: new Date().toISOString()
    };
    inMemoryStore.licenses[serial] = lic;
    return lic;
  }

  function resetStore() {
    inMemoryStore.licenses = {
      'FINP-9876-5432-ABCD': {
        serial: 'FINP-9876-5432-ABCD',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      },
      'FINP-7K9M-2X5Q-8R4A': {
        serial: 'FINP-7K9M-2X5Q-8R4A',
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        comprador_email: 'comprador@gmail.com'
      }
    };
    inMemoryStore.orders = {};
    inMemoryStore.installations = {};
  }

  return {
    generateRandomSerial: generateRandomSerial,
    signPayloadAsymmetric: signPayloadAsymmetric,
    verifyWebhookSignature: verifyWebhookSignature,
    handleActivate: handleActivate,
    handlePaymentWebhook: handlePaymentWebhook,
    seedTestLicense: seedTestLicense,
    resetStore: resetStore
  };
})();

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);
    var action = (e && e.parameter && e.parameter.action) || body.action || '';
    var headers = (e && e.headers) || {};
    var params = (e && e.parameter) || {};

    if (action === 'license.activate') {
      var resAct = LicensingServer.handleActivate(body);
      return ContentService.createTextOutput(JSON.stringify(resAct))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'payment.webhook') {
      var resPay = LicensingServer.handlePaymentWebhook(body, headers, params);
      return ContentService.createTextOutput(JSON.stringify(resPay))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'UNKNOWN_ACTION' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: 'Finpess Licensing API (RSA-2048 Asymmetric)',
    status: 'ONLINE',
    version: '2.1.0'
  })).setMimeType(ContentService.MimeType.JSON);
}
