/**
 * @file TelegramLaunchService.gs
 * @description Máquina de estados, formatação de prévia, edição de campos, confirmação
 * vinculada por hash (preview_hash) e controle de idempotência para propostas do Telegram.
 */

var TelegramLaunchService = (function () {
  var PROPOSAL_TTL_MINUTES = 30;

  var STATES = {
    RECEBIDO: 'RECEBIDO',
    PROCESSANDO: 'PROCESSANDO',
    PENDENTE_DE_INFORMACAO: 'PENDENTE_DE_INFORMACAO',
    AGUARDANDO_CONFIRMACAO: 'AGUARDANDO_CONFIRMACAO',
    CONFIRMADO: 'CONFIRMADO',
    CANCELADO: 'CANCELADO',
    EXPIRADO: 'EXPIRADO',
    ERRO: 'ERRO'
  };

  function computeCanonicalProposalString(data) {
    return JSON.stringify({
      tipo: data.tipo || null,
      descricao: data.descricao || null,
      valor_centavos: data.valor_centavos || null,
      data: data.data || null,
      categoria_id: data.categoria_id || null,
      subcategoria_id: data.subcategoria_id || null,
      conta_bancaria_id: data.conta_bancaria_id || null,
      forma_pagamento: data.forma_pagamento || null
    });
  }

  function computePreviewHash(usuarioId, telegramMessageId, extractedData) {
    var payload = String(usuarioId) + '|' + String(telegramMessageId) + '|' + computeCanonicalProposalString(extractedData);
    return TelegramAuthService.computeSha256Hex(payload).substring(0, 16);
  }

  function computePendingFields(extractedData, requireBankAccount) {
    var pending = [];
    if (!extractedData.tipo || (extractedData.tipo !== 'ENTRADA' && extractedData.tipo !== 'SAIDA')) {
      pending.push('tipo');
    }
    if (!extractedData.valor_centavos || Number(extractedData.valor_centavos) <= 0) {
      pending.push('valor_centavos');
    }
    if (!extractedData.data) {
      pending.push('data');
    }
    if (!extractedData.categoria_id) {
      pending.push('categoria');
    }
    if (requireBankAccount && !extractedData.conta_bancaria_id) {
      pending.push('conta_bancaria');
    }
    return pending;
  }

  function isBankAccountRequired(grupoId) {
    var configs = SpreadsheetRepository.findByGrupo('CONFIGURACOES', grupoId);
    for (var i = 0; i < configs.length; i++) {
      if (configs[i].chave === 'EXIGIR_CONTA_TELEGRAM') {
        return String(configs[i].valor) !== 'false';
      }
    }
    return true;
  }

  /**
   * Formata a prévia legível obrigatória da seção 7.7.
   */
  function formatConfirmationPreview(extractedData, previewHash, processState) {
    var tipoLabel = extractedData.tipo === 'ENTRADA'
      ? '🟢 Entrada (Receita)'
      : (extractedData.tipo === 'SAIDA' ? '🔴 Saída (Despesa)' : '⚪ Não identificado');
    var valorLabel = extractedData.valor_centavos
      ? ValidationService.formatCentavosToBrl(extractedData.valor_centavos)
      : 'Não identificado (informe o valor)';
    var dataLabel = extractedData.data
      ? ValidationService.formatDateBr(extractedData.data)
      : 'Não definida';
    var catLabel = extractedData.categoria_sugerida || 'Geral';
    if (extractedData.subcategoria_sugerida) {
      catLabel += ' › ' + extractedData.subcategoria_sugerida;
    }
    var contaLabel = extractedData.conta_bancaria_sugerida || 'Padrão do Sistema';
    var formaMap = {
      PIX: 'Pix',
      DEBITO: 'Cartão de Débito',
      CREDITO: 'Cartão de Crédito',
      DINHEIRO: 'Dinheiro em Espécie',
      BOLETO: 'Boleto Bancário',
      TRANSFERENCIA: 'Transferência / TED'
    };
    var formaLabel = formaMap[extractedData.forma_pagamento] || extractedData.forma_pagamento || 'Não informada';

    var situacaoLabel = (extractedData.situacao === 'PREVISTO' || extractedData.situacao === 'PENDENTE')
      ? '⏳ A Vencer (Previsto)'
      : '✅ Realizado (Baixa no saldo)';

    var lines = [
      '💳 *NOVO LANÇAMENTO DETECTADO*',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '🏷️ - Descrição: ' + (extractedData.descricao || 'Não informada') + '.',
      '💰 - Valor: ' + valorLabel + '.',
      '📂 - Tipo: ' + tipoLabel + '.',
      '📅 - Data: ' + dataLabel + '.',
      '📁 - Categoria: ' + catLabel + '.',
      '🏦 - Conta: ' + contaLabel + '.',
      '💳 - Forma de pagamento: ' + formaLabel + '.',
      '⚡ - Situação: ' + situacaoLabel + '.',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ];

    if (extractedData.campos_pendentes && extractedData.campos_pendentes.length > 0) {
      lines.push('');
      lines.push('⚠️ *Atenção:* selecione a conta bancária abaixo para confirmar:');
    }

    return lines.join('\n');
  }

  /**
   * Cria ou recupera de forma idempotente uma proposta a partir de um update do Telegram.
   * Uma mesma atualização (telegram_update_id) NUNCA gera dois registros ou dois lançamentos.
   */
  function createProposalFromUpdate(user, updateMeta, extractedData) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!updateMeta || !updateMeta.telegram_update_id) {
      throw new Error('telegram_update_id é obrigatório para garantir idempotência.');
    }
    var updateIdStr = String(updateMeta.telegram_update_id);

    // Verifica idempotência pelo telegram_update_id
    var existingProcess = SpreadsheetRepository.findOne('TELEGRAM_PROCESSAMENTOS', function (p) {
      return p.grupo_id === user.grupo_id && String(p.telegram_update_id) === updateIdStr;
    });
    if (existingProcess) {
      var parsedExisting = existingProcess.dados_extraidos_json ? JSON.parse(existingProcess.dados_extraidos_json) : {};
      return {
        idempotente_reutilizado: true,
        processamento: existingProcess,
        dados_extraidos: parsedExisting,
        texto_previa: formatConfirmationPreview(parsedExisting, existingProcess.preview_hash, existingProcess.estado)
      };
    }

    var reqBank = isBankAccountRequired(user.grupo_id);
    var pending = computePendingFields(extractedData, reqBank);
    extractedData.campos_pendentes = pending;

    var msgIdStr = String(updateMeta.telegram_message_id || updateIdStr);
    var pHash = computePreviewHash(user.id, msgIdStr, extractedData);
    var targetState = pending.length > 0 ? STATES.PENDENTE_DE_INFORMACAO : STATES.AGUARDANDO_CONFIRMACAO;
    var expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60000).toISOString();

    var created = SpreadsheetRepository.insert('TELEGRAM_PROCESSAMENTOS', {
      id: SpreadsheetRepository.generateId('tgp'),
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      telegram_update_id: updateIdStr,
      telegram_message_id: msgIdStr,
      telegram_chat_id: String(updateMeta.telegram_chat_id || ''),
      tipo_entrada: updateMeta.tipo_entrada || 'TEXTO',
      estado: targetState,
      dados_extraidos_json: JSON.stringify(extractedData),
      campos_pendentes_json: JSON.stringify(pending),
      preview_hash: pHash,
      lancamento_gerado_id: '',
      expira_em: expiresAt,
      erro_msg: ''
    });

    return {
      idempotente_reutilizado: false,
      processamento: created,
      dados_extraidos: extractedData,
      texto_previa: formatConfirmationPreview(extractedData, pHash, targetState),
      acoes_disponiveis: ['CONFIRMAR', 'EDITAR', 'CANCELAR']
    };
  }

  /**
   * Edita um ou mais campos de uma proposta pendente (ex: definir a conta bancária ausente,
   * corrigir o valor, descrição ou categoria) e invalida qualquer preview_hash anterior.
   */
  function editProposalFields(user, processId, patchFields) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var proc = SpreadsheetRepository.findById('TELEGRAM_PROCESSAMENTOS', processId, user.grupo_id);
    if (!proc) {
      throw new Error('Proposta de lançamento não encontrada.');
    }
    if (proc.usuario_id !== user.id) {
      throw new Error('UNAUTHORIZED_USER_PROPOSAL: Você não pode editar a proposta de outro usuário.');
    }
    if (proc.estado === STATES.CONFIRMADO || proc.estado === STATES.CANCELADO || proc.estado === STATES.EXPIRADO) {
      throw new Error('PROPOSAL_IMMUTABLE: Não é possível editar uma proposta em estado ' + proc.estado + '.');
    }

    var data = proc.dados_extraidos_json ? JSON.parse(proc.dados_extraidos_json) : {};

    if (patchFields.tipo !== undefined) {
      data.tipo = ValidationService.validateEnum(patchFields.tipo, ValidationService.LAUNCH_TYPES, 'tipo');
    }
    if (patchFields.descricao !== undefined) {
      data.descricao = ValidationService.sanitizeText(patchFields.descricao, 200);
    }
    if (patchFields.valor_centavos !== undefined) {
      data.valor_centavos = ValidationService.validateCentavos(patchFields.valor_centavos, 'valor_centavos', false);
    }
    if (patchFields.data !== undefined) {
      data.data = ValidationService.validateIsoDate(patchFields.data, 'data', false);
    }
    if (patchFields.forma_pagamento !== undefined) {
      data.forma_pagamento = ValidationService.validateEnum(patchFields.forma_pagamento, ValidationService.PAYMENT_METHODS, 'forma_pagamento');
    }
    if (patchFields.conta_bancaria_id !== undefined) {
      var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', patchFields.conta_bancaria_id, user.grupo_id);
      if (!acc || acc.situacao !== 'ATIVA') {
        throw new Error('Conta bancária selecionada inválida ou inativa.');
      }
      data.conta_bancaria_id = acc.id;
      data.conta_bancaria_sugerida = acc.nome_identificacao;
    }
    if (patchFields.categoria_id !== undefined) {
      var cat = SpreadsheetRepository.findById('CATEGORIAS', patchFields.categoria_id, user.grupo_id);
      if (!cat) {
        throw new Error('Categoria selecionada inválida.');
      }
      data.categoria_id = cat.id;
      data.categoria_sugerida = cat.nome;
    }
    if (patchFields.situacao !== undefined) {
      data.situacao = (patchFields.situacao === 'PREVISTO' || patchFields.situacao === 'PENDENTE') ? 'PREVISTO' : 'CONFIRMADO';
    }

    var reqBank = isBankAccountRequired(user.grupo_id);
    var pending = computePendingFields(data, reqBank);
    data.campos_pendentes = pending;

    var newHash = computePreviewHash(user.id, proc.telegram_message_id, data);
    var newState = pending.length > 0 ? STATES.PENDENTE_DE_INFORMACAO : STATES.AGUARDANDO_CONFIRMACAO;

    var updated = SpreadsheetRepository.updateById('TELEGRAM_PROCESSAMENTOS', proc.id, {
      estado: newState,
      dados_extraidos_json: JSON.stringify(data),
      campos_pendentes_json: JSON.stringify(pending),
      preview_hash: newHash
    }, user.grupo_id);

    return {
      processamento: updated,
      dados_extraidos: data,
      texto_previa: formatConfirmationPreview(data, newHash, newState)
    };
  }

  /**
   * Confirma uma proposta pendente e grava o lançamento financeiro oficial.
   * Valida usuário proprietário, expiração, ausência de pendências, hash da prévia
   * e garante idempotência contra cliques repetidos.
   */
  function confirmProposal(user, processId, providedPreviewHash) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var proc = SpreadsheetRepository.findById('TELEGRAM_PROCESSAMENTOS', processId, user.grupo_id);
      if (!proc) {
        throw new Error('PROPOSAL_NOT_FOUND: Proposta de lançamento não encontrada.');
      }

      if (proc.usuario_id !== user.id) {
        AuditService.log({
          grupo_id: user.grupo_id,
          usuario_id: user.id,
          acao: 'TENTATIVA_CONFIRMACAO_OUTRO_USUARIO',
          entidade: 'TELEGRAM_PROCESSAMENTOS',
          entidade_id: proc.id,
          origem: 'TELEGRAM',
          detalhes: { dono_proposta: proc.usuario_id, solicitante: user.id }
        });
        throw new Error('PROPOSAL_WRONG_USER: Uma confirmação não pode ser utilizada por outro usuário.');
      }

      // Idempotência: clique repetido em "Confirmar" retorna o lançamento já criado sem duplicar
      if (proc.estado === STATES.CONFIRMADO && proc.lancamento_gerado_id) {
        var alreadyCreated = SpreadsheetRepository.findById('LANCAMENTOS', proc.lancamento_gerado_id, user.grupo_id);
        return {
          idempotente_ja_confirmado: true,
          processamento: proc,
          lancamento: alreadyCreated
        };
      }

      if (proc.estado === STATES.CANCELADO) {
        throw new Error('PROPOSAL_CANCELED: Esta proposta foi cancelada e não pode ser confirmada.');
      }

      var now = SpreadsheetRepository.nowIso();
      if (proc.estado === STATES.EXPIRADO || (proc.expira_em && proc.expira_em < now)) {
        if (proc.estado !== STATES.EXPIRADO) {
          SpreadsheetRepository.updateById('TELEGRAM_PROCESSAMENTOS', proc.id, {
            estado: STATES.EXPIRADO
          }, user.grupo_id);
        }
        throw new Error('PROPOSAL_EXPIRED: Esta proposta expirou e não pode mais ser confirmada. Envie uma nova mensagem.');
      }

      if (!providedPreviewHash || providedPreviewHash !== proc.preview_hash) {
        throw new Error('STALE_PREVIEW_HASH: O conteúdo da prévia foi alterado ou o identificador de confirmação é inválido. Confirme a versão mais recente da prévia.');
      }

      var data = proc.dados_extraidos_json ? JSON.parse(proc.dados_extraidos_json) : {};
      var reqBank = isBankAccountRequired(user.grupo_id);
      var pending = computePendingFields(data, reqBank);

      if (pending.length > 0) {
        throw new Error('PENDING_FIELDS_REQUIRED: Informe os campos obrigatórios pendentes antes de confirmar: ' + pending.join(', '));
      }

      var externalIdempKey = 'tg_proc_' + proc.id + '_upd_' + proc.telegram_update_id;
      var situacaoFinal = (data.situacao === 'PREVISTO' || data.situacao === 'PENDENTE') ? data.situacao : 'CONFIRMADO';
      var launch = FinanceService.createLaunch(user, {
        tipo: data.tipo,
        descricao: data.descricao,
        valor_centavos: data.valor_centavos,
        data_lancamento: data.data,
        data_competencia: data.data,
        data_pagamento: situacaoFinal === 'CONFIRMADO' ? data.data : '',
        categoria_id: data.categoria_id,
        subcategoria_id: data.subcategoria_id || '',
        conta_bancaria_id: data.conta_bancaria_id,
        forma_pagamento: data.forma_pagamento || 'PIX',
        situacao: situacaoFinal,
        origem: 'TELEGRAM',
        id_origem_externa: externalIdempKey,
        observacoes: 'Lançamento ' + (situacaoFinal === 'PREVISTO' ? 'a vencer ' : '') + 'confirmado pelo usuário via Bot do Telegram (' + proc.tipo_entrada + ').'
      }, 'TELEGRAM');

      var updatedProc = SpreadsheetRepository.updateById('TELEGRAM_PROCESSAMENTOS', proc.id, {
        estado: STATES.CONFIRMADO,
        lancamento_gerado_id: launch.id
      }, user.grupo_id);

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'LANCAMENTO_CONFIRMADO_TELEGRAM',
        entidade: 'LANCAMENTOS',
        entidade_id: launch.id,
        origem: 'TELEGRAM',
        detalhes: {
          processamento_id: proc.id,
          telegram_update_id: proc.telegram_update_id,
          tipo_entrada: proc.tipo_entrada,
          valor_centavos: launch.valor_centavos
        }
      });

      return {
        idempotente_ja_confirmado: false,
        processamento: updatedProc,
        lancamento: launch
      };
    });
  }

  function cancelProposal(user, processId) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var proc = SpreadsheetRepository.findById('TELEGRAM_PROCESSAMENTOS', processId, user.grupo_id);
    if (!proc) {
      throw new Error('Proposta não encontrada.');
    }
    if (proc.usuario_id !== user.id) {
      throw new Error('Você não pode cancelar a proposta de outro usuário.');
    }
    if (proc.estado === STATES.CONFIRMADO) {
      throw new Error('Esta proposta já foi confirmada. Para cancelar o lançamento, utilize o sistema web.');
    }
    var updated = SpreadsheetRepository.updateById('TELEGRAM_PROCESSAMENTOS', proc.id, {
      estado: STATES.CANCELADO
    }, user.grupo_id);
    return updated;
  }

  return {
    PROPOSAL_TTL_MINUTES: PROPOSAL_TTL_MINUTES,
    STATES: STATES,
    computePreviewHash: computePreviewHash,
    formatConfirmationPreview: formatConfirmationPreview,
    createProposalFromUpdate: createProposalFromUpdate,
    editProposalFields: editProposalFields,
    confirmProposal: confirmProposal,
    cancelProposal: cancelProposal
  };
})();

