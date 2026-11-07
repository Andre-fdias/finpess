# Modelo de Dados — Google Sheets (21 Abas)

O banco de dados inicial do **Finanças Inteligentes** é armazenado em uma planilha do Google Sheets gerenciada exclusivamente pelo `SpreadsheetRepository.gs`. Todas as 21 abas obrigatórias possuem cabeçalhos estáveis na linha 1, identificadores únicos imutáveis (`id`), valores monetários em **centavos inteiros** e datas em formato ISO (`YYYY-MM-DD` para datas civis e ISO-8601 `YYYY-MM-DDTHH:mm:ss.sssZ` para carimbos de tempo).

---

## Relação das 21 Abas Obrigatórias

### 1. `CONFIGURACOES`
Armazena parâmetros não-secretos de configuração por grupo financeiro ou globais do sistema (segredos como `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` e `GEMINI_API_KEY` residem exclusivamente em `PropertiesService.getScriptProperties()`).
- `id` (PK)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id` ou `GLOBAL`)
- `chave` (ex.: `MOEDA_PADRAO`, `FUSO_HORARIO`, `DIAS_ANTECEDENCIA_LEMBRETE`, `EXIGIR_CONTA_TELEGRAM`, `CALENDARIO_SYNC_ATIVO`, `SALARIO_MODO_CADASTRO`)
- `valor`
- `descricao`
- `atualizado_em`
- `atualizado_por`

### 2. `USUARIOS`
Cadastro de usuários autenticados, status de autorização e preferências individuais (incluindo tema claro/escuro).
- `id` (PK, ex.: `usr_...`)
- `email` (E-mail autenticado da conta Google, normalizado em minúsculas)
- `nome`
- `papel` (`OWNER`, `ADMIN`, `MEMBRO`)
- `status` (`PENDENTE`, `APROVADO`, `BLOQUEADO`, `REVOGADO`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `tema_preferido` (`light`, `dark`, `auto`)
- `conta_padrao_id` (FK opcional -> `CONTAS_BANCARIAS.id`)
- `notificacoes_email_ativas` (`true` | `false`)
- `criado_em`
- `atualizado_em`
- `aprovado_por`

### 3. `GRUPOS_FINANCEIROS`
Isolamento multitenant familiar ou individual. Nenhum usuário acessa registros cujo `grupo_id` divirja do seu grupo autorizado.
- `id` (PK, ex.: `grp_...`)
- `nome`
- `proprietario_id` (FK -> `USUARIOS.id`)
- `tipo` (`INDIVIDUAL`, `FAMILIAR`)
- `situacao` (`ATIVO`, `INATIVO`)
- `criado_em`
- `atualizado_em`

### 4. `CONTAS_BANCARIAS`
Contas bancárias e carteiras administradas manualmente.
- `id` (PK, ex.: `acc_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `instituicao` (ex.: `Banco do Brasil`, `Nubank`, `Caixa`, `Carteira Física`)
- `nome_identificacao` (ex.: `Conta Principal`, `Reserva`, `Dinheiro`)
- `tipo_conta` (`CORRENTE`, `POUPANCA`, `PAGAMENTO`, `DINHEIRO`, `OUTRA`)
- `saldo_inicial_centavos` (Inteiro em centavos)
- `data_saldo_inicial` (`YYYY-MM-DD`)
- `situacao` (`ATIVA`, `INATIVA`, `ARQUIVADA`)
- `observacoes`
- `criado_em`
- `atualizado_em`
- `criado_por`

### 5. `CATEGORIAS`
Categorias de receitas e despesas.
- `id` (PK, ex.: `cat_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `nome` (ex.: `Moradia`, `Alimentação`, `Saúde`, `Transporte`, `Salário`, `Renda Extra`)
- `tipo` (`ENTRADA`, `SAIDA`, `AMBOS`)
- `orcamento_mensal_centavos` (Inteiro opcional para comparativo Orçado x Realizado)
- `icone`
- `cor`
- `situacao` (`ATIVA`, `INATIVA`)
- `criado_em`

### 6. `SUBCATEGORIAS`
Subcategorias vinculadas a uma categoria principal.
- `id` (PK, ex.: `sub_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `categoria_id` (FK -> `CATEGORIAS.id`)
- `nome` (ex.: `Supermercado`, `Água`, `Energia`, `Farmácia`, `Combustível`)
- `situacao` (`ATIVA`, `INATIVA`)
- `criado_em`

### 7. `CONTAS_RECORRENTES`
Regras de despesas e receitas mensais ou periódicas (não são lançamentos realizados).
- `id` (PK, ex.: `rec_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `nome` (ex.: `Água`)
- `tipo` (`ENTRADA`, `SAIDA`)
- `categoria_id` (FK -> `CATEGORIAS.id`)
- `subcategoria_id` (FK opcional -> `SUBCATEGORIAS.id`)
- `valor_previsto_centavos` (Inteiro em centavos, ex.: `12000` para R$ 120,00)
- `natureza` (`FIXA`, `VARIAVEL`)
- `recorrencia` (`MENSAL`, `ANUAL`, `SEMANAL`, `QUINZENAL`)
- `dia_vencimento` (1 a 31)
- `data_inicio` (`YYYY-MM-DD`)
- `data_termino` (`YYYY-MM-DD` ou vazio)
- `conta_bancaria_padrao_id` (FK opcional -> `CONTAS_BANCARIAS.id`)
- `forma_pagamento` (`PIX`, `DEBITO`, `BOLETO`, `TRANSFERENCIA`, `DINHEIRO`, `AUTOMATICO`, `OUTRO`)
- `regra_competencia` (`MES_VENCIMENTO`, `MES_ANTERIOR`, `MES_SEGUINTE`)
- `notificacoes_ativas` (`true` | `false`)
- `antecedencia_lembrete_dias` (Inteiro, ex.: `3`)
- `observacoes`
- `situacao` (`ATIVA`, `PAUSADA`, `CANCELADA`)
- `criado_em`
- `atualizado_em`
- `criado_por`

### 8. `LANCAMENTOS`
Registros de entradas, saídas e pernas de transferências entre contas próprias.
- `id` (PK, ex.: `lan_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `tipo` (`ENTRADA`, `SAIDA`)
- `natureza_operacao` (`PADRAO`, `TRANSFERENCIA`, `ESTORNO`)
- `transferencia_id` (ID compartilhado entre saída e entrada de transferência entre contas próprias)
- `descricao`
- `valor_centavos` (Inteiro estritamente positivo em centavos)
- `data_lancamento` (`YYYY-MM-DD` — data de vencimento/caixa)
- `data_competencia` (`YYYY-MM-DD`)
- `data_pagamento` (`YYYY-MM-DD` quando `CONFIRMADO`)
- `categoria_id` (FK -> `CATEGORIAS.id`)
- `subcategoria_id` (FK opcional -> `SUBCATEGORIAS.id`)
- `conta_bancaria_id` (FK -> `CONTAS_BANCARIAS.id`)
- `forma_pagamento` (`PIX`, `DEBITO`, `CREDITO`, `DINHEIRO`, `BOLETO`, `TRANSFERENCIA`, `FOLHA`, `OUTRO`)
- `situacao` (`PREVISTO`, `PENDENTE`, `CONFIRMADO`, `CANCELADO`)
- `origem` (`MANUAL`, `RECORRENCIA`, `TELEGRAM`, `INTEGRACAO`)
- `referencia_recorrencia_id` (FK opcional -> `CONTAS_RECORRENTES.id`)
- `competencia_recorrencia` (`YYYY-MM` para garantir idempotência da geração mensal)
- `referencia_parcela_id` (FK opcional -> `PARCELAS.id`)
- `id_origem_externa` (Chave de idempotência externa, ex.: `tg_upd_12345` ou `rec_id_2026-10`)
- `observacoes`
- `criado_em`
- `atualizado_em`
- `usuario_responsavel_id` (FK -> `USUARIOS.id`)

### 9. `DIVIDAS`
Cadastro de dívidas existentes, inclusive antigas ou protestadas (exclusivo Web).
- `id` (PK, ex.: `div_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `credor`
- `descricao`
- `valor_original_centavos`
- `valor_atualizado_centavos`
- `data_origem` (`YYYY-MM-DD`)
- `vencimento_original` (`YYYY-MM-DD`)
- `situacao` (`ANTIGA`, `PROTESTADA`, `EM_NEGOCIACAO`, `ACORDO_ATIVO`, `QUITADA`, `CANCELADA`)
- `proposta_negociacao`
- `valor_negociado_centavos`
- `quantidade_parcelas`
- `primeiro_vencimento_acordo` (`YYYY-MM-DD`)
- `repercutir_fluxo_caixa` (`true` somente quando acordo ativo aprovado pelo usuário)
- `observacoes`
- `criado_em`
- `atualizado_em`
- `criado_por`

### 10. `EMPRESTIMOS`
Empréstimos pessoais e consignados com desconto em folha (exclusivo Web).
- `id` (PK, ex.: `emp_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `instituicao`
- `descricao`
- `tipo_emprestimo` (`PESSOAL`, `CONSIGNADO`, `FINANCIAMENTO`, `OUTRO`)
- `valor_contratado_centavos`
- `taxa_juros_mensal_bps` (Taxa informada em basis points, ex.: `185` = 1,85% a.m.)
- `numero_parcelas`
- `valor_parcela_centavos`
- `data_inicial` (`YYYY-MM-DD`)
- `dia_vencimento`
- `saldo_devedor_centavos`
- `desconto_em_folha` (`true` | `false`)
- `desconto_em_folha_ja_deduzido_salario` (`true` | `false` — evita dupla contagem quando o usuário cadastra salário líquido)
- `conta_bancaria_id` (FK opcional -> `CONTAS_BANCARIAS.id`)
- `situacao` (`ATIVO`, `QUITADO`, `SUSPENSO`, `CANCELADO`)
- `observacoes`
- `criado_em`
- `atualizado_em`
- `criado_por`

### 11. `PARCELAS`
Parcelas individuais vinculadas a acordos de `DIVIDAS` ou contratos de `EMPRESTIMOS`.
- `id` (PK, ex.: `par_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `origem_tipo` (`DIVIDA`, `EMPRESTIMO`)
- `origem_id` (FK -> `DIVIDAS.id` ou `EMPRESTIMOS.id`)
- `numero_parcela`
- `total_parcelas`
- `valor_centavos`
- `data_vencimento` (`YYYY-MM-DD`)
- `data_pagamento` (`YYYY-MM-DD` ou vazio)
- `situacao` (`PREVISTA`, `PENDENTE`, `PAGA`, `ATRASADA`, `CANCELADA`)
- `lancamento_id` (FK opcional -> `LANCAMENTOS.id`)
- `observacoes`
- `criado_em`
- `atualizado_em`

### 12. `INVESTIMENTOS`
Cadastro de ativos da carteira (exclusivo Web).
- `id` (PK, ex.: `inv_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `nome_ativo` (ex.: `Tesouro Selic 2029`, `CDB Liquidez Diária`, `BOVA11`)
- `classe_ativo` (`RENDA_FIXA`, `TESOURO_DIRETO`, `FUNDOS_IMOBILIARIOS`, `ACOES`, `FUNDOS`, `PREVIDENCIA`, `OUTROS`)
- `instituicao`
- `quantidade_milesimos` (Inteiro representando quantidade * 1000 para suportar frações sem ponto flutuante)
- `preco_medio_centavos`
- `valor_aplicado_centavos`
- `valor_mercado_informado_centavos`
- `data_referencia` (`YYYY-MM-DD`)
- `rendimentos_acumulados_centavos`
- `situacao` (`ATIVO`, `RESGATADO`, `INATIVO`)
- `observacoes`
- `criado_em`
- `atualizado_em`
- `criado_por`

### 13. `MOVIMENTOS_INVESTIMENTOS`
Histórico de aportes, resgates, rendimentos e atualizações manuais de valor de mercado.
- `id` (PK, ex.: `mvi_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `investimento_id` (FK -> `INVESTIMENTOS.id`)
- `tipo_movimento` (`APORTE`, `RESGATE`, `RENDIMENTO`, `ATUALIZACAO_MERCADO`)
- `quantidade_milesimos`
- `valor_centavos`
- `data_movimento` (`YYYY-MM-DD`)
- `conta_bancaria_id` (FK opcional -> `CONTAS_BANCARIAS.id`)
- `lancamento_id` (FK opcional -> `LANCAMENTOS.id`)
- `observacoes`
- `criado_em`
- `criado_por`

### 14. `PROJECOES`
Snapshots de cenários calculados pelo motor de projeção financeira (`ProjectionService`).
- `id` (PK, ex.: `prj_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `competencia` (`YYYY-MM`)
- `saldo_inicial_realizado_centavos`
- `receitas_confirmadas_centavos`
- `receitas_previstas_centavos`
- `despesas_confirmadas_centavos`
- `despesas_previstas_centavos`
- `parcelas_compromissos_centavos`
- `saldo_final_projetado_centavos`
- `premissas_json`
- `gerado_em`
- `gerado_por`

### 15. `AGENDA_SYNC`
Mapeamento bidirecional e controle de sincronização com o Google Calendar.
- `id` (PK, ex.: `ags_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `origem_tipo` (`LANCAMENTO`, `CONTA_RECORRENTE`, `PARCELA`)
- `origem_id`
- `calendar_id`
- `external_event_id`
- `titulo_evento`
- `data_evento` (`YYYY-MM-DD`)
- `valor_centavos`
- `status_sync` (`SINCRONIZADO`, `PENDENTE`, `CANCELADO`, `ERRO`)
- `tentativas`
- `ultimo_erro`
- `ultima_sincronizacao_em`

### 16. `NOTIFICACOES`
Fila de notificações por e-mail com controle de tentativas e prevenção de duplicidades.
- `id` (PK, ex.: `not_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `usuario_id` (FK -> `USUARIOS.id`)
- `destinatario_email`
- `tipo_notificacao` (`VENCIMENTO_PROXIMO`, `CONTA_VENCIDA`, `RESUMO_MENSAL`, `ORCAMENTO_PROXIMO_MES`, `FALHA_SISTEMA`)
- `referencia_id`
- `idempotency_key` (Ex.: `notif_VENCIMENTO_PROXIMO_lan_123_2026-10-29`)
- `assunto`
- `resumo_corpo` (Sem dados sensíveis desnecessários)
- `status` (`FILA`, `ENVIADO`, `ERRO`, `CANCELADO`)
- `tentativas`
- `ultimo_erro`
- `agendado_para`
- `enviado_em`
- `criado_em`

### 17. `ANALISES_IA`
Registro de consultas e análises geradas pelo Oráculo IA.
- `id` (PK, ex.: `aia_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `usuario_id` (FK -> `USUARIOS.id`)
- `periodo_analisado`
- `pergunta_usuario`
- `fatos_calculados_json` (Cálculos determinísticos executados pelo backend)
- `recomendacao_ia` (Texto explicativo gerado pelo modelo)
- `provedor_modelo`
- `criado_em`

### 18. `INTEGRACOES`
Estado operacional, quotas e saúde das integrações externas (Telegram, Calendar, Gemini, MailApp).
- `id` (PK, ex.: `int_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `servico` (`TELEGRAM`, `GOOGLE_CALENDAR`, `GEMINI_IA`, `EMAIL_MAILAPP`)
- `status` (`ATIVO`, `INATIVO`, `SIMULACAO_DRY_RUN`, `ERRO_QUOTA`)
- `config_publica_json` (Metadados não-secretos)
- `ultima_execucao_em`
- `ultimo_status_msg`
- `atualizado_em`

### 19. `TELEGRAM_VINCULOS`
Vínculo seguro entre contas do sistema e identificadores internos do Telegram, além de códigos temporários de uso único.
- `id` (PK, ex.: `tgv_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `usuario_id` (FK -> `USUARIOS.id`)
- `telegram_user_id` (ID numérico imutável do usuário no Telegram)
- `telegram_chat_id` (ID do chat privado)
- `codigo_vinculacao_hash` (Hash SHA-256 do código temporário de uso único)
- `codigo_expira_em` (Timestamp ISO)
- `codigo_usado` (`true` | `false`)
- `status_vinculo` (`AGUARDANDO_CODIGO`, `ATIVO`, `REVOGADO`)
- `vinculado_em`
- `revogado_em`
- `criado_em`

### 20. `TELEGRAM_PROCESSAMENTOS`
Máquina de estados e controle de idempotência de mensagens/áudios e propostas de lançamentos do Telegram.
- `id` (PK, ex.: `tgp_...`)
- `grupo_id` (FK -> `GRUPOS_FINANCEIROS.id`)
- `usuario_id` (FK -> `USUARIOS.id`)
- `telegram_update_id` (Chave única de idempotência da atualização do Telegram)
- `telegram_message_id`
- `telegram_chat_id`
- `tipo_entrada` (`TEXTO`, `AUDIO`, `COMANDO`)
- `estado` (`RECEBIDO`, `PROCESSANDO`, `PENDENTE_DE_INFORMACAO`, `AGUARDANDO_CONFIRMACAO`, `CONFIRMADO`, `CANCELADO`, `EXPIRADO`, `ERRO`)
- `dados_extraidos_json` (JSON estruturado validado da proposta)
- `campos_pendentes_json`
- `preview_hash` (Hash SHA-256 vinculando `usuario_id` + `telegram_message_id` + `dados_extraidos_json`)
- `lancamento_gerado_id` (FK opcional -> `LANCAMENTOS.id`)
- `expira_em` (Prazo de validade da proposta pendente)
- `erro_msg`
- `criado_em`
- `atualizado_em`

### 21. `AUDITORIA`
Trilha imutável de auditoria para operações relevantes de segurança e finanças.
- `id` (PK, ex.: `aud_...`)
- `grupo_id`
- `usuario_id`
- `acao` (ex.: `LOGIN`, `USUARIO_STATUS_ALTERADO`, `LANCAMENTO_CRIADO`, `LANCAMENTO_CONFIRMADO_TELEGRAM`, `LANCAMENTO_CANCELADO`, `RECORRENCIA_ALTERADA`, `TELEGRAM_VINCULADO`, `TELEGRAM_REVOGADO`, `BACKUP_EXPORTADO`, `BACKUP_RESTAURADO`, `ACESSO_NEGADO`)
- `entidade`
- `entidade_id`
- `origem` (`WEB`, `TELEGRAM`, `JOB_AUTOMATICO`, `SISTEMA`)
- `detalhes_resumo` (Sanitizado sem tokens, sem senhas e sem áudios brutos)
- `criado_em`

