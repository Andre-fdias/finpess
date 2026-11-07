/**
 * @file TelegramAuthService.gs
 * @description Vinculação segura de uso único entre conta autorizada do sistema e
 * identificador numérico do Telegram, validação de segredo do webhook e revogação.
 */

var TelegramAuthService = (function () {
  var CODE_EXPIRATION_MINUTES = 10;

  function computeSha256Hex(input) {
    var str = String(input || '');
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm) {
      var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
      var hex = '';
      for (var i = 0; i < digest.length; i++) {
        var byteVal = (digest[i] < 0 ? digest[i] + 256 : digest[i]);
        hex += ('0' + byteVal.toString(16)).slice(-2);
      }
      return hex;
    }
    // Fallback determinístico FNV-1a / DJB2 estendido caso Utilities não esteja carregado
    var h1 = 0xdeadbeef ^ str.length;
    var h2 = 0x41c6ce57 ^ str.length;
    for (var j = 0; j < str.length; j++) {
      var ch = str.charCodeAt(j);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function constantTimeEquals(a, b) {
    var strA = String(a || '');
    var strB = String(b || '');
    if (strA.length === 0 || strA.length !== strB.length) {
      return false;
    }
    var diff = 0;
    for (var i = 0; i < strA.length; i++) {
      diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * Valida o segredo configurado para o webhook do Telegram.
   */
  function validateWebhookSecret(providedSecret) {
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var expectedSecret = props ? props.getProperty('TELEGRAM_WEBHOOK_SECRET') : '';
    if (!expectedSecret) {
      throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED: Defina TELEGRAM_WEBHOOK_SECRET nas Propriedades do Script antes de processar requisições do Telegram.');
    }
    if (!constantTimeEquals(providedSecret, expectedSecret)) {
      AuditService.log({
        grupo_id: 'GLOBAL',
        usuario_id: 'ANONIMO',
        acao: 'WEBHOOK_TELEGRAM_SEGREDO_INVALIDO',
        entidade: 'TELEGRAM_VINCULOS',
        entidade_id: '',
        origem: 'TELEGRAM',
        detalhes: { motivo: 'Segredo do webhook ausente ou inválido' }
      });
      throw new Error('WEBHOOK_UNAUTHORIZED: Assinatura/segredo do webhook inválido.');
    }
    return true;
  }

  /**
   * Gera um código temporário de uso único para o usuário autenticado vincular sua conta ao bot.
   */
  function generateLinkingCode(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (user.status !== 'APROVADO') {
      throw new Error('Somente usuários aprovados podem gerar código de vinculação com o Telegram.');
    }

    // Invalida códigos pendentes anteriores do mesmo usuário
    var pendingCodes = SpreadsheetRepository.findByGrupo('TELEGRAM_VINCULOS', user.grupo_id, function (v) {
      return v.usuario_id === user.id && v.status_vinculo === 'AGUARDANDO_CODIGO';
    });
    for (var i = 0; i < pendingCodes.length; i++) {
      SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', pendingCodes[i].id, {
        status_vinculo: 'REVOGADO',
        codigo_usado: true,
        revogado_em: SpreadsheetRepository.nowIso()
      }, user.grupo_id);
    }

    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var rawToken = '';
    var randomPart = SpreadsheetRepository.generateId('code').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (var k = 0; k < 8; k++) {
      var idx = (randomPart.charCodeAt(k % randomPart.length) + k * 7) % alphabet.length;
      rawToken += alphabet.charAt(idx);
    }
    var plainCode = 'FIN-' + rawToken;
    var codeHash = computeSha256Hex(plainCode);
    var expiresAt = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60000).toISOString();

    var record = SpreadsheetRepository.insert('TELEGRAM_VINCULOS', {
      id: SpreadsheetRepository.generateId('tgv'),
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      telegram_user_id: '',
      telegram_chat_id: '',
      codigo_vinculacao_hash: codeHash,
      codigo_expira_em: expiresAt,
      codigo_usado: false,
      status_vinculo: 'AGUARDANDO_CODIGO',
      vinculado_em: '',
      revogado_em: ''
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CODIGO_VINCULACAO_TELEGRAM_GERADO',
      entidade: 'TELEGRAM_VINCULOS',
      entidade_id: record.id,
      origem: 'WEB',
      detalhes: { expira_em: expiresAt }
    });

    return {
      vinculo_id: record.id,
      codigo_temporario: plainCode,
      expira_em: expiresAt,
      instrucoes: 'Envie "/vincular ' + plainCode + '" para o bot do Telegram em até ' + CODE_EXPIRATION_MINUTES + ' minutos.'
    };
  }

  /**
   * Valida e consome o código de uso único enviado pelo usuário no Telegram.
   */
  function consumeLinkingCode(plainCodeInput, telegramUserId, telegramChatId) {
    if (!plainCodeInput || !telegramUserId || !telegramChatId) {
      throw new Error('Código de vinculação e identificadores do Telegram são obrigatórios.');
    }
    var normalizedCode = String(plainCodeInput).trim().toUpperCase();
    var targetHash = computeSha256Hex(normalizedCode);
    var now = SpreadsheetRepository.nowIso();

    var candidate = SpreadsheetRepository.findOne('TELEGRAM_VINCULOS', function (v) {
      return v.codigo_vinculacao_hash === targetHash;
    });

    if (!candidate) {
      AuditService.log({
        grupo_id: 'GLOBAL',
        usuario_id: 'ANONIMO',
        acao: 'TENTATIVA_VINCULO_CODIGO_INVALIDO',
        entidade: 'TELEGRAM_VINCULOS',
        entidade_id: String(telegramUserId),
        origem: 'TELEGRAM',
        detalhes: { telegram_user_id: String(telegramUserId) }
      });
      throw new Error('INVALID_LINK_CODE: Código de vinculação inválido ou inexistente.');
    }

    if (candidate.codigo_usado || candidate.status_vinculo !== 'AGUARDANDO_CODIGO') {
      throw new Error('CODE_ALREADY_USED: Este código de vinculação já foi utilizado ou revogado. Gere um novo código no sistema web.');
    }

    if (candidate.codigo_expira_em && candidate.codigo_expira_em < now) {
      SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', candidate.id, {
        codigo_usado: true,
        status_vinculo: 'REVOGADO',
        revogado_em: now
      });
      throw new Error('CODE_EXPIRED: O código de vinculação expirou. Gere um novo código no sistema web.');
    }

    var user = SpreadsheetRepository.findById('USUARIOS', candidate.usuario_id);
    if (!user || user.status !== 'APROVADO') {
      throw new Error('USER_NOT_APPROVED: O usuário associado ao código não está aprovado no sistema.');
    }

    // Revoga vínculos ativos anteriores deste mesmo usuário ou deste mesmo telegram_user_id
    var activeLinks = SpreadsheetRepository.findAll('TELEGRAM_VINCULOS', function (v) {
      return (
        v.status_vinculo === 'ATIVO' &&
        (v.usuario_id === user.id || String(v.telegram_user_id) === String(telegramUserId))
      );
    });
    for (var i = 0; i < activeLinks.length; i++) {
      SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', activeLinks[i].id, {
        status_vinculo: 'REVOGADO',
        revogado_em: now
      });
    }

    var activated = SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', candidate.id, {
      telegram_user_id: String(telegramUserId),
      telegram_chat_id: String(telegramChatId),
      codigo_usado: true,
      status_vinculo: 'ATIVO',
      vinculado_em: now
    }, user.grupo_id);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'TELEGRAM_VINCULADO',
      entidade: 'TELEGRAM_VINCULOS',
      entidade_id: activated.id,
      origem: 'TELEGRAM',
      detalhes: { telegram_user_id: String(telegramUserId) }
    });

    return {
      vinculo: activated,
      usuario: user
    };
  }

  /**
   * Localiza e valida o usuário autorizado a partir do telegram_user_id numérico.
   * Nunca confia em username ou nome exibido no Telegram.
   */
  function getAuthorizedUserByTelegramId(telegramUserId) {
    if (!telegramUserId) {
      throw new Error('TELEGRAM_UNAUTHORIZED: Remetente não identificado.');
    }
    var tgIdStr = String(telegramUserId);
    var activeLink = SpreadsheetRepository.findOne('TELEGRAM_VINCULOS', function (v) {
      return String(v.telegram_user_id) === tgIdStr && v.status_vinculo === 'ATIVO';
    });

    if (!activeLink) {
      AuditService.log({
        grupo_id: 'GLOBAL',
        usuario_id: 'ANONIMO',
        acao: 'TELEGRAM_ACESSO_NAO_AUTORIZADO',
        entidade: 'TELEGRAM_VINCULOS',
        entidade_id: tgIdStr,
        origem: 'TELEGRAM',
        detalhes: { telegram_user_id: tgIdStr, motivo: 'Sem vínculo ativo' }
      });
      throw new Error('TELEGRAM_UNAUTHORIZED: Sua conta do Telegram não está vinculada a um usuário autorizado. Acesse o sistema web > Configurações para gerar um código de vinculação.');
    }

    var user = SpreadsheetRepository.findById('USUARIOS', activeLink.usuario_id);
    if (!user || user.status !== 'APROVADO') {
      throw new Error('TELEGRAM_USER_BLOCKED: Sua conta no sistema não está aprovada ou foi bloqueada.');
    }

    return {
      usuario: user,
      vinculo: activeLink
    };
  }

  /**
   * Revoga o vínculo ativo do Telegram (pode ser acionado via web ou via comando /desvincular).
   */
  function revokeTelegramLink(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var links = SpreadsheetRepository.findByGrupo('TELEGRAM_VINCULOS', user.grupo_id, function (v) {
      return v.usuario_id === user.id && (v.status_vinculo === 'ATIVO' || v.status_vinculo === 'AGUARDANDO_CODIGO');
    });
    var now = SpreadsheetRepository.nowIso();
    for (var i = 0; i < links.length; i++) {
      SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', links[i].id, {
        status_vinculo: 'REVOGADO',
        codigo_usado: true,
        revogado_em: now
      }, user.grupo_id);
    }

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'TELEGRAM_REVOGADO',
      entidade: 'TELEGRAM_VINCULOS',
      entidade_id: user.id,
      origem: 'WEB',
      detalhes: { vinculos_revogados: links.length }
    });

    return { revogados: links.length };
  }

  function getLinkStatusForUser(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var active = SpreadsheetRepository.findOne('TELEGRAM_VINCULOS', function (v) {
      return v.grupo_id === user.grupo_id && v.usuario_id === user.id && v.status_vinculo === 'ATIVO';
    });
    return {
      vinculado: Boolean(active),
      vinculo: active ? {
        id: active.id,
        telegram_user_id: active.telegram_user_id,
        vinculado_em: active.vinculado_em
      } : null
    };
  }

  return {
    CODE_EXPIRATION_MINUTES: CODE_EXPIRATION_MINUTES,
    computeSha256Hex: computeSha256Hex,
    constantTimeEquals: constantTimeEquals,
    validateWebhookSecret: validateWebhookSecret,
    generateLinkingCode: generateLinkingCode,
    consumeLinkingCode: consumeLinkingCode,
    getAuthorizedUserByTelegramId: getAuthorizedUserByTelegramId,
    revokeTelegramLink: revokeTelegramLink,
    getLinkStatusForUser: getLinkStatusForUser
  };
})();

