# Guia de Backup, Restauração e Migração Futura de Banco de Dados

Este documento descreve os procedimentos de backup e restauração do **Finanças Inteligentes**, bem como o protocolo de migração futura caso o volume de registros ultrapasse a capacidade prática do Google Sheets.

---

## 1. Estrutura do Backup (`SpreadsheetRepository.exportBackup`)

O sistema exporta todas as 21 abas pertencentes ao grupo financeiro autorizado (`grupo_id`) em um único arquivo JSON estruturado contendo:
- `schemaVersion`: Versão do esquema (`1.0.0`).
- `exportedAt`: Carimbo de tempo ISO-8601 da exportação.
- `exportedBy`: ID do usuário administrador que gerou o backup.
- `grupoId`: ID do grupo financeiro.
- `tables`: Objeto contendo os arrays de registros de cada uma das 21 abas (`CONFIGURACOES`, `USUARIOS`, `GRUPOS_FINANCEIROS`, `CONTAS_BANCARIAS`, `CATEGORIAS`, `SUBCATEGORIAS`, `CONTAS_RECORRENTES`, `LANCAMENTOS`, `DIVIDAS`, `EMPRESTIMOS`, `PARCELAS`, `INVESTIMENTOS`, `MOVIMENTOS_INVESTIMENTOS`, `PROJECOES`, `AGENDA_SYNC`, `NOTIFICACOES`, `ANALISES_IA`, `INTEGRACOES`, `TELEGRAM_VINCULOS`, `TELEGRAM_PROCESSAMENTOS`, `AUDITORIA`).

---

## 2. Como Executar um Backup

1. Acesse o sistema web autenticado como `OWNER` ou `ADMIN`.
2. Abra o módulo **Configurações & Telegram**.
3. No card **Backup, Restauração e Notificações**, clique em **Exportar Backup JSON**.
4. O navegador baixará o arquivo `backup_financas_inteligentes_YYYY-MM-DD.json`.
5. Complementarmente, no Google Drive, você pode criar cópias periódicas da própria planilha (`Arquivo -> Fazer uma cópia`) ou consultar o `Histórico de versões` nativo do Google Sheets.

---

## 3. Como Restaurar um Backup Preservando IDs e Relacionamentos

A função `SpreadsheetRepository.restoreBackup(backupPayload, grupoId)` opera sob bloqueio transacional (`LockService.getScriptLock()`):

1. Valida que o `backupPayload.grupoId` pertence ao grupo financeiro autorizado (impedindo sobrescrita cruzada entre grupos).
2. Executa `ensureSchema()` para garantir que todas as 21 abas e todas as colunas do esquema existem na planilha de destino.
3. Percorre as 21 tabelas preservando rigorosamente o campo `id` original de cada registro e todas as chaves estrangeiras (`categoria_id`, `subcategoria_id`, `conta_bancaria_id`, `referencia_recorrencia_id`, `referencia_parcela_id`, `investimento_id`, `transferencia_id`):
   - Se o `id` já existir na aba, atualiza o registro de forma idempotente (`updated`).
   - Se o `id` não existir, insere o registro preservando seu `id` original (`inserted`).
4. Registra o evento `BACKUP_RESTAURADO` na aba `AUDITORIA`.

---

## 4. Procedimento de Migração Futura (Quando o Volume Ultrapassar o Google Sheets)

Como toda a lógica dos serviços financeiros (`FinanceService`, `BankAccountService`, `RecurringAccountService`, `DebtService`, `LoanService`, `InvestmentService`, `TelegramLaunchService`) acessa os dados **exclusivamente** através da interface pública do `SpreadsheetRepository` (`findAll`, `findByGrupo`, `findById`, `findOne`, `insert`, `insertBatch`, `updateById`), a migração futura para um banco relacional (ex.: PostgreSQL / Cloud SQL / D1) não exige reescrever as regras de negócio:

1. Exporte o backup JSON completo pelo módulo **Configurações & Telegram** (`admin.exportBackup`).
2. Crie as 21 tabelas equivalentes no banco relacional utilizando exatamente as colunas listadas em `docs/DATA_MODEL.md` (tipos `BIGINT` para colunas `*_centavos` e `VARCHAR(64)` para `id`).
3. Importe os registros do arquivo JSON preservando os IDs primários e chaves estrangeiras.
4. Substitua apenas a implementação interna de `SpreadsheetRepository.gs` por um repositório JDBC/REST mantendo a mesma assinatura de métodos.

