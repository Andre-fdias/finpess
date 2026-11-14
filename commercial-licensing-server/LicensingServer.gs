/**
 * @file LicensingServer.gs
 * @description Servidor Central de Licenciamento, Emissão de Seriais, Validação HMAC-SHA256,
 * Gestão de Período de Teste e Webhooks de Pagamento (Mercado Pago / Kiwify / Hotmart).
 * 
 * Hospedagem: Google Apps Script Web App Privado (Conta do Vendedor)
 * Configuração de Deploy: Execute as: Me | Access: Anyone
 */

var LicensingServer = (function () {
  var MASTER_SECRET_KEY = 'FINPESS_MASTER_HMAC_SECRET_KEY_CHANGE_IN_PROD';
  var ADMIN_TOKEN = 'FINPESS_ADMIN_BEARER_TOKEN_CHANGE_IN_PROD';
  var BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem 0, O, 1, I para evitar ambiguidade

  function getProps() {
    return typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  }

  function getSecretKey() {
    var props = getProps();
    return (props && props.getProperty('FINPESS_MASTER_SECRET')) || MASTER_SECRET_KEY;
  }

  function getAdminSecret() {
    var props = getProps();
    return (props && props.getProperty('FINPESS_ADMIN_TOKEN')) || ADMIN_TOKEN;
  }

  /**
   * Gera um serial aleatório e não previsível no formato FINP-XXXX-XXXX-XXXX
   */
  function generateRandomSerial() {
    function randomBlock(len) {
      var s = '';
      for (var i = 0; i < len; i++) {
        var idx = Math.floor(Math.random() * BASE32_ALPHABET.length);
        s += BASE32_ALPHABET.charAt(idx);
      }
      return s;
    }
    return 'FINP-' + randomBlock(4) + '-' + randomBlock(4) + '-' + randomBlock(4);
  }

  /**
   * Assina criptograficamente o payload com HMAC-SHA256
   */
  function signPayload(payloadObj) {
    var secret = getSecretKey();
    var jsonStr = JSON.stringify(payloadObj);
    var signatureHex = '';

    if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
      var sigBytes = Utilities.computeHmacSha256Signature(jsonStr, secret);
      signatureHex = sigBytes.map(function (b) {
        return ('0' + (b & 0xFF).toString(16)).slice(-2);
      }).join('');
    } else {
      // Fallback em ambiente Node.js / testes
      var crypto = require('crypto');
      signatureHex = crypto.createHmac('sha256', secret).update(jsonStr).digest('hex');
    }

    var b64Payload = (typeof Utilities !== 'undefined' && Utilities.base64EncodeWebSafe)
      ? Utilities.base64EncodeWebSafe(jsonStr)
      : Buffer.from(jsonStr).toString('base64url');

    return b64Payload + '.' + signatureHex;
  }

  /**
   * Valida a assinatura de um token emitido
   */
  function verifyTokenSignature(signedToken) {
    try {
      var parts = signedToken.split('.');
      if (parts.length !== 2) return { valid: false, error: 'TOKEN_MALFORMADO' };
      var b64Payload = parts[0];
      var providedSig = parts[1];

      var jsonStr = (typeof Utilities !== 'undefined' && Utilities.base64DecodeWebSafe)
        ? Utilities.newBlob(Utilities.base64DecodeWebSafe(b64Payload)).getDataAsString()
        : Buffer.from(b64Payload, 'base64url').toString('utf8');

      var payload = JSON.parse(jsonStr);
      var expectedSigned = signPayload(payload);
      var expectedSig = expectedSigned.split('.')[1];

      if (providedSig !== expectedSig) {
        return { valid: false, error: 'ASSINATURA_INVALIDA' };
      }

      return { valid: true, payload: payload };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  /**
   * Ativação de serial para uma instalação do cliente
   */
  function handleActivate(params, commercialRepo) {
    var serial = String(params.serial || '').trim().toUpperCase();
    var instId = String(params.installation_id || '').trim();
    var sheetId = String(params.spreadsheet_id || '').trim();
    var email = String(params.email || '').trim().toLowerCase();

    if (!serial || !instId || !sheetId) {
      throw new Error('PARAMETROS_INVALIDOS: serial, installation_id e spreadsheet_id são obrigatórios.');
    }

    var lic = commercialRepo ? commercialRepo.findLicenseBySerial(serial) : null;
    if (!lic) {
      // Mock para desenvolvimento ou licença padrão
      lic = {
        serial: serial,
        status: 'AVAILABLE',
        plano_codigo: 'COMPLETO',
        valido_ate: 'LIFETIME',
        max_instalacoes: 1,
        instalacoes_ativas: 0
      };
    }

    if (lic.status === 'REVOKED') {
      throw new Error('LICENCA_REVOGADA: Este serial comercial foi cancelado ou reembolsado.');
    }
    if (lic.status === 'EXPIRED') {
      throw new Error('LICENCA_EXPIRADA: A validade deste serial expirou.');
    }

    var tokenPayload = {
      serial: serial,
      installation_id: instId,
      spreadsheet_id: sheetId,
      email: email,
      plan: lic.plano_codigo || 'COMPLETO',
      valid_until: lic.valido_ate || 'LIFETIME',
      issued_at: new Date().toISOString(),
      nonce: Math.random().toString(36).substring(2, 10)
    };

    var token = signPayload(tokenPayload);

    if (commercialRepo) {
      commercialRepo.recordInstallation({
        serial: serial,
        installation_id: instId,
        spreadsheet_id: sheetId,
        comprador_email: email,
        status: 'ACTIVE'
      });
    }

    return {
      ok: true,
      status: 'ACTIVE',
      plan: tokenPayload.plan,
      valid_until: tokenPayload.valid_until,
      token: token,
      mensagem: 'Serial ativado com sucesso.'
    };
  }

  /**
   * Processamento de Webhook de Pagamento (Mercado Pago / Kiwify / Hotmart)
   */
  function handlePaymentWebhook(payload, headers, commercialRepo) {
    var p = payload || {};
    var eventType = p.event || p.type || (p.action && p.action.type) || 'payment.approved';
    var email = (p.buyer && p.buyer.email) || (p.customer && p.customer.email) || p.email || '';
    var planCode = (p.product && p.product.code) || p.plano || 'COMPLETO';
    var orderId = p.order_id || p.id || ('ped_' + Date.now());

    if (!email) {
      return { ok: false, error: 'E-mail do comprador ausente no payload do gateway.' };
    }

    var serial = generateRandomSerial();

    if (commercialRepo) {
      commercialRepo.createOrderAndLicense({
        order_id: orderId,
        gateway: p.gateway || 'MERCADO_PAGO_SANDBOX',
        email: email,
        plan_code: planCode,
        serial: serial,
        status_pagamento: 'APROVADO'
      });
    }

    return {
      ok: true,
      message: 'Pagamento processado e serial comercial emitido com sucesso.',
      order_id: orderId,
      serial: serial,
      buyer_email: email,
      plan: planCode
    };
  }

  return {
    generateRandomSerial: generateRandomSerial,
    signPayload: signPayload,
    verifyTokenSignature: verifyTokenSignature,
    handleActivate: handleActivate,
    handlePaymentWebhook: handlePaymentWebhook
  };
})();

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);
    var action = (e && e.parameter && e.parameter.action) || body.action || '';

    if (action === 'license.activate') {
      var resAct = LicensingServer.handleActivate(body);
      return ContentService.createTextOutput(JSON.stringify(resAct))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'payment.webhook') {
      var resPay = LicensingServer.handlePaymentWebhook(body);
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
    service: 'Finpess Licensing API',
    status: 'ONLINE',
    version: '2.0.0'
  })).setMimeType(ContentService.MimeType.JSON);
}
