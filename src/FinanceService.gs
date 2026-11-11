/**
 * @file FinanceService.gs
 * @description Serviço central de lançamentos financeiros (entradas e saídas em centavos),
 * categorias/subcategorias, indicadores consolidados do Dashboard (separando valores
 * confirmados, previstos, pendentes e estimados) e geração/exportação de relatórios.
 */

var FinanceService = (function () {
  function listCategoriesWithSubcategories(user) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id, function (c) {
      return c.situacao !== 'INATIVA';
    });
    var subs = SpreadsheetRepository.findByGrupo('SUBCATEGORIAS', user.grupo_id, function (s) {
      return s.situacao !== 'INATIVA';
    });
    return cats.map(function (c) {
      var catSubs = subs.filter(function (s) {
        return s.categoria_id === c.id;
      });
      return {
        id: c.id,
        grupo_id: c.grupo_id,
        nome: c.nome,
        tipo: c.tipo,
        orcamento_mensal_centavos: Number(c.orcamento_mensal_centavos || 0),
        icone: c.icone || 'tag',
        cor: c.cor || '#2563eb',
        situacao: c.situacao,
        subcategorias: catSubs
      };
    });
  }

  function createCategory(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var nome = ValidationService.sanitizeText(payload && payload.nome, 80);
    if (!nome) throw new Error('Nome da categoria é obrigatório.');
    var tipo = ValidationService.validateEnum((payload && payload.tipo) || 'SAIDA', ['ENTRADA', 'SAIDA', 'AMBOS'], 'tipo');
    var orcamento = payload && payload.orcamento_mensal_centavos
      ? ValidationService.validateCentavos(payload.orcamento_mensal_centavos, 'orcamento_mensal_centavos', true)
      : 0;

    var created = SpreadsheetRepository.insert('CATEGORIAS', {
      id: SpreadsheetRepository.generateId('cat'),
      grupo_id: user.grupo_id,
      nome: nome,
      tipo: tipo,
      orcamento_mensal_centavos: orcamento,
      icone: ValidationService.sanitizeText((payload && payload.icone) || 'tag', 40),
      cor: ValidationService.sanitizeText((payload && payload.cor) || '#2563eb', 20),
      situacao: 'ATIVA'
    });

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CATEGORIA_CRIADA',
      entidade: 'CATEGORIAS',
      entidade_id: created.id,
      origem: 'WEB',
      detalhes: { nome: nome, tipo: tipo, orcamento_mensal_centavos: orcamento }
    });
    return created;
  }

  function createSubcategory(user, payload) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (!payload || !payload.categoria_id) {
      throw new Error('Categoria principal é obrigatória para criar subcategoria.');
    }
    var cat = SpreadsheetRepository.findById('CATEGORIAS', payload.categoria_id, user.grupo_id);
    if (!cat) {
      throw new Error('Categoria principal não encontrada no seu grupo financeiro.');
    }
    var nome = ValidationService.sanitizeText(payload.nome, 80);
    if (!nome) throw new Error('Nome da subcategoria é obrigatório.');

    var created = SpreadsheetRepository.insert('SUBCATEGORIAS', {
      id: SpreadsheetRepository.generateId('sub'),
      grupo_id: user.grupo_id,
      categoria_id: cat.id,
      nome: nome,
      situacao: 'ATIVA'
    });
    return created;
  }

  /**
   * Cria um lançamento financeiro validando relacionamentos e garantindo idempotência
   * por id_origem_externa.
   */
  function createLaunch(user, payload, originChannel) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var validated = ValidationService.validateLaunchPayload(payload);

    // Prevenção determinística de duplicidades por id_origem_externa
    if (validated.id_origem_externa) {
      var existingDup = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
        return (
          l.grupo_id === user.grupo_id &&
          l.id_origem_externa === validated.id_origem_externa &&
          l.situacao !== 'CANCELADO'
        );
      });
      if (existingDup) {
        return existingDup;
      }
    }

    var bankAccount = SpreadsheetRepository.findById('CONTAS_BANCARIAS', validated.conta_bancaria_id, user.grupo_id);
    if (!bankAccount) {
      throw new Error('Conta bancária selecionada não encontrada ou não pertence ao seu grupo financeiro.');
    }

    var category = SpreadsheetRepository.findById('CATEGORIAS', validated.categoria_id, user.grupo_id);
    if (!category) {
      throw new Error('Categoria selecionada não encontrada ou não pertence ao seu grupo financeiro.');
    }

    if (validated.subcategoria_id) {
      var sub = SpreadsheetRepository.findById('SUBCATEGORIAS', validated.subcategoria_id, user.grupo_id);
      if (!sub || sub.categoria_id !== category.id) {
        throw new Error('Subcategoria inválida para a categoria informada.');
      }
    }

    var record = {
      id: SpreadsheetRepository.generateId('lan'),
      grupo_id: user.grupo_id,
      tipo: validated.tipo,
      natureza_operacao: validated.natureza_operacao,
      transferencia_id: validated.transferencia_id,
      descricao: validated.descricao,
      valor_centavos: validated.valor_centavos,
      data_lancamento: validated.data_lancamento,
      data_competencia: validated.data_competencia,
      data_pagamento: validated.data_pagamento,
      categoria_id: validated.categoria_id,
      subcategoria_id: validated.subcategoria_id,
      conta_bancaria_id: validated.conta_bancaria_id,
      forma_pagamento: validated.forma_pagamento,
      situacao: validated.situacao,
      origem: validated.origem,
      referencia_recorrencia_id: validated.referencia_recorrencia_id,
      competencia_recorrencia: validated.competencia_recorrencia,
      referencia_parcela_id: validated.referencia_parcela_id,
      id_origem_externa: validated.id_origem_externa,
      observacoes: validated.observacoes,
      usuario_responsavel_id: user.id
    };

    var created = SpreadsheetRepository.insert('LANCAMENTOS', record);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'LANCAMENTO_CRIADO',
      entidade: 'LANCAMENTOS',
      entidade_id: created.id,
      origem: originChannel || validated.origem || 'WEB',
      detalhes: {
        tipo: created.tipo,
        valor_centavos: created.valor_centavos,
        situacao: created.situacao,
        origem: created.origem,
        conta_bancaria_id: created.conta_bancaria_id
      }
    });

    return created;
  }

  /**
   * Atualiza um lançamento existente, registrando auditoria.
   * Se for parte de uma transferência entre contas próprias, sincroniza a contraparte sob lock transacional.
   */
  function updateLaunch(user, launchId, patch) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findById('LANCAMENTOS', launchId, user.grupo_id);
      if (!existing) {
        throw new Error('Lançamento financeiro não encontrado.');
      }
      if (existing.situacao === 'CANCELADO') {
        throw new Error('Não é permitido editar um lançamento cancelado.');
      }

      var merged = {
        tipo: patch.tipo !== undefined ? patch.tipo : existing.tipo,
        natureza_operacao: existing.natureza_operacao,
        transferencia_id: existing.transferencia_id,
        descricao: patch.descricao !== undefined ? patch.descricao : existing.descricao,
        valor_centavos: patch.valor_centavos !== undefined ? patch.valor_centavos : existing.valor_centavos,
        data_lancamento: patch.data_lancamento !== undefined ? patch.data_lancamento : existing.data_lancamento,
        data_competencia: patch.data_competencia !== undefined ? patch.data_competencia : existing.data_competencia,
        data_pagamento: patch.data_pagamento !== undefined ? patch.data_pagamento : existing.data_pagamento,
        categoria_id: patch.categoria_id !== undefined ? patch.categoria_id : existing.categoria_id,
        subcategoria_id: patch.subcategoria_id !== undefined ? patch.subcategoria_id : existing.subcategoria_id,
        conta_bancaria_id: patch.conta_bancaria_id !== undefined ? patch.conta_bancaria_id : existing.conta_bancaria_id,
        forma_pagamento: patch.forma_pagamento !== undefined ? patch.forma_pagamento : existing.forma_pagamento,
        situacao: patch.situacao !== undefined ? patch.situacao : existing.situacao,
        origem: existing.origem,
        referencia_recorrencia_id: existing.referencia_recorrencia_id,
        competencia_recorrencia: existing.competencia_recorrencia,
        referencia_parcela_id: existing.referencia_parcela_id,
        id_origem_externa: existing.id_origem_externa,
        observacoes: patch.observacoes !== undefined ? patch.observacoes : existing.observacoes
      };

      var validated = ValidationService.validateLaunchPayload(merged);
      var updated = SpreadsheetRepository.updateById('LANCAMENTOS', launchId, validated, user.grupo_id);

      // VULN-04: Sincronização bilateral atômica de transferências entre contas próprias
      if (existing.transferencia_id) {
        var sibling = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
          return l.grupo_id === user.grupo_id && l.transferencia_id === existing.transferencia_id && l.id !== existing.id;
        });
        if (sibling && sibling.situacao !== 'CANCELADO') {
          var siblingPatch = {
            valor_centavos: updated.valor_centavos,
            data_lancamento: updated.data_lancamento,
            data_competencia: updated.data_competencia,
            data_pagamento: updated.data_pagamento,
            situacao: updated.situacao
          };
          SpreadsheetRepository.updateById('LANCAMENTOS', sibling.id, siblingPatch, user.grupo_id);
        }
      }

      // Sincroniza com a tabela PARCELAS se for vinculado a uma parcela
      if (updated.referencia_parcela_id) {
        var parcela = SpreadsheetRepository.findById('PARCELAS', updated.referencia_parcela_id, user.grupo_id);
        if (parcela) {
          if (updated.situacao === 'CONFIRMADO' && parcela.situacao !== 'PAGA') {
            SpreadsheetRepository.updateById('PARCELAS', parcela.id, {
              situacao: 'PAGA',
              data_pagamento: updated.data_pagamento || SpreadsheetRepository.todayIso(),
              lancamento_id: updated.id
            }, user.grupo_id);

            if (parcela.origem_tipo === 'EMPRESTIMO') {
              var loan = SpreadsheetRepository.findById('EMPRESTIMOS', parcela.origem_id, user.grupo_id);
              if (loan) {
                var novoSaldo = Math.max(0, Number(loan.saldo_devedor_centavos || 0) - Number(updated.valor_centavos || parcela.valor_centavos));
                var remaining = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
                  return p.origem_tipo === 'EMPRESTIMO' && p.origem_id === loan.id && p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
                });
                SpreadsheetRepository.updateById('EMPRESTIMOS', loan.id, {
                  saldo_devedor_centavos: remaining.length === 0 ? 0 : novoSaldo,
                  situacao: remaining.length === 0 ? 'QUITADO' : loan.situacao
                }, user.grupo_id);
              }
            }
          } else if ((updated.situacao === 'PREVISTO' || updated.situacao === 'PENDENTE') && parcela.situacao === 'PAGA') {
            SpreadsheetRepository.updateById('PARCELAS', parcela.id, {
              situacao: 'PREVISTA',
              data_pagamento: '',
              lancamento_id: updated.id
            }, user.grupo_id);

            if (parcela.origem_tipo === 'EMPRESTIMO') {
              var loanRest = SpreadsheetRepository.findById('EMPRESTIMOS', parcela.origem_id, user.grupo_id);
              if (loanRest) {
                var restoredSaldo = Number(loanRest.saldo_devedor_centavos || 0) + Number(updated.valor_centavos || parcela.valor_centavos);
                SpreadsheetRepository.updateById('EMPRESTIMOS', loanRest.id, {
                  saldo_devedor_centavos: restoredSaldo,
                  situacao: 'ATIVO'
                }, user.grupo_id);
              }
            }
          }
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'LANCAMENTO_ATUALIZADO',
        entidade: 'LANCAMENTOS',
        entidade_id: launchId,
        origem: 'WEB',
        detalhes: {
          valor_anterior_centavos: existing.valor_centavos,
          valor_novo_centavos: updated.valor_centavos,
          situacao_anterior: existing.situacao,
          situacao_nova: updated.situacao
        }
      });

      return updated;
    });
  }

  /**
   * Confirma o pagamento/recebimento efetivo de um lançamento previsto ou pendente.
   * Se for transferência, confirma a contraparte sob lock atômico.
   */
  function confirmLaunch(user, launchId, paymentData) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findById('LANCAMENTOS', launchId, user.grupo_id);
      if (!existing) {
        throw new Error('Lançamento não encontrado.');
      }
      if (existing.situacao === 'CANCELADO') {
        throw new Error('Lançamento cancelado não pode ser confirmado.');
      }
      if (existing.situacao === 'CONFIRMADO') {
        return existing; // Idempotente
      }

      var patch = {
        situacao: 'CONFIRMADO',
        data_pagamento: (paymentData && paymentData.data_pagamento)
          ? ValidationService.validateIsoDate(paymentData.data_pagamento, 'data_pagamento', false)
          : SpreadsheetRepository.todayIso()
      };
      if (paymentData && paymentData.valor_centavos !== undefined) {
        patch.valor_centavos = ValidationService.validateCentavos(paymentData.valor_centavos, 'valor_centavos', false);
      }
      if (paymentData && paymentData.conta_bancaria_id) {
        var acc = SpreadsheetRepository.findById('CONTAS_BANCARIAS', paymentData.conta_bancaria_id, user.grupo_id);
        if (!acc) throw new Error('Conta bancária inválida.');
        patch.conta_bancaria_id = acc.id;
      }

      var updated = SpreadsheetRepository.updateById('LANCAMENTOS', launchId, patch, user.grupo_id);

      // Sincroniza a contraparte da transferência
      if (existing.transferencia_id) {
        var sibling = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
          return l.grupo_id === user.grupo_id && l.transferencia_id === existing.transferencia_id && l.id !== existing.id;
        });
        if (sibling && sibling.situacao !== 'CONFIRMADO' && sibling.situacao !== 'CANCELADO') {
          var siblingPatch = {
            situacao: 'CONFIRMADO',
            data_pagamento: patch.data_pagamento
          };
          if (patch.valor_centavos !== undefined) {
            siblingPatch.valor_centavos = patch.valor_centavos;
          }
          SpreadsheetRepository.updateById('LANCAMENTOS', sibling.id, siblingPatch, user.grupo_id);
        }
      }

      // Se estiver vinculado a uma parcela de dívida ou empréstimo, marca a parcela como PAGA
      if (updated.referencia_parcela_id) {
        var parcela = SpreadsheetRepository.findById('PARCELAS', updated.referencia_parcela_id, user.grupo_id);
        if (parcela && parcela.situacao !== 'PAGA') {
          SpreadsheetRepository.updateById('PARCELAS', parcela.id, {
            situacao: 'PAGA',
            data_pagamento: patch.data_pagamento,
            lancamento_id: updated.id
          }, user.grupo_id);

          if (parcela.origem_tipo === 'EMPRESTIMO') {
            var loan = SpreadsheetRepository.findById('EMPRESTIMOS', parcela.origem_id, user.grupo_id);
            if (loan) {
              var novoSaldoDevedor = Math.max(0, Number(loan.saldo_devedor_centavos || 0) - Number(updated.valor_centavos || parcela.valor_centavos));
              var remaining = SpreadsheetRepository.findByGrupo('PARCELAS', user.grupo_id, function (p) {
                return p.origem_tipo === 'EMPRESTIMO' && p.origem_id === loan.id && p.situacao !== 'PAGA' && p.situacao !== 'CANCELADA';
              });
              SpreadsheetRepository.updateById('EMPRESTIMOS', loan.id, {
                saldo_devedor_centavos: remaining.length === 0 ? 0 : novoSaldoDevedor,
                situacao: remaining.length === 0 ? 'QUITADO' : loan.situacao
              }, user.grupo_id);
            }
          }
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'LANCAMENTO_CONFIRMADO',
        entidade: 'LANCAMENTOS',
        entidade_id: launchId,
        origem: 'WEB',
        detalhes: patch
      });

      return updated;
    });
  }

  /**
   * Cancela um lançamento preservando seu histórico na planilha.
   * Se for parte de uma transferência entre contas próprias, cancela ambas as pontas.
   */
  function cancelLaunch(user, launchId, motivo) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    return SpreadsheetRepository.withLock(function () {
      var existing = SpreadsheetRepository.findById('LANCAMENTOS', launchId, user.grupo_id);
      if (!existing) {
        throw new Error('Lançamento não encontrado.');
      }
      if (existing.situacao === 'CANCELADO') {
        return existing;
      }

      var obsCancel = ValidationService.sanitizeText(
        (existing.observacoes ? existing.observacoes + ' | ' : '') + 'Cancelado: ' + (motivo || 'Solicitado pelo usuário'),
        500
      );

      var canceled = SpreadsheetRepository.updateById('LANCAMENTOS', launchId, {
        situacao: 'CANCELADO',
        observacoes: obsCancel
      }, user.grupo_id);

      if (existing.transferencia_id) {
        var sibling = SpreadsheetRepository.findOne('LANCAMENTOS', function (l) {
          return l.grupo_id === user.grupo_id && l.transferencia_id === existing.transferencia_id && l.id !== existing.id;
        });
        if (sibling && sibling.situacao !== 'CANCELADO') {
          SpreadsheetRepository.updateById('LANCAMENTOS', sibling.id, {
            situacao: 'CANCELADO',
            observacoes: obsCancel
          }, user.grupo_id);
        }
      }

      if (existing.referencia_parcela_id) {
        var par = SpreadsheetRepository.findById('PARCELAS', existing.referencia_parcela_id, user.grupo_id);
        if (par && par.situacao === 'PAGA') {
          SpreadsheetRepository.updateById('PARCELAS', par.id, {
            situacao: 'PREVISTA',
            data_pagamento: ''
          }, user.grupo_id);
          if (par.origem_tipo === 'EMPRESTIMO') {
            var loan = SpreadsheetRepository.findById('EMPRESTIMOS', par.origem_id, user.grupo_id);
            if (loan) {
              SpreadsheetRepository.updateById('EMPRESTIMOS', loan.id, {
                saldo_devedor_centavos: Number(loan.saldo_devedor_centavos || 0) + Number(existing.valor_centavos || par.valor_centavos),
                situacao: 'ATIVO'
              }, user.grupo_id);
            }
          }
        }
      }

      AuditService.log({
        grupo_id: user.grupo_id,
        usuario_id: user.id,
        acao: 'LANCAMENTO_CANCELADO',
        entidade: 'LANCAMENTOS',
        entidade_id: launchId,
        origem: 'WEB',
        detalhes: { motivo: motivo || 'Solicitado pelo usuário', valor_centavos: existing.valor_centavos }
      });

      return canceled;
    });
  }

  /**
   * Lista lançamentos com filtros e paginação no servidor.
   */
  function listLaunches(user, filters) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    if (typeof LoanService !== 'undefined' && typeof LoanService.syncUserPaidLoanLaunches === 'function') {
      LoanService.syncUserPaidLoanLaunches(user);
    }
    var f = filters || {};
    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var subs = SpreadsheetRepository.findByGrupo('SUBCATEGORIAS', user.grupo_id);
    var accs = SpreadsheetRepository.findByGrupo('CONTAS_BANCARIAS', user.grupo_id);

    var catMap = {};
    for (var c = 0; c < cats.length; c++) catMap[cats[c].id] = cats[c];
    var subMap = {};
    for (var s = 0; s < subs.length; s++) subMap[subs[s].id] = subs[s];
    var accMap = {};
    for (var a = 0; a < accs.length; a++) accMap[accs[a].id] = accs[a];

    var all = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (item) {
      if (!f.incluirCancelados && item.situacao === 'CANCELADO') return false;
      if (f.tipo && item.tipo !== f.tipo) return false;
      if (f.situacao && item.situacao !== f.situacao) return false;
      if (f.categoria_id && item.categoria_id !== f.categoria_id) return false;
      if (f.conta_bancaria_id && item.conta_bancaria_id !== f.conta_bancaria_id) return false;
      if (f.origem && item.origem !== f.origem) return false;
      if (f.mes && String(item.data_lancamento).substring(0, 7) !== f.mes) return false;
      if (f.data_inicio && String(item.data_lancamento) < f.data_inicio) return false;
      if (f.data_fim && String(item.data_lancamento) > f.data_fim) return false;
      if (f.busca) {
        var q = String(f.busca).toLowerCase().trim();
        var descMatch = String(item.descricao || '').toLowerCase().indexOf(q) !== -1;
        var obsMatch = String(item.observacoes || '').toLowerCase().indexOf(q) !== -1;
        if (!descMatch && !obsMatch) return false;
      }
      return true;
    });

    all.sort(function (x, y) {
      var cmp = String(y.data_lancamento).localeCompare(String(x.data_lancamento));
      if (cmp !== 0) return cmp;
      return String(y.criado_em).localeCompare(String(x.criado_em));
    });

    var page = Math.max(1, parseInt(f.page || 1, 10));
    var pageSize = Math.min(200, Math.max(5, parseInt(f.pageSize || 50, 10)));
    var startIdx = (page - 1) * pageSize;
    var paged = all.slice(startIdx, startIdx + pageSize).map(function (item) {
      var cat = catMap[item.categoria_id];
      var sub = subMap[item.subcategoria_id];
      var acc = accMap[item.conta_bancaria_id];
      var copy = {};
      for (var k in item) {
        if (Object.prototype.hasOwnProperty.call(item, k) && k !== '_rowIndex') {
          copy[k] = item[k];
        }
      }
      copy.categoria_nome = cat ? cat.nome : 'Sem Categoria';
      copy.categoria_cor = cat ? cat.cor : '#64748b';
      copy.subcategoria_nome = sub ? sub.nome : '';
      copy.conta_bancaria_nome = acc ? acc.nome_identificacao : 'Conta não identificada';
      return copy;
    });

    var totalEntradasCentavos = 0;
    var totalSaidasCentavos = 0;
    var totalEntradasPrevistasCentavos = 0;
    var totalSaidasPrevistasCentavos = 0;

    for (var i = 0; i < all.length; i++) {
      var item = all[i];
      if (item.situacao === 'CONFIRMADO') {
        var v = Number(item.valor_centavos || 0);
        if (item.tipo === 'ENTRADA') totalEntradasCentavos += v;
        else if (item.tipo === 'SAIDA') totalSaidasCentavos += v;
      } else if (item.situacao === 'PREVISTO' || item.situacao === 'PENDENTE') {
        var vp = Number(item.valor_centavos || 0);
        if (item.tipo === 'ENTRADA') totalEntradasPrevistasCentavos += vp;
        else if (item.tipo === 'SAIDA') totalSaidasPrevistasCentavos += vp;
      }
    }

    return {
      total: all.length,
      page: page,
      pageSize: pageSize,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      items: paged,
      totalEntradasCentavos: totalEntradasCentavos,
      totalSaidasCentavos: totalSaidasCentavos,
      saldoPeriodoCentavos: totalEntradasCentavos - totalSaidasCentavos,
      totalEntradasPrevistasCentavos: totalEntradasPrevistasCentavos,
      totalSaidasPrevistasCentavos: totalSaidasPrevistasCentavos,
      saldoPrevistoCentavos: totalEntradasPrevistasCentavos - totalSaidasPrevistasCentavos
    };
  }

  /**
   * Calcula todos os indicadores consolidados do Dashboard no backend,
   * separando estritamente valores confirmados, previstos, pendentes e estimados.
   */
  function getDashboardData(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var today = SpreadsheetRepository.todayIso();
    var targetMonth = (mesReferencia && /^\d{4}-\d{2}$/.test(mesReferencia))
      ? mesReferencia
      : today.substring(0, 7);

    var accountsWithBalances = BankAccountService.listBankAccountsWithBalances(user, false);
    var saldoAtualConsolidadoConfirmado = 0;
    var saldoProjetadoContas = 0;
    for (var a = 0; a < accountsWithBalances.length; a++) {
      saldoAtualConsolidadoConfirmado += accountsWithBalances[a].saldo_confirmado_centavos;
      saldoProjetadoContas += accountsWithBalances[a].saldo_projetado_centavos;
    }

    var allLaunches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.situacao !== 'CANCELADO';
    });
    var categories = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id);
    var catMap = {};
    for (var c = 0; c < categories.length; c++) {
      catMap[categories[c].id] = categories[c];
    }

    var receitasConfirmadasMes = 0;
    var receitasPrevistasMes = 0;
    var receitasPendentesMes = 0;

    var despesasConfirmadasMes = 0;
    var despesasPrevistasMes = 0;
    var despesasPendentesMes = 0;

    var contasAVencer = [];
    var contasVencidas = [];
    var gastosPorCategoriaMap = {};

    for (var i = 0; i < allLaunches.length; i++) {
      var l = allLaunches[i];
      // Transferências entre contas próprias não são somadas às receitas/despesas de consumo
      if (l.natureza_operacao === 'TRANSFERENCIA') {
        continue;
      }
      var lMonth = String(l.data_lancamento).substring(0, 7);
      var val = Number(l.valor_centavos || 0);

      if (lMonth === targetMonth) {
        if (l.tipo === 'ENTRADA') {
          if (l.situacao === 'CONFIRMADO') receitasConfirmadasMes += val;
          else if (l.situacao === 'PREVISTO') receitasPrevistasMes += val;
          else if (l.situacao === 'PENDENTE') receitasPendentesMes += val;
        } else if (l.tipo === 'SAIDA') {
          if (l.situacao === 'CONFIRMADO') despesasConfirmadasMes += val;
          else if (l.situacao === 'PREVISTO') despesasPrevistasMes += val;
          else if (l.situacao === 'PENDENTE') despesasPendentesMes += val;

          var catObj = catMap[l.categoria_id] || { id: l.categoria_id, nome: 'Outros', cor: '#64748b', orcamento_mensal_centavos: 0 };
          if (!gastosPorCategoriaMap[catObj.id]) {
            gastosPorCategoriaMap[catObj.id] = {
              categoria_id: catObj.id,
              categoria_nome: catObj.nome,
              cor: catObj.cor || '#2563eb',
              orcamento_centavos: Number(catObj.orcamento_mensal_centavos || 0),
              confirmado_centavos: 0,
              previsto_centavos: 0,
              pendente_centavos: 0
            };
          }
          if (l.situacao === 'CONFIRMADO') gastosPorCategoriaMap[catObj.id].confirmado_centavos += val;
          else if (l.situacao === 'PREVISTO') gastosPorCategoriaMap[catObj.id].previsto_centavos += val;
          else if (l.situacao === 'PENDENTE') gastosPorCategoriaMap[catObj.id].pendente_centavos += val;
        }
      }

      // Contas vencidas vs a vencer (saídas não pagas)
      if (l.tipo === 'SAIDA' && (l.situacao === 'PREVISTO' || l.situacao === 'PENDENTE')) {
        var catName = catMap[l.categoria_id] ? catMap[l.categoria_id].nome : 'Geral';
        var summaryItem = {
          id: l.id,
          descricao: l.descricao,
          valor_centavos: val,
          data_lancamento: l.data_lancamento,
          situacao: l.situacao,
          categoria_nome: catName
        };
        if (l.data_lancamento < today) {
          contasVencidas.push(summaryItem);
        } else {
          contasAVencer.push(summaryItem);
        }
      }
    }

    contasVencidas.sort(function (x, y) { return String(x.data_lancamento).localeCompare(String(y.data_lancamento)); });
    contasAVencer.sort(function (x, y) { return String(x.data_lancamento).localeCompare(String(y.data_lancamento)); });

    // Evolução mensal (últimos 6 meses até o mês de referência)
    var evolucaoMensal = computeMonthlyEvolution(allLaunches, targetMonth, 6);

    // Patrimônio financeiro estimado (separando claramente cada componente)
    var investments = SpreadsheetRepository.findByGrupo('INVESTIMENTOS', user.grupo_id, function (inv) {
      return inv.situacao === 'ATIVO';
    });
    var totalInvestimentosInformado = 0;
    for (var invIdx = 0; invIdx < investments.length; invIdx++) {
      totalInvestimentosInformado += Number(investments[invIdx].valor_mercado_informado_centavos || investments[invIdx].valor_aplicado_centavos || 0);
    }

    var activeLoans = SpreadsheetRepository.findByGrupo('EMPRESTIMOS', user.grupo_id, function (emp) {
      return emp.situacao === 'ATIVO';
    });
    var totalSaldoDevedorEmprestimos = 0;
    for (var empIdx = 0; empIdx < activeLoans.length; empIdx++) {
      totalSaldoDevedorEmprestimos += Number(activeLoans[empIdx].saldo_devedor_centavos || 0);
    }

    var activeDebts = SpreadsheetRepository.findByGrupo('DIVIDAS', user.grupo_id, function (div) {
      return div.situacao !== 'QUITADA' && div.situacao !== 'CANCELADA';
    });
    var totalDividasAcordoAtivo = 0;
    var totalDividasAntigasInformativo = 0;
    for (var divIdx = 0; divIdx < activeDebts.length; divIdx++) {
      var d = activeDebts[divIdx];
      if (d.situacao === 'ACORDO_ATIVO' && d.repercutir_fluxo_caixa) {
        totalDividasAcordoAtivo += Number(d.valor_negociado_centavos || d.valor_atualizado_centavos || 0);
      } else {
        totalDividasAntigasInformativo += Number(d.valor_atualizado_centavos || d.valor_original_centavos || 0);
      }
    }

    var gastosPorCategoria = Object.keys(gastosPorCategoriaMap).map(function (k) {
      var g = gastosPorCategoriaMap[k];
      g.total_comprometido_centavos = g.confirmado_centavos + g.previsto_centavos + g.pendente_centavos;
      return g;
    }).sort(function (x, y) {
      return y.total_comprometido_centavos - x.total_comprometido_centavos;
    });

    // ── Resumo Geral de Todos os Módulos (Visão 360° para o Dashboard e KPIs) ──
    var rawCards = [];
    try {
      if (typeof CreditCardService !== 'undefined' && CreditCardService.listCards) {
        rawCards = CreditCardService.listCards(user);
      }
    } catch (eCards) {}
    var totalLimiteCartoes = 0;
    var totalComprometidoCartoes = 0;
    var totalFaturasAbertasCartoes = 0;
    for (var rcIdx = 0; rcIdx < rawCards.length; rcIdx++) {
      var rc = rawCards[rcIdx];
      var lim = Number(rc.limite_total_centavos || 0) + Number(rc.limite_adicional_centavos || 0);
      var compLim = Number(rc.limite_comprometido_centavos || 0);
      totalLimiteCartoes += lim;
      totalComprometidoCartoes += compLim;
      totalFaturasAbertasCartoes += Number(rc.fatura_atual_centavos || 0);
    }
    var resumoCartoes = {
      total_cartoes: rawCards.length,
      faturas_abertas_centavos: totalFaturasAbertasCartoes,
      limite_total_centavos: totalLimiteCartoes,
      limite_comprometido_centavos: totalComprometidoCartoes,
      limite_disponivel_centavos: Math.max(0, totalLimiteCartoes - totalComprometidoCartoes)
    };

    var rawRecorrentes = [];
    try {
      if (typeof RecurringAccountService !== 'undefined' && RecurringAccountService.listRecurringAccounts) {
        rawRecorrentes = RecurringAccountService.listRecurringAccounts(user, targetMonth);
      }
    } catch (eRec) {}
    var custoFixoMensalCentavos = 0;
    var custoAnualizadoCentavos = 0;
    var recPagasCentavos = 0;
    var recPendentesCentavos = 0;
    var recPagasQtd = 0;
    var recPendentesQtd = 0;
    for (var rrIdx = 0; rrIdx < rawRecorrentes.length; rrIdx++) {
      var rItem = rawRecorrentes[rrIdx];
      if (rItem.situacao === 'ATIVA' && rItem.tipo === 'SAIDA') {
        var rVal = Number(rItem.valor_previsto_centavos || 0);
        var mensVal = rVal;
        if (rItem.recorrencia === 'ANUAL') mensVal = Math.round(rVal / 12);
        else if (rItem.recorrencia === 'SEMANAL') mensVal = Math.round(rVal * 4.33);
        else if (rItem.recorrencia === 'QUINZENAL') mensVal = rVal * 2;
        custoFixoMensalCentavos += mensVal;
        custoAnualizadoCentavos += mensVal * 12;

        if (rItem.ocorrencia_mes_atual && rItem.ocorrencia_mes_atual.situacao === 'CONFIRMADO') {
          recPagasCentavos += Number(rItem.ocorrencia_mes_atual.valor_centavos || rVal);
          recPagasQtd++;
        } else {
          recPendentesCentavos += rVal;
          recPendentesQtd++;
        }
      }
    }
    var resumoRecorrentes = {
      total_ativas: rawRecorrentes.filter(function (r) { return r.situacao === 'ATIVA'; }).length,
      custo_mensal_fixo_centavos: custoFixoMensalCentavos,
      custo_anualizado_centavos: custoAnualizadoCentavos,
      pagas_mes_centavos: recPagasCentavos,
      pendentes_mes_centavos: recPendentesCentavos,
      pagas_qtd: recPagasQtd,
      pendentes_qtd: recPendentesQtd
    };

    var rawDebts = [];
    try {
      if (typeof DebtService !== 'undefined' && DebtService.listDebts) {
        rawDebts = DebtService.listDebts(user);
      }
    } catch (eDebts) {}
    var totalSaldoDevedorDividas = 0;
    var totalEmAcordoDividas = 0;
    var parcelasPagasDividas = 0;
    var parcelasTotalDividas = 0;
    var totalEconomiaDescontosDividas = 0;
    for (var rdIdx = 0; rdIdx < rawDebts.length; rdIdx++) {
      var dItem = rawDebts[rdIdx];
      if (dItem.situacao !== 'QUITADA' && dItem.situacao !== 'CANCELADA') {
        totalSaldoDevedorDividas += Number(dItem.saldo_devedor_centavos || 0);
        if (dItem.situacao === 'ACORDO_ATIVO' || dItem.parcelas_total > 0) {
          totalEmAcordoDividas += Number(dItem.saldo_devedor_centavos || 0);
          parcelasPagasDividas += Number(dItem.parcelas_pagas || 0);
          parcelasTotalDividas += Number(dItem.parcelas_total || 0);
        }
        if (dItem.desconto_obtido_centavos) {
          totalEconomiaDescontosDividas += Number(dItem.desconto_obtido_centavos || 0);
        }
      }
    }
    var resumoDividas = {
      total_dividas: rawDebts.length,
      saldo_devedor_total_centavos: totalSaldoDevedorDividas,
      total_em_acordo_centavos: totalEmAcordoDividas,
      parcelas_pagas: parcelasPagasDividas,
      parcelas_total: parcelasTotalDividas,
      economia_descontos_centavos: totalEconomiaDescontosDividas
    };

    var rawLoans = [];
    try {
      if (typeof LoanService !== 'undefined' && LoanService.listLoans) {
        rawLoans = LoanService.listLoans(user);
      }
    } catch (eLoans) {}
    var totalSaldoDevedorLoans = 0;
    var parcelaMensalTotalLoans = 0;
    var consignadoFolhaLoans = 0;
    var debitoContaLoans = 0;
    for (var rlIdx = 0; rlIdx < rawLoans.length; rlIdx++) {
      var lItem = rawLoans[rlIdx];
      if (lItem.situacao === 'ATIVO') {
        totalSaldoDevedorLoans += Number(lItem.saldo_devedor_centavos || 0);
        var pVal = Number(lItem.valor_parcela_centavos || 0);
        parcelaMensalTotalLoans += pVal;
        if (lItem.tipo_emprestimo === 'CONSIGNADO' || lItem.debitar_automatico_folha) {
          consignadoFolhaLoans += pVal;
        } else {
          debitoContaLoans += pVal;
        }
      }
    }
    var resumoEmprestimos = {
      total_emprestimos: rawLoans.filter(function (l) { return l.situacao === 'ATIVO'; }).length,
      saldo_devedor_total_centavos: totalSaldoDevedorLoans,
      parcela_mensal_total_centavos: parcelaMensalTotalLoans,
      consignado_folha_centavos: consignadoFolhaLoans,
      debito_conta_centavos: debitoContaLoans
    };

    var resumoInvestimentos = {
      patrimonio_total_centavos: totalInvestimentosInformado,
      total_aplicado_centavos: 0,
      rentabilidade_total_centavos: 0,
      rentabilidade_pct: 0,
      total_ativos: investments.length,
      proventos_12m_centavos: 0
    };
    try {
      if (typeof InvestmentService !== 'undefined' && InvestmentService.getPortfolioSummary) {
        var port = InvestmentService.getPortfolioSummary(user);
        if (port) {
          var totAplic = Number(port.total_aplicado_centavos || 0);
          var totMerc = Number(port.total_mercado_centavos || totalInvestimentosInformado);
          var rent = totMerc - totAplic;
          var rPct = totAplic > 0 ? Number(((rent / totAplic) * 100).toFixed(2)) : 0;
          resumoInvestimentos.patrimonio_total_centavos = totMerc;
          resumoInvestimentos.total_aplicado_centavos = totAplic;
          resumoInvestimentos.rentabilidade_total_centavos = rent;
          resumoInvestimentos.rentabilidade_pct = rPct;
          resumoInvestimentos.total_ativos = (port.posicoes || []).length;
          resumoInvestimentos.proventos_12m_centavos = Number(port.dividendos_projetados_12m_centavos || 0);
        }
      }
    } catch (eInv) {}

    var rawGoals = [];
    try {
      if (typeof GoalService !== 'undefined' && GoalService.listGoals) {
        rawGoals = GoalService.listGoals(user);
      }
    } catch (eGoals) {}
    var totalAcumuladoMetas = 0;
    var totalAlvoMetas = 0;
    for (var rgIdx = 0; rgIdx < rawGoals.length; rgIdx++) {
      totalAcumuladoMetas += Number(rawGoals[rgIdx].valor_acumulado_centavos || 0);
      totalAlvoMetas += Number(rawGoals[rgIdx].valor_alvo_centavos || 0);
    }
    var pctGeralMetas = totalAlvoMetas > 0 ? Math.round((totalAcumuladoMetas / totalAlvoMetas) * 100) : 0;
    var mesesReservaCobertos = custoFixoMensalCentavos > 0
      ? Number((saldoAtualConsolidadoConfirmado / custoFixoMensalCentavos).toFixed(1))
      : 0;
    var resumoMetas = {
      total_metas: rawGoals.length,
      total_acumulado_centavos: totalAcumuladoMetas,
      total_alvo_centavos: totalAlvoMetas,
      percentual_geral: pctGeralMetas,
      meses_reserva_cobertos: mesesReservaCobertos
    };

    var proximos7DiasCentavos = 0;
    var dToday = new Date(today + 'T12:00:00Z');
    var d7 = new Date(dToday.getTime() + 7 * 86400000);
    var date7Iso = d7.toISOString().substring(0, 10);
    for (var caIdx = 0; caIdx < contasAVencer.length; caIdx++) {
      if (contasAVencer[caIdx].data_lancamento <= date7Iso) {
        proximos7DiasCentavos += Number(contasAVencer[caIdx].valor_centavos || 0);
      }
    }
    var resumoCalendario = {
      total_pagar_mes_centavos: despesasConfirmadasMes + despesasPrevistasMes + despesasPendentesMes,
      total_receber_mes_centavos: receitasConfirmadasMes + receitasPrevistasMes + receitasPendentesMes,
      proximos_7_dias_centavos: proximos7DiasCentavos,
      contas_atrasadas_qtd: contasVencidas.length
    };

    var resumoBancos = {
      total_contas: accountsWithBalances.length,
      saldo_confirmado_centavos: saldoAtualConsolidadoConfirmado,
      saldo_projetado_centavos: saldoProjetadoContas
    };

    var resumoGeralModulos = {
      cartoes: resumoCartoes,
      recorrentes: resumoRecorrentes,
      dividas: resumoDividas,
      emprestimos: resumoEmprestimos,
      investimentos: resumoInvestimentos,
      metas: resumoMetas,
      calendario: resumoCalendario,
      bancos: resumoBancos
    };

    return {
      mes_referencia: targetMonth,
      data_referencia: today,
      resumo_geral_modulos: resumoGeralModulos,
      // Valores Confirmados (Realizados)
      confirmados: {
        saldo_bancario_consolidado_centavos: saldoAtualConsolidadoConfirmado,
        receitas_realizadas_mes_centavos: receitasConfirmadasMes,
        despesas_pagas_mes_centavos: despesasConfirmadasMes,
        resultado_mensal_realizado_centavos: receitasConfirmadasMes - despesasConfirmadasMes
      },
      // Valores Previstos
      previstos: {
        receitas_previstas_mes_centavos: receitasPrevistasMes,
        despesas_previstas_mes_centavos: despesasPrevistasMes
      },
      // Valores Pendentes
      pendentes: {
        receitas_pendentes_mes_centavos: receitasPendentesMes,
        despesas_pendentes_mes_centavos: despesasPendentesMes,
        contas_vencidas_quantidade: contasVencidas.length,
        contas_vencidas_total_centavos: contasVencidas.reduce(function (acc, item) { return acc + item.valor_centavos; }, 0),
        contas_a_vencer_quantidade: contasAVencer.length,
        contas_a_vencer_total_centavos: contasAVencer.reduce(function (acc, item) { return acc + item.valor_centavos; }, 0),
        contas_vencidas: contasVencidas.slice(0, 15),
        contas_a_vencer: contasAVencer.slice(0, 15)
      },
      // Valores Estimados e Patrimônio (composição identificada separadamente)
      estimados: {
        resultado_mensal_projetado_centavos:
          (receitasConfirmadasMes + receitasPrevistasMes + receitasPendentesMes) -
          (despesasConfirmadasMes + despesasPrevistasMes + despesasPendentesMes),
        saldo_final_mes_projetado_centavos:
          saldoAtualConsolidadoConfirmado +
          (receitasPrevistasMes + receitasPendentesMes) -
          (despesasPrevistasMes + despesasPendentesMes),
        composicao_patrimonio: {
          saldo_bancario_confirmado_centavos: saldoAtualConsolidadoConfirmado,
          carteira_investimentos_informada_centavos: totalInvestimentosInformado,
          ativos_totais_estimados_centavos: saldoAtualConsolidadoConfirmado + totalInvestimentosInformado,
          passivos_emprestimos_ativos_centavos: totalSaldoDevedorEmprestimos,
          passivos_dividas_acordo_ativo_centavos: totalDividasAcordoAtivo,
          dividas_antigas_informativo_centavos: totalDividasAntigasInformativo,
          patrimonio_liquido_estimado_centavos:
            saldoAtualConsolidadoConfirmado + totalInvestimentosInformado - totalSaldoDevedorEmprestimos - totalDividasAcordoAtivo
        }
      },
      contas_bancarias: accountsWithBalances,
      evolucao_gastos_por_categoria: gastosPorCategoria,
      evolucao_mensal: evolucaoMensal
    };
  }

  function computeMonthlyEvolution(allLaunches, referenceMonth, monthsCount) {
    var parts = referenceMonth.split('-');
    var baseYear = parseInt(parts[0], 10);
    var baseMonth = parseInt(parts[1], 10);
    var months = [];

    for (var offset = monthsCount - 1; offset >= 0; offset--) {
      var d = new Date(Date.UTC(baseYear, baseMonth - 1 - offset, 1));
      var ym = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      months.push({
        competencia: ym,
        receitas_confirmadas_centavos: 0,
        receitas_previstas_centavos: 0,
        despesas_confirmadas_centavos: 0,
        despesas_previstas_centavos: 0
      });
    }

    var monthMap = {};
    for (var m = 0; m < months.length; m++) {
      monthMap[months[m].competencia] = months[m];
    }

    for (var i = 0; i < allLaunches.length; i++) {
      var l = allLaunches[i];
      if (l.natureza_operacao === 'TRANSFERENCIA' || l.situacao === 'CANCELADO') continue;
      var ymKey = String(l.data_lancamento).substring(0, 7);
      var bucket = monthMap[ymKey];
      if (!bucket) continue;

      var v = Number(l.valor_centavos || 0);
      if (l.tipo === 'ENTRADA') {
        if (l.situacao === 'CONFIRMADO') bucket.receitas_confirmadas_centavos += v;
        else bucket.receitas_previstas_centavos += v;
      } else if (l.tipo === 'SAIDA') {
        if (l.situacao === 'CONFIRMADO') bucket.despesas_confirmadas_centavos += v;
        else bucket.despesas_previstas_centavos += v;
      }
    }

    return months;
  }

  /**
   * Exporta lançamentos filtrados para formato CSV compatível com Excel/LibreOffice.
   */
  function exportLaunchesCsv(user, filters) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var f = filters || {};
    f.page = 1;
    f.pageSize = 5000;
    var result = listLaunches(user, f);
    var headers = [
      'ID', 'Data Lançamento', 'Data Competência', 'Tipo', 'Natureza',
      'Descrição', 'Categoria', 'Subcategoria', 'Conta Bancária',
      'Forma Pagamento', 'Situação', 'Origem', 'Valor (Centavos)', 'Valor (R$)'
    ];
    var lines = [headers.join(';')];
    for (var i = 0; i < result.items.length; i++) {
      var it = result.items[i];
      var row = [
        it.id,
        ValidationService.formatDateBr(it.data_lancamento),
        ValidationService.formatDateBr(it.data_competencia),
        it.tipo,
        it.natureza_operacao,
        '"' + String(it.descricao || '').replace(/"/g, '""') + '"',
        '"' + String(it.categoria_nome || '').replace(/"/g, '""') + '"',
        '"' + String(it.subcategoria_nome || '').replace(/"/g, '""') + '"',
        '"' + String(it.conta_bancaria_nome || '').replace(/"/g, '""') + '"',
        it.forma_pagamento,
        it.situacao,
        it.origem,
        it.valor_centavos,
        '"' + ValidationService.formatCentavosToBrl(it.valor_centavos) + '"'
      ];
      lines.push(row.join(';'));
    }
    return {
      filename: 'relatorio_lancamentos_' + SpreadsheetRepository.todayIso() + '.csv',
      totalRecords: result.items.length,
      csvContent: lines.join('\n')
    };
  }

  function updateCategoryBudget(user, categoriaId, orcamentoCentavos) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var cat = SpreadsheetRepository.findById('CATEGORIAS', categoriaId, user.grupo_id);
    if (!cat) throw new Error('Categoria não encontrada.');

    var orcamento = ValidationService.validateCentavos(orcamentoCentavos, 'orcamento_mensal_centavos', true);
    var updated = SpreadsheetRepository.updateById('CATEGORIAS', cat.id, {
      orcamento_mensal_centavos: orcamento
    }, user.grupo_id);

    AuditService.log({
      grupo_id: user.grupo_id,
      usuario_id: user.id,
      acao: 'CATEGORIA_ORCAMENTO_ATUALIZADO',
      entidade: 'CATEGORIAS',
      entidade_id: cat.id,
      origem: 'WEB',
      detalhes: { categoria: cat.nome, orcamento_centavos: orcamento }
    });

    return updated;
  }

  function getCategoryBudgetStatus(user, mesReferencia) {
    AuthService.assertGroupAccess(user, user.grupo_id);
    var todayIso = SpreadsheetRepository.todayIso();
    var ym = (mesReferencia && /^\d{4}-\d{2}$/.test(mesReferencia))
      ? mesReferencia
      : todayIso.substring(0, 7);

    var cats = SpreadsheetRepository.findByGrupo('CATEGORIAS', user.grupo_id, function (c) {
      return c.situacao !== 'INATIVA' && c.tipo !== 'ENTRADA';
    });

    var launches = SpreadsheetRepository.findByGrupo('LANCAMENTOS', user.grupo_id, function (l) {
      return l.tipo === 'SAIDA' && l.situacao !== 'CANCELADO' && l.natureza_operacao !== 'TRANSFERENCIA' && String(l.data_lancamento).substring(0, 7) === ym;
    });

    var cardPurchases = SpreadsheetRepository.findByGrupo('COMPRAS_CARTAO', user.grupo_id, function (cp) {
      return cp.situacao !== 'CANCELADA' && String(cp.data_compra).substring(0, 7) === ym;
    });

    var totalOrcado = 0;
    var totalComprometido = 0;
    var categoriasAlerta = 0;

    var resultList = cats.map(function (c) {
      var orc = Number(c.orcamento_mensal_centavos || 0);
      var gastoRealizado = 0;
      var gastoPrevisto = 0;

      for (var i = 0; i < launches.length; i++) {
        if (launches[i].categoria_id === c.id) {
          var lv = Number(launches[i].valor_centavos || 0);
          if (launches[i].situacao === 'CONFIRMADO') gastoRealizado += lv;
          else gastoPrevisto += lv;
        }
      }

      for (var cp = 0; cp < cardPurchases.length; cp++) {
        if (cardPurchases[cp].categoria_id === c.id) {
          gastoPrevisto += Number(cardPurchases[cp].valor_total_centavos || 0);
        }
      }

      var comprometido = gastoRealizado + gastoPrevisto;
      var saldo = orc - comprometido;
      var pct = orc > 0 ? Math.round((comprometido / orc) * 100) : 0;

      var faixa = 'SEM_LIMITE';
      if (orc > 0) {
        if (pct < 70) faixa = 'VERDE';
        else if (pct <= 90) { faixa = 'AMARELO'; categoriasAlerta++; }
        else if (pct <= 100) { faixa = 'LARANJA'; categoriasAlerta++; }
        else { faixa = 'VERMELHO'; categoriasAlerta++; }
      }

      totalOrcado += orc;
      totalComprometido += comprometido;

      return {
        categoria_id: c.id,
        nome: c.nome,
        icone: c.icone || 'tag',
        cor: c.cor || '#2563eb',
        orcamento_centavos: orc,
        orcamento_formatado: ValidationService.formatCentavosToBrl(orc),
        gasto_realizado_centavos: gastoRealizado,
        gasto_realizado_formatado: ValidationService.formatCentavosToBrl(gastoRealizado),
        gasto_previsto_centavos: gastoPrevisto,
        gasto_previsto_formatado: ValidationService.formatCentavosToBrl(gastoPrevisto),
        total_comprometido_centavos: comprometido,
        total_comprometido_formatado: ValidationService.formatCentavosToBrl(comprometido),
        saldo_restante_centavos: saldo,
        saldo_restante_formatado: ValidationService.formatCentavosToBrl(saldo),
        percentual_consumido: pct,
        faixa_alerta: faixa
      };
    });

    resultList.sort(function (a, b) {
      if (a.orcamento_centavos > 0 && b.orcamento_centavos === 0) return -1;
      if (a.orcamento_centavos === 0 && b.orcamento_centavos > 0) return 1;
      return b.percentual_consumido - a.percentual_consumido;
    });

    var saldoGeral = totalOrcado - totalComprometido;
    var pctGeral = totalOrcado > 0 ? Math.round((totalComprometido / totalOrcado) * 100) : 0;

    return {
      mes_referencia: ym,
      total_orcado_centavos: totalOrcado,
      total_orcado_formatado: ValidationService.formatCentavosToBrl(totalOrcado),
      total_comprometido_centavos: totalComprometido,
      total_comprometido_formatado: ValidationService.formatCentavosToBrl(totalComprometido),
      saldo_geral_centavos: saldoGeral,
      saldo_geral_formatado: ValidationService.formatCentavosToBrl(saldoGeral),
      percentual_geral: pctGeral,
      categorias_alerta_count: categoriasAlerta,
      itens: resultList
    };
  }

  return {
    listCategoriesWithSubcategories: listCategoriesWithSubcategories,
    createCategory: createCategory,
    createSubcategory: createSubcategory,
    createLaunch: createLaunch,
    updateLaunch: updateLaunch,
    confirmLaunch: confirmLaunch,
    cancelLaunch: cancelLaunch,
    listLaunches: listLaunches,
    getDashboardData: getDashboardData,
    exportLaunchesCsv: exportLaunchesCsv,
    updateCategoryBudget: updateCategoryBudget,
    getCategoryBudgetStatus: getCategoryBudgetStatus
  };
})();

