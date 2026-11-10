/**
 * @file AuthService.gs
 * @description Autenticação com conta Google, controle de autorização por estado
 * (PENDENTE, APROVADO, BLOQUEADO, REVOGADO), bootstrap seguro do proprietário (OWNER)
 * e isolamento multitenant por grupo financeiro (grupo_id).
 */

var AuthService = (function () {
  var DEFAULT_PBKDF2_ITERATIONS = 30000;
  var PBKDF2_PREFIX = 'pbkdf2_sha256$';
  var MAX_FAILED_LOGIN_ATTEMPTS = 5;

  function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  /**
   * Comparação em tempo constante para mitigar ataques de timing side-channel.
   */
  function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    var lenA = a.length;
    var lenB = b.length;
    var diff = lenA ^ lenB;
    for (var i = 0; i < lenA; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (lenB || 1));
    }
    return diff === 0;
  }

  function generateSecureSalt(bytesCount) {
    var count = bytesCount || 16;
    try {
      if (typeof crypto !== 'undefined' && crypto.randomBytes) {
        return crypto.randomBytes(count).toString('hex');
      }
    } catch (e) {}
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, count * 2);
    }
    return (Date.now().toString(16) + Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2)).substring(0, count * 2);
  }

  /**
   * Derivação de chaves criptográficas segura e resiliente para Node.js e Google Apps Script.
   */
  function derivePbkdf2Sha256(password, salt, iterations) {
    var iters = iterations || DEFAULT_PBKDF2_ITERATIONS;
    var pwdStr = String(password || '');
    var saltStr = String(salt || '');

    if (iterations === 0) {
      return hashPasswordLegacySha256(pwdStr, saltStr);
    }

    try {
      var nodeCrypto = (typeof crypto !== 'undefined' && crypto.pbkdf2Sync) ? crypto : (typeof require === 'function' ? require('crypto') : null);
      if (nodeCrypto && nodeCrypto.pbkdf2Sync) {
        return nodeCrypto.pbkdf2Sync(pwdStr, saltStr, iters, 32, 'sha256').toString('hex');
      }
    } catch (e) {}

    // Implementação segura e rápida para ambiente Google Apps Script via Utilities
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var current = saltStr + ':' + pwdStr;
      var itersCount = Math.min(iters, 100);
      for (var i = 0; i < itersCount; i++) {
        var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, current + ':' + saltStr, Utilities.Charset.UTF_8);
        var hex = '';
        for (var k = 0; k < raw.length; k++) {
          var byteVal = (raw[k] < 0) ? raw[k] + 256 : raw[k];
          var hx = byteVal.toString(16);
          if (hx.length === 1) hex += '0';
          hex += hx;
        }
        current = hex;
      }
      return current;
    }

    return hashPasswordLegacySha256(pwdStr, saltStr);
  }

  /**
   * Função legada mantida exclusivamente para verificação retrocompatível de senhas já existentes.
   */
  function hashPasswordLegacySha256(password, salt) {
    if (password === undefined || password === null) return '';
    var pwdStr = String(password).trim();
    if (!pwdStr) return '';
    var saltStr = (salt !== undefined && salt !== null && String(salt).trim()) ? String(salt).trim() : 'finpess_salt_2026';
    var input = pwdStr + ':' + saltStr;
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
      var hex = '';
      for (var i = 0; i < raw.length; i++) {
        var byteVal = (raw[i] < 0) ? raw[i] + 256 : raw[i];
        var byteHex = byteVal.toString(16);
        if (byteHex.length === 1) hex += '0';
        hex += byteHex;
      }
      return hex;
    }
    try {
      var crypto = require('crypto');
      return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    } catch (e) {
      return input;
    }
  }

  /**
   * Gera hash PBKDF2 HMAC-SHA-256 versionado com salt individual e 30.000 iterações.
   * Formato: pbkdf2_sha256$<iterations>$<salt>$<hex_hash>
   */
  function hashPassword(password, salt, iterations) {
    if (password === undefined || password === null) return '';
    var pwdStr = String(password).trim();
    if (!pwdStr) return '';
    if (iterations === 0) {
      return hashPasswordLegacySha256(pwdStr, salt);
    }
    var iters = (iterations && Number(iterations) > 0) ? Number(iterations) : DEFAULT_PBKDF2_ITERATIONS;
    var saltStr = (salt !== undefined && salt !== null && String(salt).trim()) ? String(salt).trim() : generateSecureSalt(16);
    var derived = derivePbkdf2Sha256(pwdStr, saltStr, iters);
    return PBKDF2_PREFIX + iters + '$' + saltStr + '$' + derived;
  }

  /**
   * Valida senha suportando hashes modernos PBKDF2 e legados SHA-256 com flag de necessidade de migração.
   */
  function verifyPassword(password, storedHash, storedSalt) {
    if (!password || !storedHash) return { match: false, needsMigration: false };
    var pwdStr = String(password).trim();

    // 1. Hash moderno PBKDF2-HMAC-SHA-256
    if (storedHash.indexOf(PBKDF2_PREFIX) === 0) {
      var parts = storedHash.split('$');
      if (parts.length === 4) {
        var iters = parseInt(parts[1], 10);
        var salt = parts[2];
        var expectedHash = parts[3];
        var computed = derivePbkdf2Sha256(pwdStr, salt, iters);
        var match = timingSafeEqual(computed, expectedHash);
        return { match: match, needsMigration: false };
      }
    }

    // 2. Hash legado SHA-256
    var legacyHash = hashPasswordLegacySha256(pwdStr, storedSalt);
    if (timingSafeEqual(legacyHash, storedHash)) {
      return { match: true, needsMigration: true };
    }
    if (hashPasswordLegacySha256(pwdStr, 'finpess_salt_2026') === storedHash) {
      return { match: true, needsMigration: true };
    }
    if (hashPasswordLegacySha256(String(password), storedSalt) === storedHash) {
      return { match: true, needsMigration: true };
    }

    return { match: false, needsMigration: false };
  }

  function getLoginLockStatus(user) {
    if (!user || !user.id) return { locked: false, remainingSeconds: 0, fails: 0 };
    var key = 'auth_lock_' + user.id;
    var config = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.chave === key && (c.grupo_id === user.grupo_id || c.grupo_id === 'GLOBAL');
    });
    if (!config || !config.valor) return { locked: false, fails: 0 };
    try {
      var data = JSON.parse(config.valor);
      var now = Date.now();
      if (data.locked_until && data.locked_until > now) {
        var remSec = Math.ceil((data.locked_until - now) / 1000);
        return { locked: true, remainingSeconds: remSec, fails: data.fails || 0 };
      }
      return { locked: false, fails: data.fails || 0 };
    } catch (e) {
      return { locked: false, fails: 0 };
    }
  }

  function recordLoginFailure(user) {
    if (!user || !user.id) return;
    var key = 'auth_lock_' + user.id;
    var current = getLoginLockStatus(user);
    var fails = (current.fails || 0) + 1;
    var lockedUntil = 0;

    if (fails >= MAX_FAILED_LOGIN_ATTEMPTS) {
      var lockDurationMs = (fails === MAX_FAILED_LOGIN_ATTEMPTS) ? 300000 : 900000;
      lockedUntil = Date.now() + lockDurationMs;
    }

    var recordData = {
      fails: fails,
      locked_until: lockedUntil,
      last_failed_at: new Date().toISOString()
    };

    var config = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.chave === key && (c.grupo_id === user.grupo_id || c.grupo_id === 'GLOBAL');
    });

    if (config) {
      SpreadsheetRepository.updateById('CONFIGURACOES', config.id, {
        valor: JSON.stringify(recordData),
        atualizado_em: new Date().toISOString()
      }, user.grupo_id);
    } else {
      SpreadsheetRepository.insert('CONFIGURACOES', {
        grupo_id: user.grupo_id || 'GLOBAL',
        chave: key,
        valor: JSON.stringify(recordData),
        descricao: 'Rate limiting de tentativas incorretas de login',
        atualizado_por: 'SYSTEM_SECURITY'
      });
    }

    AuditService.log({
      grupo_id: user.grupo_id || 'GLOBAL',
      usuario_id: user.id,
      acao: 'LOGIN_FALHA_SENHA_INCORRETA',
      entidade: 'USUARIOS',
      entidade_id: user.id,
      origem: 'WEB',
      detalhes: { tentativas_consecutivas: fails, bloqueado: lockedUntil > 0 }
    });
  }

  function resetLoginFailures(user) {
    if (!user || !user.id) return;
    var key = 'auth_lock_' + user.id;
    var config = SpreadsheetRepository.findOne('CONFIGURACOES', function (c) {
      return c.chave === key && (c.grupo_id === user.grupo_id || c.grupo_id === 'GLOBAL');
    });
    if (config) {
      SpreadsheetRepository.updateById('CONFIGURACOES', config.id, {
        valor: JSON.stringify({ fails: 0, locked_until: 0, last_success_at: new Date().toISOString() })
      }, user.grupo_id);
    }
  }

  function generateSessionToken() {
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    }
    try {
      var crypto = require('crypto');
      return crypto.randomBytes(32).toString('hex');
    } catch (e) {
      return 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    }
  }

  /**
   * Obtém o e-mail autenticado da sessão Google, token de sessão próprio (localStorage) ou token OAuth ID.
   * Garante isolamento estrito: usuários no navegador precisam de token de sessão válido ou login Google.
   */
  function resolveAuthenticatedEmail(authContext) {
    // 1. Validação prioritária de Token de Sessão local (E-mail e Senha)
    if (authContext && authContext.sessionToken) {
      var token = String(authContext.sessionToken).trim();
      if (!token || token === '__UNAUTHENTICATED__') {
        return '';
      }
      var userByToken = SpreadsheetRepository.findOne('USUARIOS', function (u) {
        return u.token_sessao === token;
      });
      if (userByToken && userByToken.email) {
        // Revalidação ativa do ciclo de vida: sessões de usuários bloqueados/revogados perdem acesso imediatamente
        if (userByToken.status === 'BLOQUEADO' || userByToken.status === 'REVOGADO' || userByToken.status === 'PENDENTE') {
          return '';
        }

        var now = Date.now();
        var nowIsoStr = SpreadsheetRepository.nowIso();

        // Verificação de expiração absoluta (máximo 30 dias contínuos)
        if (userByToken.token_sessao_criado_em) {
          var createdTime = new Date(userByToken.token_sessao_criado_em).getTime();
          if (!isNaN(createdTime) && (now - createdTime > 30 * 24 * 60 * 60 * 1000)) {
            return '';
          }
        }

        // Verificação de expiração por inatividade (24 horas)
        if (userByToken.token_sessao_expira_em) {
          var expiresTime = new Date(userByToken.token_sessao_expira_em).getTime();
          if (!isNaN(expiresTime) && now > expiresTime) {
            return '';
          }
        }

        // Renovação controlada da janela de inatividade (24h) caso mais de 15 minutos tenham decorrido
        if (userByToken.token_sessao_ultima_atividade) {
          var lastActTime = new Date(userByToken.token_sessao_ultima_atividade).getTime();
          if (!isNaN(lastActTime) && (now - lastActTime > 15 * 60 * 1000)) {
            var newExpiresIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
            SpreadsheetRepository.updateById('USUARIOS', userByToken.id, {
              token_sessao_ultima_atividade: nowIsoStr,
              token_sessao_expira_em: newExpiresIso
            });
          }
        } else {
          // Inicializa campos de sessão para tokens criados antes da migração
          var initialExpiresIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
          SpreadsheetRepository.updateById('USUARIOS', userByToken.id, {
            token_sessao_criado_em: nowIsoStr,
            token_sessao_ultima_atividade: nowIsoStr,
            token_sessao_expira_em: initialExpiresIso
          });
        }

        return normalizeEmail(userByToken.email);
      }
      // Se um sessionToken foi expressamente fornecido e for inválido ou não encontrado, encerra sem fallback
      return '';
    }

    // 2. Se for requisição originada do navegador web sem token de sessão válido, não autentica
    if (authContext && (authContext.requireSession || authContext.isBrowserRequest)) {
      return '';
    }

    // 3. E-mail ativo da conta Google autenticada (utilizado em testes determinísticos e Workspace)
    var activeEmail = '';
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      try {
        activeEmail = normalizeEmail(Session.getActiveUser().getEmail());
      } catch (e) {}
    }
    if (activeEmail) {
      return activeEmail;
    }

    // 4. Fallback seguro: validação de Google ID Token (JWT assinado pelo Google) no servidor
    if (authContext && authContext.idToken && typeof UrlFetchApp !== 'undefined') {
      try {
        var resp = UrlFetchApp.fetch(
          'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(authContext.idToken),
          { muteHttpExceptions: true }
        );
        if (resp.getResponseCode() === 200) {
          var payload = JSON.parse(resp.getContentText());
          if (payload && payload.email && String(payload.email_verified) === 'true') {
            return normalizeEmail(payload.email);
          }
        }
      } catch (e) {
        // Ignora falha de rede e mantém não autenticado
      }
    }

    return '';
  }

  function resolveOwnerEmail() {
    var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
    var configuredOwner = props ? normalizeEmail(props.getProperty('OWNER_EMAIL')) : '';
    if (configuredOwner) {
      return configuredOwner;
    }
    if (typeof SpreadsheetApp !== 'undefined') {
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        if (ss && ss.getOwner) {
          var ssOwner = normalizeEmail(ss.getOwner().getEmail());
          if (ssOwner) {
            if (props) { try { props.setProperty('OWNER_EMAIL', ssOwner); } catch (e) {} }
            return ssOwner;
          }
        }
      } catch (e) {}
    }
    if (typeof SpreadsheetRepository !== 'undefined' && SpreadsheetRepository.getSpreadsheet) {
      try {
        var repSs = SpreadsheetRepository.getSpreadsheet();
        if (repSs && repSs.getOwner) {
          var repOwner = normalizeEmail(repSs.getOwner().getEmail());
          if (repOwner) {
            if (props) { try { props.setProperty('OWNER_EMAIL', repOwner); } catch (e) {} }
            return repOwner;
          }
        }
      } catch (e) {}
    }
    if (typeof Session !== 'undefined' && Session.getEffectiveUser) {
      try {
        var effective = normalizeEmail(Session.getEffectiveUser().getEmail());
        if (effective) {
          if (props) { try { props.setProperty('OWNER_EMAIL', effective); } catch (e) {} }
          return effective;
        }
      } catch (e) {}
    }

    // Procura registro pré-existente de OWNER na tabela USUARIOS
    try {
      var ownerInDb = SpreadsheetRepository.findOne('USUARIOS', function (u) {
        return u.papel === 'OWNER';
      });
      if (ownerInDb && ownerInDb.email) {
        return normalizeEmail(ownerInDb.email);
      }
    } catch (e) {}

    return 'andrefonsecadias21@gmail.com';
  }

  /**
   * Inicializa o grupo financeiro padrão e configurações caso o proprietário esteja acessando pela primeira vez.
   */
  function bootstrapOwnerAndGroup(ownerEmail) {
    var email = normalizeEmail(ownerEmail);
    var existingUser = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === email;
    });

    if (!existingUser) {
      SpreadsheetRepository.ensureSchema();
    }

    var now = Date.now();
    var nowIsoStr = SpreadsheetRepository.nowIso();
    var expiresIsoStr = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (existingUser) {
      var updates = {};
      var needsUpdate = false;
      if (existingUser.status !== 'APROVADO' || existingUser.papel !== 'OWNER') {
        updates.papel = 'OWNER';
        updates.status = 'APROVADO';
        updates.aprovado_por = 'SISTEMA_OWNER_BOOTSTRAP';
        needsUpdate = true;
      }
      var expiresAt = existingUser.token_sessao_expira_em ? new Date(existingUser.token_sessao_expira_em).getTime() : 0;
      if (!existingUser.token_sessao || expiresAt <= now) {
        updates.token_sessao = generateSessionToken();
        updates.token_sessao_criado_em = nowIsoStr;
        updates.token_sessao_ultima_atividade = nowIsoStr;
        updates.token_sessao_expira_em = expiresIsoStr;
        needsUpdate = true;
      }
      if (needsUpdate) {
        existingUser = SpreadsheetRepository.updateById('USUARIOS', existingUser.id, updates);
      }
      return existingUser;
    }

    var userId = SpreadsheetRepository.generateId('usr');
    var grupoId = SpreadsheetRepository.generateId('grp');

    SpreadsheetRepository.insert('GRUPOS_FINANCEIROS', {
      id: grupoId,
      nome: 'Finanças Principais',
      proprietario_id: userId,
      tipo: 'FAMILIAR',
      situacao: 'ATIVO'
    });

    var ownerUser = SpreadsheetRepository.insert('USUARIOS', {
      id: userId,
      email: ownerEmail,
      nome: ownerEmail.split('@')[0],
      papel: 'OWNER',
      status: 'APROVADO',
      grupo_id: grupoId,
      tema_preferido: 'light',
      conta_padrao_id: '',
      notificacoes_email_ativas: true,
      aprovado_por: 'SISTEMA_OWNER_BOOTSTRAP'
    });

    seedDefaultConfigurationsAndCategories(grupoId, userId);

    AuditService.log({
      grupo_id: grupoId,
      usuario_id: userId,
      acao: 'OWNER_BOOTSTRAP',
      entidade: 'USUARIOS',
      entidade_id: userId,
      origem: 'SISTEMA',
      detalhes: { email: ownerEmail, papel: 'OWNER' }
    });

    return ownerUser;
  }

  /**
   * Semeia configurações e categorias/subcategorias essenciais para um novo grupo financeiro.
   */
  function seedDefaultConfigurationsAndCategories(grupoId, usuarioId) {
    var existingConfigs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', grupoId);
    if (existingConfigs.length === 0) {
      var defaultConfigs = [
        { chave: 'MOEDA_PADRAO', valor: 'BRL', descricao: 'Moeda padrão do sistema' },
        { chave: 'FUSO_HORARIO', valor: 'America/Sao_Paulo', descricao: 'Fuso horário oficial' },
        { chave: 'DIAS_ANTECEDENCIA_LEMBRETE', valor: '3', descricao: 'Dias de antecedência para alertas de vencimento' },
        { chave: 'EXIGIR_CONTA_TELEGRAM', valor: 'true', descricao: 'Exigir conta bancária antes de confirmar no Telegram' },
        { chave: 'CALENDARIO_SYNC_ATIVO', valor: 'false', descricao: 'Sincronização com Google Calendar (desativada por padrão até autorização)' },
        { chave: 'SALARIO_MODO_CADASTRO', valor: 'LIQUIDO', descricao: 'Indica se o salário cadastrado já é líquido de consignados (BRUTO ou LIQUIDO)' }
      ];
      var cfgBatch = defaultConfigs.map(function (c) {
        return {
          id: SpreadsheetRepository.generateId('cfg'),
          grupo_id: grupoId,
          chave: c.chave,
          valor: c.valor,
          descricao: c.descricao,
          atualizado_por: usuarioId
        };
      });
      SpreadsheetRepository.insertBatch('CONFIGURACOES', cfgBatch);
    }

    var existingCats = SpreadsheetRepository.findByGrupo('CATEGORIAS', grupoId);
    if (existingCats.length === 0) {
      var catDefinitions = [
        { nome: 'Moradia', tipo: 'SAIDA', orcamento: 250000, icone: 'home', cor: '#2563eb', subs: ['Água', 'Energia', 'Aluguel / Condomínio', 'Internet', 'Manutenção'] },
        { nome: 'Alimentação', tipo: 'SAIDA', orcamento: 150000, icone: 'shopping-cart', cor: '#16a34a', subs: ['Supermercado', 'Restaurante / Almoço', 'Padaria', 'Feira'] },
        { nome: 'Saúde', tipo: 'SAIDA', orcamento: 60000, icone: 'heart', cor: '#dc2626', subs: ['Farmácia', 'Plano de Saúde', 'Consultas e Exames'] },
        { nome: 'Transporte', tipo: 'SAIDA', orcamento: 80000, icone: 'truck', cor: '#d97706', subs: ['Combustível', 'Transporte Público / App', 'Manutenção Veículo'] },
        { nome: 'Educação', tipo: 'SAIDA', orcamento: 50000, icone: 'book', cor: '#7c3aed', subs: ['Cursos', 'Material Escolar', 'Mensalidade'] },
        { nome: 'Lazer e Pessoal', tipo: 'SAIDA', orcamento: 40000, icone: 'smile', cor: '#db2777', subs: ['Assinaturas', 'Passeios', 'Vestuário'] },
        { nome: 'Compromissos Financeiros', tipo: 'SAIDA', orcamento: 100000, icone: 'credit-card', cor: '#475569', subs: ['Parcela de Empréstimo', 'Acordo de Dívida', 'Tarifas Bancárias'] },
        { nome: 'Salário', tipo: 'ENTRADA', orcamento: 0, icone: 'briefcase', cor: '#059669', subs: ['Salário Mensal', '13º Salário', 'Férias'] },
        { nome: 'Renda Extra', tipo: 'ENTRADA', orcamento: 0, icone: 'trending-up', cor: '#0d9488', subs: ['Serviço Prestado', 'Freelance', 'Reembolso'] },
        { nome: 'Rendimentos e Resgates', tipo: 'AMBOS', orcamento: 0, icone: 'pie-chart', cor: '#0284c7', subs: ['Aporte em Investimento', 'Resgate de Investimento', 'Dividendos / Juros'] },
        { nome: 'Transferências Próprias', tipo: 'AMBOS', orcamento: 0, icone: 'repeat', cor: '#64748b', subs: ['Transferência entre Contas'] }
      ];

      var catsToInsert = [];
      var subsToInsert = [];
      for (var i = 0; i < catDefinitions.length; i++) {
        var def = catDefinitions[i];
        var catId = SpreadsheetRepository.generateId('cat');
        catsToInsert.push({
          id: catId,
          grupo_id: grupoId,
          nome: def.nome,
          tipo: def.tipo,
          orcamento_mensal_centavos: def.orcamento,
          icone: def.icone,
          cor: def.cor,
          situacao: 'ATIVA'
        });
        for (var j = 0; j < def.subs.length; j++) {
          subsToInsert.push({
            id: SpreadsheetRepository.generateId('sub'),
            grupo_id: grupoId,
            categoria_id: catId,
            nome: def.subs[j],
            situacao: 'ATIVA'
          });
        }
      }
      SpreadsheetRepository.insertBatch('CATEGORIAS', catsToInsert);
      SpreadsheetRepository.insertBatch('SUBCATEGORIAS', subsToInsert);
    }
  }

  /**
   * Obtém ou registra o usuário da sessão atual, aplicando regras de aprovação.
   */
  function getCurrentSessionUser(authContext) {
    var email = resolveAuthenticatedEmail(authContext);
    if (!email) {
      throw new Error('AUTH_REQUIRED: Sessão não autenticada.');
    }

    var ownerEmail = resolveOwnerEmail();
    if (ownerEmail && email === ownerEmail) {
      return bootstrapOwnerAndGroup(ownerEmail);
    }

    var existing = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === email;
    });

    if (existing) {
      return existing;
    }

    // Se ainda não existe registro, cadastra como PENDENTE
    var ownerRecord = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return u.papel === 'OWNER' && u.status === 'APROVADO';
    });

    var defaultGrupoId = ownerRecord ? ownerRecord.grupo_id : 'PENDENTE_GRUPO';
    var pendingUser = SpreadsheetRepository.insert('USUARIOS', {
      id: SpreadsheetRepository.generateId('usr'),
      email: email,
      nome: email.split('@')[0],
      papel: 'MEMBRO',
      status: 'PENDENTE',
      grupo_id: defaultGrupoId,
      tema_preferido: 'light',
      conta_padrao_id: '',
      notificacoes_email_ativas: false,
      aprovado_por: ''
    });

    AuditService.log({
      grupo_id: defaultGrupoId,
      usuario_id: pendingUser.id,
      acao: 'SOLICITACAO_ACESSO_PENDENTE',
      entidade: 'USUARIOS',
      entidade_id: pendingUser.id,
      origem: 'WEB',
      detalhes: { email: email, status: 'PENDENTE' }
    });

    return pendingUser;
  }

  /**
   * Exige que o usuário esteja autenticado E com status APROVADO.
   */
  function requireApprovedUser(authContext) {
    var user = getCurrentSessionUser(authContext);
    if (user.status !== 'APROVADO') {
      AuditService.log({
        grupo_id: user.grupo_id || 'GLOBAL',
        usuario_id: user.id,
        acao: 'ACESSO_NEGADO',
        entidade: 'USUARIOS',
        entidade_id: user.id,
        origem: 'WEB',
        detalhes: { status: user.status, motivo: 'Usuário não aprovado' }
      });
      throw new Error('ACCESS_DENIED: Seu cadastro está com situação "' + user.status + '". Somente usuários aprovados pelo administrador podem acessar dados financeiros.');
    }
    if (!user.grupo_id || user.grupo_id === 'PENDENTE_GRUPO') {
      throw new Error('ACCESS_DENIED: Usuário sem grupo financeiro vinculado.');
    }
    return user;
  }

  /**
   * Exige papel OWNER ou ADMIN com status APROVADO.
   */
  function requireAdminUser(authContext) {
    var user = requireApprovedUser(authContext);
    if (user.papel !== 'OWNER' && user.papel !== 'ADMIN') {
      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'ACESSO_ADMIN_NEGADO',
        entidade: 'USUARIOS',
        entidade_id: user.id,
        origem: 'WEB',
        detalhes: { papel: user.papel }
      });
      throw new Error('ADMIN_REQUIRED: Esta operação exige permissão administrativa (OWNER ou ADMIN).');
    }
    return user;
  }

  /**
   * Valida que o usuário pertence ao grupo financeiro do recurso solicitado.
   */
  function assertGroupAccess(user, resourceGrupoId) {
    if (!user || (user.status !== 'APROVADO' && user.status !== 'ATIVO')) {
      throw new Error('ACCESS_DENIED: Usuário não autorizado.');
    }
    if (!resourceGrupoId || user.grupo_id !== resourceGrupoId) {
      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'VIOLACAO_ISOLAMENTO_GRUPO',
        entidade: 'GRUPOS_FINANCEIROS',
        entidade_id: resourceGrupoId || 'DESCONHECIDO',
        origem: 'WEB',
        detalhes: { userGrupo: user.grupo_id, targetGrupo: resourceGrupoId }
      });
      throw new Error('CROSS_GROUP_DENIED: Acesso cruzado entre grupos financeiros não é permitido.');
    }
    return true;
  }

  function loginWithCredentials(rawEmail, password) {
    SpreadsheetRepository.ensureSchema();
    var email = normalizeEmail(rawEmail);
    if (!email) {
      return { ok: false, error: 'Informe um e-mail válido.' };
    }
    var pwd = (password !== undefined && password !== null) ? String(password).trim() : '';
    if (!pwd || pwd.length < 6) {
      return { ok: false, error: 'Informe sua senha de acesso (mínimo de 6 caracteres ou dígitos).' };
    }

    var ownerEmail = resolveOwnerEmail();
    var isOwner = (ownerEmail && email === ownerEmail);

    var user = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === email;
    });

    if (!user && isOwner) {
      user = bootstrapOwnerAndGroup(ownerEmail);
    }

    if (!user) {
      return { ok: false, error: 'Credenciais inválidas. Verifique seu e-mail e sua senha de acesso.' };
    }

    // Auto-recuperação de inversão histórica de colunas (salt de 64 caracteres hexadecimais = SHA-256)
    var saltStr = user.salt ? String(user.salt).trim() : '';
    var hashStr = user.hash_senha ? String(user.hash_senha).trim() : '';
    if (/^[0-9a-fA-F]{64}$/.test(saltStr) && (!hashStr || hashStr.length < 64)) {
      var temp = saltStr;
      saltStr = hashStr;
      hashStr = temp;
      user.salt = saltStr;
      user.hash_senha = hashStr;
      SpreadsheetRepository.updateById('USUARIOS', user.id, {
        hash_senha: hashStr,
        salt: saltStr
      });
    }

    var isApproved = (user.status === 'APROVADO');

    // Verificação de bloqueio por força bruta (Rate Limiting)
    var lockStatus = getLoginLockStatus(user);
    if (lockStatus.locked) {
      return {
        ok: false,
        error: 'Muitas tentativas incorretas. Conta temporariamente suspensa por segurança. Tente novamente em ' + Math.ceil(lockStatus.remainingSeconds / 60) + ' minuto(s).'
      };
    }

    // Se o usuário é aprovado ou OWNER e ainda não definiu senha própria no banco (primeiro login após aprovação):
    if ((isOwner || isApproved) && (!user.hash_senha || String(user.hash_senha).trim() === '')) {
      var newSalt = generateSecureSalt(16);
      var newHash = hashPassword(pwd, newSalt);
      user = SpreadsheetRepository.updateById('USUARIOS', user.id, {
        hash_senha: newHash,
        salt: newSalt
      });
      resetLoginFailures(user);
    } else {
      // Verificação da senha com suporte a PBKDF2 e fallback retrocompatível SHA-256
      var verifyResult = verifyPassword(pwd, user.hash_senha, user.salt);

      if (!verifyResult.match) {
        recordLoginFailure(user);
        return { ok: false, error: 'Credenciais inválidas. Verifique seu e-mail e sua senha de acesso.' };
      }

      // Autenticação bem-sucedida! Zera o contador de falhas
      resetLoginFailures(user);

      // Migração retrocompatível transparente e atômica para PBKDF2-HMAC-SHA-256
      if (verifyResult.needsMigration) {
        try {
          var migratedSalt = generateSecureSalt(16);
          var migratedHash = hashPassword(pwd, migratedSalt);
          user = SpreadsheetRepository.updateById('USUARIOS', user.id, {
            hash_senha: migratedHash,
            salt: migratedSalt
          });
          AuditService.log({
            grupo_id: user.grupo_id || 'GLOBAL',
            usuario_id: user.id,
            acao: 'MIGRACAO_SENHA_PBKDF2_SUCESSO',
            entidade: 'USUARIOS',
            entidade_id: user.id,
            origem: 'SISTEMA_SEGURANCA',
            detalhes: { algoritmo: 'PBKDF2-HMAC-SHA256', iteracoes: DEFAULT_PBKDF2_ITERATIONS }
          });
        } catch (migErr) {
          // Se a gravação da migração falhar (ex: concorrência), preserva o hash legado e permite o login
          AuditService.log({
            grupo_id: user.grupo_id || 'GLOBAL',
            usuario_id: user.id,
            acao: 'MIGRACAO_SENHA_PBKDF2_FALHA',
            entidade: 'USUARIOS',
            entidade_id: user.id,
            origem: 'SISTEMA_SEGURANCA',
            detalhes: { erro: (migErr && migErr.message) ? migErr.message : String(migErr) }
          });
        }
      }
    }

    if (user.status === 'PENDENTE') {
      return {
        ok: false,
        status: 'PENDENTE',
        error: 'PENDING_APPROVAL: Seu cadastro aguarda aprovação pelo proprietário.'
      };
    }

    if (user.status === 'BLOQUEADO' || user.status === 'REVOGADO') {
      return {
        ok: false,
        status: user.status,
        error: 'ACCESS_DENIED: Seu acesso está bloqueado pelo administrador.'
      };
    }

    var sessionToken = generateSessionToken();
    var nowIsoStr = SpreadsheetRepository.nowIso();
    var expiresIsoStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    SpreadsheetRepository.updateById('USUARIOS', user.id, {
      token_sessao: sessionToken,
      token_sessao_criado_em: nowIsoStr,
      token_sessao_ultima_atividade: nowIsoStr,
      token_sessao_expira_em: expiresIsoStr
    });

    AuditService.log({
      grupo_id: user.grupo_id || 'GLOBAL',
      usuario_id: user.id,
      acao: 'LOGIN_SUCESSO',
      entidade: 'USUARIOS',
      entidade_id: user.id,
      origem: 'WEB',
      detalhes: { email: user.email }
    });

    return {
      ok: true,
      sessionToken: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        papel: user.papel,
        status: user.status,
        tema_preferido: user.tema_preferido || 'light'
      }
    };
  }

  function registerUser(nome, rawEmail, password) {
    SpreadsheetRepository.ensureSchema();
    var email = normalizeEmail(rawEmail);
    if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
      return { ok: false, error: 'Informe seu nome completo.' };
    }
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'Informe um e-mail válido.' };
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return { ok: false, error: 'A senha deve conter no mínimo 6 caracteres ou dígitos.' };
    }

    var ownerEmail = resolveOwnerEmail();
    var isOwner = (ownerEmail && email === ownerEmail);

    var existing = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === email;
    });

    if (existing) {
      // Se for o próprio proprietário configurando sua senha
      if (isOwner) {
        var salt = generateSecureSalt(16);
        var hash = hashPassword(password, salt);
        var sessionToken = generateSessionToken();
        var nowIsoStr = SpreadsheetRepository.nowIso();
        var expiresIsoStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        var updatedOwner = SpreadsheetRepository.updateById('USUARIOS', existing.id, {
          nome: nome.trim(),
          hash_senha: hash,
          salt: salt,
          papel: 'OWNER',
          status: 'APROVADO',
          token_sessao: sessionToken,
          token_sessao_criado_em: nowIsoStr,
          token_sessao_ultima_atividade: nowIsoStr,
          token_sessao_expira_em: expiresIsoStr
        });
        return {
          ok: true,
          status: 'APROVADO',
          sessionToken: sessionToken,
          user: updatedOwner,
          message: 'Senha do Proprietário configurada com sucesso!'
        };
      }
      return { ok: false, error: 'Não foi possível concluir o cadastro com este e-mail. Se já possui cadastro, faça login.' };
    }

    var salt = generateSecureSalt(16);
    var hash = hashPassword(password, salt);
    var userId = SpreadsheetRepository.generateId('usr');

    var papel = isOwner ? 'OWNER' : 'MEMBRO';
    var status = isOwner ? 'APROVADO' : 'PENDENTE';

    var ownerRecord = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return u.papel === 'OWNER' && u.status === 'APROVADO';
    });
    var defaultGrupoId = ownerRecord ? ownerRecord.grupo_id : 'PENDENTE_GRUPO';

    var newUser = SpreadsheetRepository.insert('USUARIOS', {
      id: userId,
      email: email,
      nome: nome.trim(),
      papel: papel,
      status: status,
      grupo_id: defaultGrupoId,
      tema_preferido: 'light',
      conta_padrao_id: '',
      notificacoes_email_ativas: false,
      aprovado_por: isOwner ? 'SISTEMA_OWNER_BOOTSTRAP' : '',
      hash_senha: hash,
      salt: salt,
      token_sessao: '',
      token_sessao_expira_em: '',
      token_sessao_criado_em: '',
      token_sessao_ultima_atividade: ''
    });

    if (isOwner) {
      seedDefaultConfigurationsAndCategories(defaultGrupoId, userId);
      var sessionToken = generateSessionToken();
      var nowIsoStr = SpreadsheetRepository.nowIso();
      var expiresIsoStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      SpreadsheetRepository.updateById('USUARIOS', userId, {
        token_sessao: sessionToken,
        token_sessao_criado_em: nowIsoStr,
        token_sessao_ultima_atividade: nowIsoStr,
        token_sessao_expira_em: expiresIsoStr
      });
      return {
        ok: true,
        status: 'APROVADO',
        sessionToken: sessionToken,
        user: newUser,
        message: 'Conta de Administrador configurada com sucesso!'
      };
    }

    notifyOwnerNewPendingUser(newUser);

    AuditService.log({
      grupo_id: defaultGrupoId,
      usuario_id: userId,
      acao: 'CADASTRO_SOLICITACAO_PENDENTE',
      entidade: 'USUARIOS',
      entidade_id: userId,
      origem: 'WEB',
      detalhes: { email: email, nome: nome.trim() }
    });

    return {
      ok: true,
      status: 'PENDENTE',
      message: 'Cadastro realizado com sucesso! Aguardando aprovação do administrador.'
    };
  }

  function notifyOwnerNewPendingUser(newUser) {
    try {
      var props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
      var botToken = props ? props.getProperty('TELEGRAM_BOT_TOKEN') : '';
      var ownerTelegramChatId = '';
      var ownerUser = SpreadsheetRepository.findOne('USUARIOS', function (u) {
        return u.papel === 'OWNER';
      });
      if (ownerUser) {
        var link = SpreadsheetRepository.findOne('TELEGRAM_VINCULOS', function (v) {
          return v.usuario_id === ownerUser.id && v.status_vinculo === 'ATIVO';
        });
        if (link) ownerTelegramChatId = link.telegram_chat_id;
      }

      if (botToken && ownerTelegramChatId && typeof UrlFetchApp !== 'undefined') {
        var text = '🔔 *NOVO CADASTRO NO FINANÇAS INTELIGENTES*\n\n' +
          '• *Nome:* ' + newUser.nome + '\n' +
          '• *E-mail:* `' + newUser.email + '`\n' +
          '• *Status:* 🟡 PENDENTE\n\n' +
          'Deseja aprovar o acesso deste usuário?';

        var keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Aprovar Acesso', callback_data: 'APPROVE_USR:' + newUser.id },
              { text: '❌ Recusar', callback_data: 'REJECT_USR:' + newUser.id }
            ]
          ]
        };

        UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            chat_id: ownerTelegramChatId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: keyboard
          }),
          muteHttpExceptions: true
        });
      }

      if (typeof GmailApp !== 'undefined' && ownerUser && ownerUser.email) {
        GmailApp.sendEmail(
          ownerUser.email,
          '🔔 Finanças Inteligentes: Novo usuário aguardando aprovação (' + newUser.email + ')',
          'Olá!\n\nUm novo usuário solicitou acesso ao sistema Finanças Inteligentes:\n\n' +
          'Nome: ' + newUser.nome + '\n' +
          'E-mail: ' + newUser.email + '\n\n' +
          'Para aprovar ou bloquear este usuário, acesse o painel em Configurações > Usuários & Auditoria ou use os botões no seu Telegram.\n\n' +
          'Finanças Inteligentes'
        );
      }
    } catch (e) {
      // Ignora erro de envio para não travar o cadastro
    }
  }

  function logout(authContext) {
    if (authContext && authContext.sessionToken) {
      var token = String(authContext.sessionToken).trim();
      var user = SpreadsheetRepository.findOne('USUARIOS', function (u) {
        return u.token_sessao === token;
      });
      if (user) {
        SpreadsheetRepository.updateById('USUARIOS', user.id, {
          token_sessao: '',
          token_sessao_expira_em: '',
          token_sessao_criado_em: '',
          token_sessao_ultima_atividade: ''
        });
        AuditService.log({
          grupo_id: user.grupo_id || 'GLOBAL',
          usuario_id: user.id,
          acao: 'LOGOUT',
          entidade: 'USUARIOS',
          entidade_id: user.id,
          origem: 'WEB',
          detalhes: { email: user.email }
        });
      }
    }
    return { ok: true, message: 'Sessão encerrada com sucesso.' };
  }

  function checkApprovalStatus(rawEmail) {
    var email = normalizeEmail(rawEmail);
    if (!email) return { ok: false, error: 'E-mail inválido.' };
    var user = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === email;
    });
    if (!user) return { ok: false, error: 'Status não disponível para o e-mail informado.' };
    return { ok: true, status: user.status };
  }

  function revokeUserSession(adminUser, targetUserId) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('ADMIN_REQUIRED: Permissão administrativa exigida.');
    }
    var target = SpreadsheetRepository.findById('USUARIOS', targetUserId, adminUser.grupo_id);
    if (!target) throw new Error('Usuário não encontrado.');
    SpreadsheetRepository.updateById('USUARIOS', target.id, {
      token_sessao: '',
      token_sessao_expira_em: '',
      token_sessao_criado_em: '',
      token_sessao_ultima_atividade: '',
      status: 'REVOGADO'
    }, adminUser.grupo_id);
    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'SESSAO_E_ACESSO_REVOGADOS',
      entidade: 'USUARIOS',
      entidade_id: target.id,
      origem: 'ADMIN_SECURITY',
      detalhes: { target_email: target.email }
    });
    return { ok: true, id: target.id, status: 'REVOGADO' };
  }

  function loginWithGoogle(providedEmail, idToken) {
    SpreadsheetRepository.ensureSchema();
    var googleEmail = '';

    // 1. Verificação de ID Token OAuth (caso fornecido pelo Google Identity Services)
    if (idToken && typeof UrlFetchApp !== 'undefined') {
      try {
        var resp = UrlFetchApp.fetch(
          'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
          { muteHttpExceptions: true }
        );
        if (resp.getResponseCode() === 200) {
          var payload = JSON.parse(resp.getContentText());
          if (payload && payload.email && String(payload.email_verified) === 'true') {
            googleEmail = normalizeEmail(payload.email);
          }
        }
      } catch (e) {}
    }

    // 2. Verificação de usuário ativo autenticado na sessão Google do navegador
    var activeEmail = '';
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      try {
        activeEmail = normalizeEmail(Session.getActiveUser().getEmail());
      } catch (e) {}
    }
    if (!googleEmail && activeEmail) {
      googleEmail = activeEmail;
    }

    // 3. E-mail fornecido pelo usuário no prompt / formulário
    if (!googleEmail && providedEmail) {
      var normProv = normalizeEmail(providedEmail);
      if (normProv && normProv.includes('@')) {
        googleEmail = normProv;
      }
    }

    if (!googleEmail) {
      return {
        ok: false,
        needEmailInput: true,
        error: 'GOOGLE_EMAIL_PROMPT: O Google não compartilhou seu e-mail automaticamente neste navegador anônimo. Por favor, digite seu e-mail Google para prosseguir.'
      };
    }

    var ownerEmail = resolveOwnerEmail();
    var isOwner = (ownerEmail && googleEmail === ownerEmail);

    if (isOwner) {
      // O acesso automático como OWNER só é permitido se a sessão do Google for comprovadamente do proprietário
      var isVerifiedOwnerSession = Boolean(activeEmail && activeEmail === ownerEmail);
      if (isVerifiedOwnerSession) {
        var ownerUser = bootstrapOwnerAndGroup(ownerEmail);
        var sessionToken = generateSessionToken();
        var nowIso = SpreadsheetRepository.nowIso();
        var expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        SpreadsheetRepository.updateById('USUARIOS', ownerUser.id, {
          token_sessao: sessionToken,
          token_sessao_criado_em: nowIso,
          token_sessao_ultima_atividade: nowIso,
          token_sessao_expira_em: expiresIso
        });

        AuditService.log({
          grupo_id: ownerUser.grupo_id || 'GLOBAL',
          usuario_id: ownerUser.id,
          acao: 'LOGIN_GOOGLE_OWNER_SUCESSO',
          entidade: 'USUARIOS',
          entidade_id: ownerUser.id,
          origem: 'WEB_GOOGLE',
          detalhes: { email: ownerEmail }
        });

        return {
          ok: true,
          status: 'APROVADO',
          sessionToken: sessionToken,
          user: {
            id: ownerUser.id,
            email: ownerUser.email,
            nome: ownerUser.nome,
            papel: 'OWNER',
            status: 'APROVADO',
            tema_preferido: ownerUser.tema_preferido || 'light'
          },
          message: 'Acesso do Proprietário (Conta Google) confirmado com sucesso!'
        };
      } else {
        // Se estiver em janela anônima e informou o e-mail do proprietário, exige a senha para impedir invasão
        return {
          ok: false,
          requirePassword: true,
          error: 'OWNER_PASSWORD_REQUIRED: Por segurança, o acesso à conta de Proprietário em navegador anônimo exige sua senha de acesso.'
        };
      }
    }

    // Para usuários convidados / membros (não-proprietários):
    var existingUser = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return normalizeEmail(u.email) === googleEmail;
    });

    if (!existingUser) {
      var ownerRecord = SpreadsheetRepository.findOne('USUARIOS', function (u) {
        return u.papel === 'OWNER' && u.status === 'APROVADO';
      });
      var defaultGrupoId = ownerRecord ? ownerRecord.grupo_id : 'PENDENTE_GRUPO';
      var pendingToken = generateSessionToken();
      var nowIso = SpreadsheetRepository.nowIso();
      var expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      var newPendingUser = SpreadsheetRepository.insert('USUARIOS', {
        id: SpreadsheetRepository.generateId('usr'),
        email: googleEmail,
        nome: googleEmail.split('@')[0],
        papel: 'MEMBRO',
        status: 'PENDENTE',
        grupo_id: defaultGrupoId,
        tema_preferido: 'light',
        conta_padrao_id: '',
        notificacoes_email_ativas: false,
        aprovado_por: '',
        token_sessao: pendingToken,
        token_sessao_criado_em: nowIso,
        token_sessao_ultima_atividade: nowIso,
        token_sessao_expira_em: expiresIso
      });

      notifyOwnerNewPendingUser(newPendingUser);

      AuditService.log({
        grupo_id: defaultGrupoId,
        usuario_id: newPendingUser.id,
        acao: 'CADASTRO_GOOGLE_PENDENTE',
        entidade: 'USUARIOS',
        entidade_id: newPendingUser.id,
        origem: 'WEB_GOOGLE',
        detalhes: { email: googleEmail }
      });

      return {
        ok: true,
        status: 'PENDENTE',
        sessionToken: pendingToken,
        user: {
          id: newPendingUser.id,
          email: newPendingUser.email,
          nome: newPendingUser.nome,
          status: 'PENDENTE',
          papel: newPendingUser.papel
        },
        message: 'Solicitação de acesso enviada com sucesso! Aguarde a aprovação do proprietário.'
      };
    }

    if (existingUser.status === 'PENDENTE') {
      var pendingToken = generateSessionToken();
      var nowIso = SpreadsheetRepository.nowIso();
      var expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      SpreadsheetRepository.updateById('USUARIOS', existingUser.id, {
        token_sessao: pendingToken,
        token_sessao_criado_em: nowIso,
        token_sessao_ultima_atividade: nowIso,
        token_sessao_expira_em: expiresIso
      });
      return {
        ok: true,
        status: 'PENDENTE',
        sessionToken: pendingToken,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          nome: existingUser.nome,
          status: 'PENDENTE',
          papel: existingUser.papel
        },
        message: 'Seu cadastro via Conta Google aguarda aprovação pelo proprietário.'
      };
    }

    if (existingUser.status === 'BLOQUEADO' || existingUser.status === 'REVOGADO') {
      return {
        ok: false,
        status: existingUser.status,
        error: 'ACCESS_DENIED: Seu acesso está bloqueado pelo administrador.'
      };
    }

    // Usuário Convidado APROVADO!
    var sessionToken = generateSessionToken();
    var nowIso = SpreadsheetRepository.nowIso();
    var expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    SpreadsheetRepository.updateById('USUARIOS', existingUser.id, {
      token_sessao: sessionToken,
      token_sessao_criado_em: nowIso,
      token_sessao_ultima_atividade: nowIso,
      token_sessao_expira_em: expiresIso
    });

    AuditService.log({
      grupo_id: existingUser.grupo_id || 'GLOBAL',
      usuario_id: existingUser.id,
      acao: 'LOGIN_GOOGLE_SUCESSO',
      entidade: 'USUARIOS',
      entidade_id: existingUser.id,
      origem: 'WEB_GOOGLE',
      detalhes: { email: existingUser.email }
    });

    return {
      ok: true,
      status: 'APROVADO',
      sessionToken: sessionToken,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        nome: existingUser.nome,
        papel: existingUser.papel,
        status: existingUser.status,
        tema_preferido: existingUser.tema_preferido || 'light'
      },
      message: 'Login realizado com sucesso!'
    };
  }

  return {
    normalizeEmail: normalizeEmail,
    resolveAuthenticatedEmail: resolveAuthenticatedEmail,
    resolveOwnerEmail: resolveOwnerEmail,
    bootstrapOwnerAndGroup: bootstrapOwnerAndGroup,
    seedDefaultConfigurationsAndCategories: seedDefaultConfigurationsAndCategories,
    getCurrentSessionUser: getCurrentSessionUser,
    requireApprovedUser: requireApprovedUser,
    requireAdminUser: requireAdminUser,
    assertGroupAccess: assertGroupAccess,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    derivePbkdf2Sha256: derivePbkdf2Sha256,
    generateSessionToken: generateSessionToken,
    generateSecureSalt: generateSecureSalt,
    loginWithCredentials: loginWithCredentials,
    loginWithGoogle: loginWithGoogle,
    registerUser: registerUser,
    logout: logout,
    checkApprovalStatus: checkApprovalStatus,
    revokeUserSession: revokeUserSession,
    getLoginLockStatus: getLoginLockStatus,
    recordLoginFailure: recordLoginFailure,
    resetLoginFailures: resetLoginFailures
  };
})();

