/**
 * @file UserService.gs
 * @description Gestão de usuários, aprovação/bloqueio/revogação, preferências individuais
 * de tema (Claro / Escuro / Automático) persistidas no servidor e configurações do grupo.
 */

var UserService = (function () {
  function getProfileAndPreferences(user) {
    var grupo = SpreadsheetRepository.findById('GRUPOS_FINANCEIROS', user.grupo_id);
    var configs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', user.grupo_id);
    var configMap = {};
    for (var i = 0; i < configs.length; i++) {
      configMap[configs[i].chave] = configs[i].valor;
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        papel: user.papel,
        status: user.status,
        grupo_id: user.grupo_id,
        tema_preferido: user.tema_preferido || 'light',
        conta_padrao_id: user.conta_padrao_id || '',
        notificacoes_email_ativas: Boolean(user.notificacoes_email_ativas)
      },
      grupo: grupo,
      configuracoes: configMap
    };
  }

  /**
   * Atualiza a preferência de tema (light, dark, auto) ou preferências pessoais do usuário autenticado.
   */
  function updateUserPreferences(user, prefs) {
    if (!prefs || typeof prefs !== 'object') {
      throw new Error('Preferências inválidas.');
    }
    var patch = {};
    if (prefs.tema_preferido !== undefined) {
      var theme = String(prefs.tema_preferido).toLowerCase().trim();
      if (ValidationService.THEMES.indexOf(theme) === -1) {
        throw new Error('Tema inválido. Escolha entre: light, dark ou auto.');
      }
      patch.tema_preferido = theme;
    }
    if (prefs.nome !== undefined) {
      var nome = ValidationService.sanitizeText(prefs.nome, 100);
      if (!nome) throw new Error('O nome do usuário não pode ficar vazio.');
      patch.nome = nome;
    }
    if (prefs.conta_padrao_id !== undefined) {
      if (prefs.conta_padrao_id) {
        var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', prefs.conta_padrao_id, user.grupo_id);
        if (!acc) {
          throw new Error('Conta bancária padrão selecionada não pertence ao seu grupo financeiro.');
        }
        patch.conta_padrao_id = acc.id;
      } else {
        patch.conta_padrao_id = '';
      }
    }
    if (prefs.notificacoes_email_ativas !== undefined) {
      patch.notificacoes_email_ativas = Boolean(prefs.notificacoes_email_ativas);
    }

    var updated = SpreadsheetRepository.updateById('USUARIOS', user.id, patch);
    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'PREFERENCIAS_ATUALIZADAS',
      entidade: 'USUARIOS',
      entidade_id: user.id,
      origem: 'WEB',
      detalhes: patch
    });
    return updated;
  }

  /**
   * Lista usuários do grupo financeiro e solicitações pendentes (apenas OWNER/ADMIN),
   * anexando o último acesso registrado na auditoria e total de ações.
   */
  function listUsersForAdmin(adminUser) {
    if (!adminUser || (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN')) {
      throw new Error('ADMIN_REQUIRED: Permissão administrativa exigida.');
    }
    var users = SpreadsheetRepository.findAll('USUARIOS', function (u) {
      return u.grupo_id === adminUser.grupo_id || u.grupo_id === 'PENDENTE_GRUPO' || adminUser.papel === 'OWNER';
    });

    var auditLogs = SpreadsheetRepository.findAll('AUDITORIA');
    var lastAccessMap = {};
    for (var a = 0; a < auditLogs.length; a++) {
      var log = auditLogs[a];
      if (log.usuario_id && !lastAccessMap[log.usuario_id]) {
        lastAccessMap[log.usuario_id] = log.criado_em;
      }
    }

    return users.map(function (u) {
      return {
        id: u.id,
        email: u.email,
        nome: u.nome,
        papel: u.papel,
        status: u.status,
        grupo_id: u.grupo_id,
        criado_em: u.criado_em,
        atualizado_em: u.atualizado_em,
        aprovado_por: u.aprovado_por,
        ultimo_acesso: lastAccessMap[u.id] || u.atualizado_em || u.criado_em || 'Nunca acessou'
      };
    });
  }

  /**
   * Lista todos os membros aprovados do grupo financeiro para seleção de titularidade
   */
  function listGroupMembers(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var users = SpreadsheetRepository.findByGrupo('USUARIOS', user.grupo_id, function (u) {
      return u.status === 'APROVADO' || !u.status;
    });
    return users.map(function (u) {
      return {
        id: u.id,
        nome: u.nome || u.email,
        email: u.email,
        papel: u.papel
      };
    });
  }

  /**
   * Cadastra um novo usuário diretamente pela administração com perfil e senha inicial.
   */
  function createUserByAdmin(adminUser, payload) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária para cadastrar usuários.');
    }
    var p = payload || {};
    var rawEmail = String(p.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      throw new Error('E-mail informado é inválido.');
    }
    var email = rawEmail;
    var nome = ValidationService.sanitizeText(p.nome, 100);
    if (!nome) throw new Error('Informe o nome completo do usuário.');

    var senha = String(p.senha || '').trim();
    if (senha.length < 6) {
      throw new Error('A senha inicial deve ter no mínimo 6 caracteres ou dígitos.');
    }

    var existing = SpreadsheetRepository.findOne('USUARIOS', function (u) {
      return String(u.email || '').toLowerCase().trim() === email;
    });
    if (existing) {
      throw new Error('Este e-mail já está cadastrado no sistema.');
    }

    var validRole = p.papel ? ValidationService.validateEnum(p.papel, ValidationService.USER_ROLES, 'papel') : 'MEMBRO';
    if (validRole === 'OWNER' && adminUser.papel !== 'OWNER') {
      throw new Error('Somente o OWNER pode criar outro usuário com perfil OWNER.');
    }

    var validStatus = p.status ? ValidationService.validateEnum(p.status, ValidationService.USER_STATUSES, 'status') : 'APROVADO';

    var salt = (typeof AuthService !== 'undefined' && AuthService.generateSecureSalt)
      ? AuthService.generateSecureSalt(16)
      : SpreadsheetRepository.generateId('slt');
    var hash = AuthService.hashPassword(senha, salt);
    var userId = SpreadsheetRepository.generateId('usr');

    var newUser = SpreadsheetRepository.insert('USUARIOS', {
      id: userId,
      email: email,
      nome: nome,
      papel: validRole,
      status: validStatus,
      grupo_id: adminUser.grupo_id,
      tema_preferido: 'light',
      conta_padrao_id: '',
      notificacoes_email_ativas: true,
      criado_em: SpreadsheetRepository.nowIso(),
      atualizado_em: SpreadsheetRepository.nowIso(),
      aprovado_por: adminUser.id,
      hash_senha: hash,
      salt: salt,
      token_sessao: '',
      token_sessao_expira_em: '',
      token_sessao_criado_em: '',
      token_sessao_ultima_atividade: ''
    });

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'USUARIO_CRIADO_POR_ADMIN',
      entidade: 'USUARIOS',
      entidade_id: userId,
      origem: 'WEB',
      detalhes: {
        email: email,
        nome: nome,
        papel: validRole,
        status: validStatus
      }
    });

    return newUser;
  }

  /**
   * Atualiza dados de um usuário existente (nome, papel, status, senha opcional).
   */
  function updateUserByAdmin(adminUser, targetUserId, payload) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária.');
    }
    var target = SpreadsheetRepository.findById('USUARIOS', targetUserId);
    if (!target) throw new Error('Usuário não encontrado.');

    if (target.papel === 'OWNER' && target.id !== adminUser.id) {
      throw new Error('Não é permitido alterar as credenciais ou permissões do OWNER principal.');
    }

    var p = payload || {};
    var patch = {};

    if (p.nome) {
      patch.nome = ValidationService.sanitizeText(p.nome, 100);
    }

    if (p.papel) {
      var validRole = ValidationService.validateEnum(p.papel, ValidationService.USER_ROLES, 'papel');
      if (validRole === 'OWNER' && adminUser.papel !== 'OWNER') {
        throw new Error('Apenas o OWNER pode atribuir papel de OWNER.');
      }
      patch.papel = validRole;
    }

    if (p.status) {
      var validStatus = ValidationService.validateEnum(p.status, ValidationService.USER_STATUSES, 'status');
      if (target.papel === 'OWNER' && validStatus !== 'APROVADO') {
        throw new Error('O proprietário (OWNER) não pode ser desativado ou bloqueado.');
      }
      patch.status = validStatus;

      if (validStatus === 'BLOQUEADO' || validStatus === 'REVOGADO') {
        patch.token_sessao = '';
        patch.token_sessao_expira_em = '';
        patch.token_sessao_criado_em = '';
        patch.token_sessao_ultima_atividade = '';
        var links = SpreadsheetRepository.findAll('TELEGRAM_VINCULOS', function (v) {
          return v.usuario_id === target.id && v.status_vinculo === 'ATIVO';
        });
        for (var i = 0; i < links.length; i++) {
          SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', links[i].id, {
            status_vinculo: 'REVOGADO',
            revogado_em: SpreadsheetRepository.nowIso()
          });
        }
      }
    }

    if (p.nova_senha !== undefined && p.nova_senha !== null && String(p.nova_senha).trim() !== '') {
      var novaSenhaStr = String(p.nova_senha).trim();
      if (novaSenhaStr.length < 6) {
        throw new Error('A nova senha deve ter no mínimo 6 dígitos ou caracteres.');
      }
      var newSalt = AuthService.generateSecureSalt(16);
      patch.salt = newSalt;
      patch.hash_senha = AuthService.hashPassword(novaSenhaStr, newSalt);
      patch.token_sessao = ''; // Força novo login
      patch.token_sessao_expira_em = '';
      patch.token_sessao_criado_em = '';
      patch.token_sessao_ultima_atividade = '';
    }

    patch.atualizado_em = SpreadsheetRepository.nowIso();
    var updated = SpreadsheetRepository.updateById('USUARIOS', target.id, patch);

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'USUARIO_EDITADO_POR_ADMIN',
      entidade: 'USUARIOS',
      entidade_id: target.id,
      origem: 'WEB',
      detalhes: {
        email: target.email,
        camposAlterados: Object.keys(patch)
      }
    });

    return updated;
  }

  /**
   * Retorna os dados completos do cadastro de um usuário e seus logs de acesso/atividades recentes.
   */
  function getUserDetails(adminUser, targetUserId) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária.');
    }
    var target = SpreadsheetRepository.findById('USUARIOS', targetUserId);
    if (!target) throw new Error('Usuário não encontrado.');

    // Busca histórico de auditoria e acessos deste usuário
    var allAudit = SpreadsheetRepository.findAll('AUDITORIA');
    var userLogs = [];
    for (var i = allAudit.length - 1; i >= 0; i--) {
      var item = allAudit[i];
      if (item.usuario_id === target.id || (item.detalhes && item.detalhes.email === target.email)) {
        userLogs.push(item);
        if (userLogs.length >= 15) break;
      }
    }

    return {
      usuario: {
        id: target.id,
        nome: target.nome,
        email: target.email,
        papel: target.papel,
        status: target.status,
        grupo_id: target.grupo_id,
        tema_preferido: target.tema_preferido,
        conta_padrao_id: target.conta_padrao_id,
        notificacoes_email_ativas: target.notificacoes_email_ativas,
        criado_em: target.criado_em,
        atualizado_em: target.atualizado_em,
        aprovado_por: target.aprovado_por
      },
      logs_acesso: userLogs
    };
  }

  /**
   * Exclui um usuário do sistema, com estrita proteção ao OWNER principal.
   */
  function deleteUserByAdmin(adminUser, targetUserId) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária.');
    }
    var target = SpreadsheetRepository.findById('USUARIOS', targetUserId);
    if (!target) throw new Error('Usuário não encontrado.');

    if (target.papel === 'OWNER') {
      throw new Error('O proprietário do sistema (OWNER) não pode ser excluído.');
    }
    if (target.id === adminUser.id) {
      throw new Error('Você não pode excluir sua própria conta enquanto estiver logado.');
    }

    // Revoga vínculos do Telegram
    var links = SpreadsheetRepository.findAll('TELEGRAM_VINCULOS', function (v) {
      return v.usuario_id === target.id;
    });
    for (var i = 0; i < links.length; i++) {
      SpreadsheetRepository.deleteById('TELEGRAM_VINCULOS', links[i].id);
    }

    SpreadsheetRepository.deleteById('USUARIOS', target.id);

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'USUARIO_EXCLUIDO_POR_ADMIN',
      entidade: 'USUARIOS',
      entidade_id: target.id,
      origem: 'WEB',
      detalhes: {
        email: target.email,
        nome: target.nome,
        papel: target.papel
      }
    });

    return { ok: true, id: target.id };
  }

  /**
   * Altera o status de autorização (PENDENTE, APROVADO, BLOQUEADO, REVOGADO) ou papel de um usuário.
   */
  function changeUserAuthorization(adminUser, targetUserId, newStatus, newRole, targetGrupoId) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária.');
    }
    var target = SpreadsheetRepository.findById('USUARIOS', targetUserId);
    if (!target) {
      throw new Error('Usuário alvo não encontrado.');
    }
    if (target.papel === 'OWNER' && target.id !== adminUser.id) {
      throw new Error('Não é permitido bloquear ou alterar o proprietário administrativo (OWNER).');
    }
    var validStatus = newStatus ? ValidationService.validateEnum(newStatus, ValidationService.USER_STATUSES, 'status') : target.status;
    var validRole = newRole ? ValidationService.validateEnum(newRole, ValidationService.USER_ROLES, 'papel') : target.papel;
    if (validRole === 'OWNER' && adminUser.papel !== 'OWNER') {
      throw new Error('Somente o OWNER pode atribuir papel OWNER.');
    }

    var assignedGrupoId = targetGrupoId || adminUser.grupo_id;
    var updatePayload = {
      status: validStatus,
      papel: validRole,
      grupo_id: assignedGrupoId,
      aprovado_por: adminUser.id
    };

    // Se o usuário foi BLOQUEADO ou REVOGADO, revogar automaticamente vínculos ativos do Telegram e invalidar sessão
    if (validStatus === 'BLOQUEADO' || validStatus === 'REVOGADO') {
      updatePayload.token_sessao = '';
      updatePayload.token_sessao_expira_em = '';
      updatePayload.token_sessao_criado_em = '';
      updatePayload.token_sessao_ultima_atividade = '';

      var activeLinks = SpreadsheetRepository.findAll('TELEGRAM_VINCULOS', function (v) {
        return v.usuario_id === target.id && v.status_vinculo === 'ATIVO';
      });
      for (var i = 0; i < activeLinks.length; i++) {
        SpreadsheetRepository.updateById('TELEGRAM_VINCULOS', activeLinks[i].id, {
          status_vinculo: 'REVOGADO',
          revogado_em: SpreadsheetRepository.nowIso()
        });
      }
    }

    var updated = SpreadsheetRepository.updateById('USUARIOS', target.id, updatePayload);

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'USUARIO_STATUS_ALTERADO',
      entidade: 'USUARIOS',
      entidade_id: target.id,
      origem: 'WEB',
      detalhes: {
        email: target.email,
        statusAnterior: target.status,
        novoStatus: validStatus,
        papel: validRole
      }
    });

    return updated;
  }

  /**
   * Atualiza configurações do grupo financeiro.
   */
  function updateGroupConfigurations(adminUser, configPatch) {
    if (adminUser.papel !== 'OWNER' && adminUser.papel !== 'ADMIN') {
      throw new Error('Permissão administrativa necessária para alterar configurações do grupo.');
    }
    var existing = SpreadsheetRepository.findByGrupo('CONFIGURACOES', adminUser.grupo_id);
    var keys = Object.keys(configPatch || {});
    var updatedList = [];

    for (var i = 0; i < keys.length; i++) {
      var chave = ValidationService.sanitizeText(keys[i], 64).toUpperCase();
      var valor = ValidationService.sanitizeText(configPatch[keys[i]], 250);
      var found = null;
      for (var j = 0; j < existing.length; j++) {
        if (existing[j].chave === chave) {
          found = existing[j];
          break;
        }
      }
      if (found) {
        updatedList.push(
          SpreadsheetRepository.updateById('CONFIGURACOES', found.id, {
            valor: valor,
            atualizado_por: adminUser.id
          }, adminUser.grupo_id)
        );
      } else {
        updatedList.push(
          SpreadsheetRepository.insert('CONFIGURACOES', {
            id: SpreadsheetRepository.generateId('cfg'),
            grupo_id: adminUser.grupo_id,
            chave: chave,
            valor: valor,
            descricao: 'Configuração personalizada',
            atualizado_por: adminUser.id
          })
        );
      }
    }

    AuditService.log({
      grupo_id: adminUser.grupo_id,
      usuario_id: adminUser.id,
      acao: 'CONFIGURACAO_ATUALIZADA',
      entidade: 'CONFIGURACOES',
      entidade_id: adminUser.grupo_id,
      origem: 'WEB',
      detalhes: configPatch
    });

    return updatedList;
  }

  /**
   * Obtém o mapa de configurações do grupo financeiro do usuário.
   */
  function getGroupConfigurations(user) {
    var list = SpreadsheetRepository.findByGrupo('CONFIGURACOES', user.grupo_id);
    var map = {
      FIN_PRECISAO_MONETARIA: 'CENTAVOS_INTEIROS',
      MOEDA_PADRAO: 'BRL',
      FIN_REGIME_CONTABIL: 'HIBRIDO',
      FIN_TRATAMENTO_CONSIGNADOS: 'ISOLADO_INFORMATIVO',
      FIN_DIVIDAS_ANTIGAS: 'ISOLADAS_FLUXO',
      FIN_PRIMEIRO_DIA_SEMANA: 'DOMINGO',
      FIN_FECHAMENTO_MES: 'ULTIMO_DIA',
      FIN_FORMATO_DATA: 'DD_MM_AAAA'
    };
    for (var i = 0; i < list.length; i++) {
      if (list[i].chave && list[i].valor !== undefined && list[i].valor !== null && list[i].valor !== '') {
        map[list[i].chave] = list[i].valor;
      }
    }
    return map;
  }

  /**
   * Permite que o proprietário (ou qualquer usuário aprovado) cadastre ou altere sua senha pessoal.
   */
  function updatePersonalPassword(user, payload) {
    if (!user || user.status !== 'APROVADO') {
      throw new Error('Acesso não autorizado.');
    }
    var p = payload || {};
    var novaSenha = String(p.nova_senha || '').trim();
    if (novaSenha.length < 6) {
      throw new Error('A nova senha deve ter no mínimo 6 caracteres ou dígitos.');
    }

    var salt = AuthService.generateSecureSalt(16);
    var hash = AuthService.hashPassword(novaSenha, salt);
    var nowIso = SpreadsheetRepository.nowIso();

    SpreadsheetRepository.updateById('USUARIOS', user.id, {
      hash_senha: hash,
      salt: salt,
      atualizado_em: nowIso
    });

    AuditService.log({
      grupo_id: user.grupo_id || 'GLOBAL',
      usuario_id: user.id,
      acao: 'SENHA_PESSOAL_ATUALIZADA',
      entidade: 'USUARIOS',
      entidade_id: user.id,
      origem: 'WEB',
      detalhes: { email: user.email }
    });

    return { ok: true, message: 'Sua senha de acesso pessoal foi cadastrada com sucesso!' };
  }

  return {
    getProfileAndPreferences: getProfileAndPreferences,
    updateUserPreferences: updateUserPreferences,
    listGroupMembers: listGroupMembers,
    listUsersForAdmin: listUsersForAdmin,
    changeUserAuthorization: changeUserAuthorization,
    createUserByAdmin: createUserByAdmin,
    updateUserByAdmin: updateUserByAdmin,
    getUserDetails: getUserDetails,
    deleteUserByAdmin: deleteUserByAdmin,
    updateGroupConfigurations: updateGroupConfigurations,
    getGroupConfigurations: getGroupConfigurations,
    updatePersonalPassword: updatePersonalPassword
  };
})();

