# AUDITORIA TÉCNICA INDEPENDENTE — ECOSSISTEMA COMERCIAL FINPESS

> **Data de Emissão:** 14 de Novembro de 2026  
> **Status:** AUDITORIA INDEPENDENTE CONCLUÍDA  
> **Modo de Operação:** ESTRITAMENTE LEITURA E AUDITORIA (Nenhum código ou configuração foi modificado)  
> **Branch Auditada:** `feature-commercial-licensing` (Commit `2018353`)  
> **Tag de Referência:** `v1.0.0-pre-commercial-audit`  
> **Classificação Final:** **REPROVADO PARA PRODUÇÃO (Exige correções obrigatórias antes da comercialização)**

---

## 1. RESUMO EXECUTIVO

Esta auditoria técnica independente foi realizada confrontando:
1. O blueprint documental `arquitetura-comercial-ecossistema-finpess.md`;
2. A implementação real na branch `feature-commercial-licensing`;
3. A suíte de testes automatizados (`tests/run-all.js`);
4. A arquitetura original do sistema Finpess.

### Diagnóstico Resumido:
- **Avanços Reais e Positivos**: O desacoplamento do ID da planilha em `SetupService.gs` e `SpreadsheetRepository.gs` foi efetivado; a suíte de testes foi ampliada para 10 suítes e 83 cenários; o isolamento da base financeira do cliente na própria planilha Google do comprador é uma escolha sólida para conformidade com a LGPD; o copywriting e os termos legais para o Google Sites foram elaborados de forma completa.
- **Falhas Críticas Encontradas (Bloqueadores Comerciais)**:
  1. **Ativação Falsa Sem Verificação**: A função `LicenseService.activateLicense` aceita **qualquer string** que case com a expressão regular `/^FINP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i` sem contatar o servidor central e sem verificar assinatura criptográfica.
  2. **Webhook de Pagamento Desprotegido**: O endpoint `payment.webhook` em `LicensingServer.gs` não valida assinaturas HMAC de gateways (Mercado Pago, Kiwify, Hotmart), não valida valores monetários e não possui controle de idempotência.
  3. **Bypass do Bloqueio de Escrita**: O Bot do Telegram (`TelegramLaunchService.gs`) e rotinas de contas recorrentes (`RecurringAccountService.gs`) **não consultam o `LicenseService`**, permitindo lançamentos mesmo com o teste ou a licença expirados.
  4. **Divergência de Nomenclatura no RPC Router**: Em `src/Code.gs`, o guardião `WRITE_ACTIONS` utiliza chaves que não coincidem com as ações reais de cartões de crédito (ex: `cards.create` vs `creditCards.create`), deixando operações de cartão fora do bloqueio de licença.
  5. **Paradoxo Criptográfico Simétrico**: O servidor utiliza HMAC-SHA256, mas para que o cliente valide o token offline de forma independente, precisaria do segredo mestre, o que vazaria a chave. A solução requer assinatura assimétrica (chaves pública/privada).
  6. **Reinício Infinito de Trial**: O método `startTrial` pode ser reinocado após a expiração, redefinindo o prazo para mais 14 dias indefinidamente.

Diante da severidade dessas brechas, o parecer técnico mandatório é **REPROVADO PARA PRODUÇÃO** até a conclusão das correções obrigatórias especificadas neste documento.

---

## 2. COMPONENTES EFETIVAMENTE ENCONTRADOS

| Componente Mapeado | Arquivo Localizado | Status Real | Parecer Técnico |
| :--- | :--- | :---: | :--- |
| **Banco Comercial (Schema)** | `commercial-licensing-server/CommercialSchema.gs` | **PRESENTE** | Define o objeto `COMMERCIAL_SHEETS_SCHEMA` com 8 abas. Falta a classe repositório de persistência real no Sheets. |
| **Servidor de Licenças** | `commercial-licensing-server/LicensingServer.gs` | **PRESENTE** | Possui lógica de emissão e assinatura HMAC, mas opera com mocks de persistência e webhook desprotegido. |
| **Módulo Cliente de Licença** | `src/LicenseService.gs` | **PRESENTE** | Controla estados e bloqueio de escrita em memória/propriedades, mas valida seriais apenas por Regex local. |
| **RPC Router e Guardião** | `src/Code.gs` | **PRESENTE** | Whitelist e `WRITE_ACTIONS` adicionados, porém com divergências em nomes de métodos. |
| **Instalador Desacoplado** | `src/SetupService.gs` | **PRESENTE** | Hardcoded `TARGET_SPREADSHEET_ID` removido. Auto-detecção de planilha ativa implementada. |
| **Repositório Central** | `src/SpreadsheetRepository.gs` | **PRESENTE** | `DEFAULT_SPREADSHEET_ID` zerado. Adicionado retry exponencial em `withLock`. |
| **Manual de Template** | `template-spreadsheet/README.md` | **PRESENTE** | Documenta o link `/copy` para o comprador. |
| **Site e Termos (Copy)** | `commercial-site/*.md` | **PRESENTE** | Copywriting das 12 páginas, Termos de Uso e Política de Privacidade LGPD completos. |
| **Suíte de Licenciamento** | `tests/licensing-commercial-tests.js` | **PRESENTE** | 8 cenários executados com sucesso no harness Node.js. |
| **Orquestrador de Testes** | `tests/run-all.js` | **PRESENTE** | 10 suítes integradas, 83 asserções ativas. |

---

## 3. FUNCIONALIDADES IMPLEMENTADAS VS NÃO IMPLEMENTADAS

### ✅ Efetivamente Implementadas:
- Desacoplamento dinâmico da planilha do comprador (`getActiveSpreadsheet().getId()`).
- Remoção do ID de planilha do desenvolvedor no `SetupService.gs` e `SpreadsheetRepository.gs`.
- Guardião central de mutação no `Code.gs` para lançamentos, categorias e contas bancárias.
- Tolerância para leitura e exportação CSV mesmo quando a licença está expirada.
- Resiliência contra concorrência com retentativas exponenciais no `withLock`.
- Suíte automatizada de testes cobrindo transições de estados da licença.

### ❌ Documentadas mas NÃO Implementadas (Lacunas Críticas):
1. **Comunicação Cliente-Servidor (Heartbeat Online)**: `LicenseService.gs` não realiza nenhuma chamada HTTP (`UrlFetchApp.fetch`) ao `LicensingServer.gs`. Não há comunicação real entre a planilha do cliente e o servidor de licenças.
2. **Validação Criptográfica no Cliente**: O cliente não valida tokens assinados pelo servidor.
3. **Persistência Real no Banco Comercial**: `LicensingServer.gs` depende de um parâmetro `commercialRepo` que não está instanciado; na ausência dele, utiliza um mock volátil em memória.
4. **Proteção Anti-Clonagem Funcional**: Conflito entre `SpreadsheetRepository.getSpreadsheet()` (que atualiza `SPREADSHEET_ID` automaticamente na cópia) e `LicenseService.getLicenseInfo()` (que compara o ID gravado com o ID ativo), impedindo a detecção real de clones.
5. **Verificação de Webhooks de Pagamento**: Falta integração de validação de assinatura para Mercado Pago (`x-signature`), Kiwify ou Hotmart.

---

## 4. VULNERABILIDADES IDENTIFICADAS E CLASSIFICAÇÃO DE RISCO

| ID | Severidade | Arquivo | Linha / Função | Descrição Técnica | Cenário de Exploração | Impacto Comercial | Correção Obrigatória |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **VULN-COM-01** | **CRÍTICO** | `src/LicenseService.gs` | L250-254 (`activateLicense`) | **Ativação Falsa Sem Verificação Remota nem Assinatura**. O método apenas valida se o serial atende à Regex `FINP-XXXX-XXXX-XXXX`. | Usuário digita `FINP-AAAA-BBBB-CCCC` e ativa o sistema vitalício com plano completo sem pagar. | Pirataria trivial imediata. Perda total de receita comercial. | O cliente deve enviar o serial ao `LicensingServer` via `UrlFetchApp` e receber um token criptográfico assinado. |
| **VULN-COM-02** | **CRÍTICO** | `commercial-licensing-server/LicensingServer.gs` | L167-200 (`handlePaymentWebhook`) | **Webhook de Pagamento Desprotegido**. Não há validação de token secreto, assinatura de gateway ou valor pago. | Qualquer pessoa envia um HTTP POST falso para o Web App simulando compra e obtém seriais válidos ilimitados. | Emissão descontrolada de seriais comerciais legítimos para invasores. | Validar a assinatura HMAC do gateway, o valor do plano, moeda e rejeitar requisições sem autenticação. |
| **VULN-COM-03** | **CRÍTICO** | `src/TelegramLaunchService.gs` / `RecurringAccountService.gs` | Módulos inteiros | **Bypass de Licença pelo Bot do Telegram e Recorrências**. Operações de escrita via chat do Telegram não passam pelo `LicenseService.assertCanWrite()`. | Comprador com licença expirada continua adicionando despesas e receitas por áudio/texto no Telegram. | Ineficácia do bloqueio por expiração de licença. | Inserir chamada obrigatória a `LicenseService.assertCanWrite()` no início de `TelegramLaunchService.processFinancialConfirmation`. |
| **VULN-COM-04** | **ALTO** | `src/LicenseService.gs` | L207-214 (`startTrial`) | **Reinício Infinito do Período de Teste**. Quando o status muda para `EXPIRED`, `startTrial` pode ser chamado novamente, reiniciando mais 14 dias. | Usuário cujo trial acabou aciona a rota `license.startTrial` via console e ganha mais 14 dias indefinidamente. | Uso gratuito perpétuo sem conversão em compra. | Impedir reinício de trial se `LICENSE_TRIAL_START` já foi preenchido ou se o e-mail já utilizou o benefício. |
| **VULN-COM-05** | **ALTO** | `src/Code.gs` | L274-287 (`WRITE_ACTIONS`) | **Descasamento de Nomes no Router de Cartões e Metas**. As chaves em `WRITE_ACTIONS` são `cards.*` e `goals.addDeposit`, mas o `switch(act)` escuta `creditCards.*` e `goals.contribute`. | Usuário com licença expirada não consegue criar lançamentos, mas continua cadastrando compras de cartão e aportes em metas. | Vazamento de operações de escrita sem bloqueio de licença. | Corrigir a matriz `WRITE_ACTIONS` para refletir exatamente os nomes de rotas do `switch(act)`. |
| **VULN-COM-06** | **ALTO** | `commercial-licensing-server/LicensingServer.gs` | L11-12 | **Segredo Mestre Hardcoded como Fallback**. Se `PropertiesService` não tiver `FINPESS_MASTER_SECRET`, usa string pública do código. | Atacante assina tokens válidos usando a chave padrão pública presente no repositório. | Falsificação de licenças por engenharia reversa. | Bloquear inicialização do servidor se a propriedade `FINPESS_MASTER_SECRET` não estiver configurada no cofre seguro. |
| **VULN-COM-07** | **MÉDIO** | `src/NotificationService.gs` | L803 | **URL de Deployment Hardcoded Remanescente**. Fallback aponta para Web App específico do desenvolvedor. | E-mails de notificação de compradores podem direcionar para o ambiente de testes do desenvolvedor. | Exposição do ambiente de homologação a clientes. | Remover URL estática e obter exclusivamente de `ScriptApp.getService().getUrl()` ou propriedade. |
| **VULN-COM-08** | **MÉDIO** | `commercial-licensing-server/LicensingServer.gs` | L32-41 (`generateRandomSerial`) | **Entropia Baseada em `Math.random()`**. O gerador de seriais não utiliza PRNG criptográfico. | Geração de seriais previsíveis em caso de amostragem estatística de números pseudo-aleatórios do motor V8. | Risco de enumeração de seriais comerciais válidos. | Utilizar `crypto.randomBytes` ou `Utilities.getRandomBytes` para geração de seriais. |

---

## 5. EVIDÊNCIAS NO CÓDIGO FONTE

### Evidência 1: Ativação por Regex sem Validação Remota
**Arquivo:** [src/LicenseService.gs](file:///c:/Users/andre_we17otv/OneDrive%20-%20z5mh6/Github/finpess/src/LicenseService.gs#L250-L270)
```javascript
  function activateLicense(serial, buyerEmail, tokenPayload) {
    var cleanSerial = String(serial || '').trim().toUpperCase();
    if (!SERIAL_REGEX.test(cleanSerial)) {
      throw new Error('SERIAL_INVALIDO: O formato do serial informado é inválido. Utilize o formato FINP-XXXX-XXXX-XXXX.');
    }
    // NENHUMA CHAMADA UrlFetchApp AO SERVIDOR COMERCIAL!
    // NENHUMA VERIFICAÇÃO DE ASSINATURA CRIPTOGRÁFICA!
    if (props) {
      props.setProperty('LICENSE_STATUS', 'ACTIVE');
      props.setProperty('LICENSE_SERIAL', cleanSerial);
```

### Evidência 2: Webhook Sem Autenticação e Sem Idempotência
**Arquivo:** [commercial-licensing-server/LicensingServer.gs](file:///c:/Users/andre_we17otv/OneDrive%20-%20z5mh6/Github/finpess/commercial-licensing-server/LicensingServer.gs#L167-L185)
```javascript
  function handlePaymentWebhook(payload, headers, commercialRepo) {
    var p = payload || {};
    // 'headers' é recebido mas NUNCA utilizado para checar assinatura HMAC!
    var email = (p.buyer && p.buyer.email) || (p.customer && p.customer.email) || p.email || '';
    // Gera serial imediatamente para qualquer requisição com e-mail:
    var serial = generateRandomSerial();
```

### Evidência 3: Descasamento de Ações de Cartão no RPC Router
**Arquivo:** [src/Code.gs](file:///c:/Users/andre_we17otv/OneDrive%20-%20z5mh6/Github/finpess/src/Code.gs#L274-L278) vs [src/Code.gs](file:///c:/Users/andre_we17otv/OneDrive%20-%20z5mh6/Github/finpess/src/Code.gs#L427-L443)
```javascript
// No WRITE_ACTIONS (Linha 274):
'cards.create': 'cadastrar cartão de crédito',
'cards.addPurchase': 'cadastrar compra no cartão',

// No switch(act) (Linhas 427 e 439):
case 'creditCards.create': // NUNCA É BLOQUEADO!
case 'creditCards.purchases.create': // NUNCA É BLOQUEADO!
```

---

## 6. AUDITORIA CRIPTOGRÁFICA

### 6.1 O Problema do HMAC em Clientes Distribuídos
A arquitetura proposta documentou:
$$\text{Assinatura} = \text{HMAC-SHA256}(\text{MASTER\_SECRET\_KEY}, \text{Payload})$$
- Em criptografia simétrica (HMAC), **a mesma chave usada para assinar é necessária para verificar**.
- Se a planilha do cliente (`LicenseService.gs`) precisar verificar o token offline sem contatar o servidor, a `MASTER_SECRET_KEY` teria que estar embutida no código da planilha ou nas suas propriedades.
- Isso permitiria a qualquer comprador inspecionar o código, extrair a chave mestre e gerar licenças ilimitadas para terceiros.
- **Solução Criptográfica Correta**: **Criptografia Assimétrica (Chave Pública/Privada)**.
  - O **Servidor Central** detém a **Chave Privada** (ex: RSA 2048 bits ou Ed25519) e assina a licença.
  - A **Planilha do Cliente** detém apenas a **Chave Pública** embutida. Ela consegue verificar a autenticidade e a validade da licença offline com 100% de segurança matemática, sem jamais ter o poder de forjar novas assinaturas.

### 6.2 Entropia de Seriais
- Alfabeto: 32 símbolos (`Base32`).
- Comprimento: 12 caracteres (excluindo prefixo e hífens).
- Espaço de chaves: $32^{12} = 2^{60} \approx 1,15 \times 10^{18}$ combinações.
- **Ressalva**: O uso de `Math.random()` fragiliza a entropia teórica de 60 bits, tornando-a vulnerável a predição de números pseudo-aleatórios.

---

## 7. AUDITORIA DE ISOLAMENTO, PRIVACIDADE E MULTI-TENANCY

### 7.1 Simulação de Três Compradores Independentes (Clientes A, B e C)
1. **Modelo de Planilha Pessoal (Container-Bound)**:
   - Se cada comprador possui sua própria planilha no seu próprio Google Drive, os dados financeiros estão **100% isolados**. O Cliente A não tem permissão no Drive do Cliente B.
   - O vendedor **não tem acesso operacional aos dados financeiros**.
   - Em conformidade com a LGPD: o banco comercial não armazena saldos, receitas ou despesas.
2. **Perigo no Modelo Standalone Web App ("Execute as: Me")**:
   - Caso o desenvolvedor publique a aplicação central como Web App autônomo com configuração `"Execute as: Me"` e use `PropertiesService.getScriptProperties()` para armazenar o `SPREADSHEET_ID`, **todos os compradores compartilharão a mesma propriedade global**, gerando colisão catastrófica de dados.
   - **Exigência**: A publicação deve rodar sob o contexto container-bound de cada planilha ou via Web App publicado como `"Execute as: User accessing the web app"`, onde o token OAuth pertence ao usuário autenticado.

---

## 8. MATRIZ DE AUDITORIA DO RPC ROUTER (`Code.gs`)

Abaixo está o mapeamento dos principais métodos em relação ao controle de licença e permissões:

| Rota RPC (`act`) | Finalidade | Tipo | Requer Auth? | Requer Licença? | Bloqueado na Expiração? | Falha Identificada |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `launches.create` | Criação de lançamento financeiro | ESCRITA | Sim | Sim | ✅ **SIM** | Nenhuma |
| `launches.update` | Edição de lançamento | ESCRITA | Sim | Sim | ✅ **SIM** | Nenhuma |
| `launches.confirm` | Confirmação de lançamento | ESCRITA | Sim | Sim | ✅ **SIM** | Nenhuma |
| `launches.cancel` | Cancelamento de lançamento | ESCRITA | Sim | Sim | ✅ **SIM** | Nenhuma |
| `launches.exportCsv` | Exportação de dados do cliente | LEITURA | Sim | Não | ❌ NÃO (Permitido) | Conforme especificado (preserva exportação) |
| `dashboard.get` | Visualização de saldos e gráficos | LEITURA | Sim | Não | ❌ NÃO (Permitido) | Conforme especificado (preserva consulta) |
| `creditCards.create` | Cadastro de novo cartão | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: chave `cards.create` divergiu de `creditCards.create` |
| `creditCards.purchases.create` | Registro de compra no cartão | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: não interceptado por `WRITE_ACTIONS` |
| `creditCards.invoices.pay` | Pagamento de fatura de cartão | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: não interceptado por `WRITE_ACTIONS` |
| `goals.contribute` | Aporte em meta financeira | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: chave `goals.addDeposit` divergiu de `goals.contribute` |
| `debts.payInstallment` | Pagamento de parcela de dívida | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: ausente em `WRITE_ACTIONS` |
| `loans.payInstallment` | Pagamento de parcela de empréstimo | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: ausente em `WRITE_ACTIONS` |
| `investments.recordMovement` | Aporte/Resgate de investimento | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: ausente em `WRITE_ACTIONS` |
| `telegram.webhook` | Lançamento via Telegram | ESCRITA | Sim | Sim | ⚠️ **NÃO** | **Vulnerabilidade**: bypass total de `LicenseService` |

---

## 9. AUDITORIA DE CAPACIDADE E LIMITES DO GOOGLE APPS SCRIPT

Revisão técnica das cotas do Google Apps Script Gratuito (contas `@gmail.com`) para diferentes volumes de clientes:

| Quantidade de Clientes | Chamadas Diárias ao Servidor de Licenças | Tempo de CPU Estimado / Dia | Concorrência Estimada no Horário de Pico | Diagnóstico de Viabilidade (Conta Gratuita) |
| :---: | :---: | :---: | :---: | :--- |
| **10 clientes** | ~30 a 50 chamadas/dia | ~1 a 2 minutos | 1 a 2 execuções simultâneas | ✅ **Totalmente Estável**. |
| **50 clientes** | ~150 a 250 chamadas/dia | ~5 a 8 minutos | 2 a 4 execuções simultâneas | ✅ **Estável**. Sem riscos de cota. |
| **100 clientes** | ~300 a 600 chamadas/dia | ~10 a 18 minutos | 4 a 8 execuções simultâneas | ✅ **Viável**. Monitorar picos das 07:00h às 09:00h. |
| **250 clientes** | ~800 a 1.500 chamadas/dia | ~30 a 55 minutos | 10 a 18 execuções simultâneas | ⚠️ **Atenção**. Aproxima-se do limite de 90 min/dia se houver retentativas de webhook. |
| **500 clientes** | ~1.500 a 3.500 chamadas/dia | **~60 a 110 minutos** | **18 a 35 simultâneas** | ❌ **Risco de Travamento**. Excede 90 min/dia e atinge o teto de 30 execuções concorrentes do GAS. |

> **Recomendação**: Para operações com mais de 250 clientes ativos simultâneos, o Servidor de Licenças deve migrar para **Cloudflare Workers** (gratuito até 100.000 requisições/dia) mantendo as planilhas dos clientes no Google Sheets.

---

## 10. MATRIZ DE CONFORMIDADE COM OS REQUISITOS ORIGINAIS

| Requisito Original | Classificação | Justificativa Técnica |
| :--- | :---: | :--- |
| **1. Isolamento dos Dados do Comprador** | **APROVADO** | Cada cliente é dono de sua planilha no Drive. O banco comercial não armazena lançamentos financeiros. |
| **2. Zero Acesso do Vendedor aos Dados Financeiros** | **APROVADO** | Operações rodam na identidade do usuário. O vendedor não recebe cópias de extratos. |
| **3. Desacoplamento de IDs de Planilha** | **APROVADO** | IDs hardcoded do desenvolvedor removidos de `SetupService` e `SpreadsheetRepository`. |
| **4. Preservação de Dados e Exportação na Expiração** | **APROVADO** | `dashboard.get` e `launches.exportCsv` continuam 100% funcionais quando a licença expira. |
| **5. Bloqueio Completo de Mutações Financeiras** | **REPROVADO** | Furos no Telegram, compras de cartão de crédito, investimentos e parcelas de empréstimos. |
| **6. Sistema de Licenciamento por Serial Criptográfico** | **PARCIAL** | Formato de serial criado, mas a ativação no cliente é simulada por Regex sem checagem de assinatura. |
| **7. Prevenção Real Contra Clonagem** | **REPROVADO** | `SpreadsheetRepository` atualiza o ID da planilha copiada antes que o `LicenseService` detecte a diferença. |
| **8. Webhooks de Pagamento Seguros** | **REPROVADO** | Endpoint não valida assinaturas HMAC de gateways e não implementa idempotência. |
| **9. Tolerância Offline com Proteção Contra Manipulação** | **PARCIAL** | Cache de propriedades existe, mas depende de validação simétrica que vazaria a chave privada. |
| **10. Site Comercial com 12 Páginas e Termos LGPD** | **APROVADO** | Conteúdo das 12 páginas, termos de uso e política de privacidade redigidos de forma completa. |

---

## 11. CORREÇÕES OBRIGATÓRIAS (PLANO DE REMEDIAÇÃO)

Antes de qualquer liberação comercial ou publicação em produção, as seguintes etapas devem ser executadas:

### Prioridade P0 (Bloqueadores Comerciais Absolutos):
1. **Unificação dos Nomes no Router `WRITE_ACTIONS`** (`src/Code.gs`):
   - Mapear corretamente todas as rotas de mutação: `creditCards.create`, `creditCards.purchases.create`, `creditCards.invoices.pay`, `goals.contribute`, `debts.payInstallment`, `loans.payInstallment`, `investments.recordMovement`, `investments.deleteAsset`.
2. **Proteção de Licença no Telegram** (`src/TelegramLaunchService.gs`):
   - Chamar `LicenseService.assertCanWrite('lançamento via Telegram')` antes de persistir dados vindos do bot.
3. **Bloqueio de Reinício Indevido de Trial** (`src/LicenseService.gs`):
   - Gravar flag permanente e validar se a instalação já consumiu seu período de avaliação.
4. **Proteção e Autenticação do Webhook de Pagamento** (`commercial-licensing-server/LicensingServer.gs`):
   - Implementar verificação de cabeçalho de assinatura do provedor de pagamento (HMAC secret do webhook) e idempotência por `order_id`.
5. **Comunicação Real de Ativação**:
   - `LicenseService.activateLicense` deve fazer requisição HTTPS ao `LicensingServer` para validar se o serial é genuíno e obter o token criptográfico de ativação.

### Prioridade P1 (Hardening Criptográfico e Arquitetural):
6. **Migração para Assinatura Assimétrica (RSA/Ed25519)**:
   - O servidor assina com chave privada; o cliente valida offline com chave pública embutida.
7. **Correção do Mecanismo Anti-Clone**:
   - Persistir o ID de criação original imutável em célula protegida ou metadado oculto da planilha que não seja sobrescrito pelo `SpreadsheetRepository`.
8. **Substituição de `Math.random()` por CSPRNG**:
   - Usar `Utilities.getRandomBytes()` para geração de seriais e nonces.
9. **Eliminação de URLs de Homologação em `NotificationService.gs`**.

---

## 12. PARECER FINAL

### Classificação Mandatória:
## ❌ **REPROVADO PARA PRODUÇÃO**

### Justificativa Técnica:
Apesar da excelência das regras financeiras e da solidez do modelo de isolamento de dados no Google Drive do comprador, a camada comercial atualmente possui **vulnerabilidades de desvio trivial de licença** (ativação por qualquer string no padrão de serial, bypass pelo bot do Telegram, furos em transações de cartão de crédito e webhook de checkout sem verificação de assinatura).

Publicar o sistema no estado atual exporia o negócio a pirataria imediata em grupos de rateio, uso gratuito perpétuo e emissão descontrolada de seriais.

---

> ⚠️ **CONFORMIDADE COM AS REGRAS DE AUDITORIA**: Nenhuma alteração de código, merge ou publicação foi realizada nesta intervenção. O repositório permanece no estado original, aguardando suas diretrizes sobre as correções obrigatórias.

