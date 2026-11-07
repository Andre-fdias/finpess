# Finanças Inteligentes 💰

Sistema profissional de controle financeiro pessoal e familiar desenvolvido em **Google Apps Script (V8)**, **Google Sheets (28 abas)**, **HTML5 / CSS3 / JavaScript Responsivo**, **Clasp**, **Oráculo IA (Gemini 2.0 / 1.5 Flash)** e **Bot do Telegram (Texto e Áudio)**.

---

## 🚀 Como Instalar e Configurar o Sistema (Passo a Passo)

Você pode instalar o **Finanças Inteligentes** de duas maneiras: **Automática** (via terminal e script PowerShell) ou **Manual** (diretamente no seu navegador pelo Google Drive e Google Apps Script).

---

### Opção 1: Instalação Automática (Recomendada via Clasp / PowerShell)

Se você tem o **Node.js** instalado e quer fazer o deploy em minutos:

1. **Habilite a Google Apps Script API:**  
   Acesse [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings) e marque a opção **Google Apps Script API** como **Ativado (On)**.

2. **Clone o repositório:**
   ```bash
   git clone https://github.com/seu-usuario/finpess.git
   cd finpess
   ```

3. **Autentique no Google Clasp:**
   ```bash
   npx @google/clasp login
   ```
   *(Uma janela do navegador se abrirá solicitando autorização para a sua conta Google).*

4. **Execute o Script de Deploy Automático:**
   No Windows PowerShell:
   ```powershell
   .\deploy-automatico.ps1
   ```
   O script cria o vínculo no `.clasp.json`, envia os 53 arquivos do backend e frontend (`src/`) e publica a versão ativa do Web App.

5. **Pronto!** Abra a URL fornecida pelo script e comece a usar.

---

### Opção 2: Instalação Manual pelo Navegador (Sem Instalar Nada no PC)

Se preferir fazer tudo diretamente pelo navegador, sem usar terminal ou Node.js:

1. **Crie uma Planilha no Google Drive:**
   - Acesse [sheets.new](https://sheets.new) para criar uma nova planilha em branco.
   - Nomeie como **"Finanças Inteligentes — Banco de Dados"**.
   - Copie o **ID da Planilha** na barra de endereços (o código entre `/d/` e `/edit`).

2. **Abra o Editor do Apps Script:**
   - Na planilha, vá em **Extensões** > **Apps Script**.
   - Nomeie o projeto como **"Finanças Inteligentes"**.

3. **Copie os Arquivos da Pasta `src/`:**
   - Para cada arquivo `.gs` em `src/`, clique em **+** > **Script**, digite o nome e cole o código.
   - Para cada arquivo `.html` em `src/`, clique em **+** > **HTML**, digite o nome e cole o código.
   - Nas **Configurações do Projeto** (ícone ⚙️), marque *"Mostrar arquivo de manifesto 'appsscript.json' no editor"* e cole o conteúdo de `src/appsscript.json`.

4. **Configure as Propriedades do Script:**
   - Ainda nas Configurações (⚙️), role até **Propriedades do Script** e adicione:
     - `SPREADSHEET_ID`: O ID da sua planilha Google.
     - `OWNER_EMAIL`: Seu e-mail da conta Google principal.

5. **Publique como Web App:**
   - Clique no botão azul **Implantar** > **Nova implantação**.
   - Selecione o tipo **App da Web**.
   - Preencha:
     - **Executar como:** `Eu (seu_email@gmail.com)`
     - **Quem pode acessar:** `Qualquer pessoa` *(necessário para o Webhook do Telegram funcionar)*.
   - Clique em **Implantar** e autorize as permissões na tela do Google (*Avançado > Acessar Finanças Inteligentes*).
   - Copie a **URL do App da Web** gerada.

---

### 📱 Como Instalar no Celular (Android e iPhone / iOS)

O sistema possui interface adaptada para celular com barra inferior (*Bottom Navigation*), sem rolagem horizontal e com suporte a temas Claro e Escuro.

- **No Android (Google Chrome):** Abra a URL da Web App, toque no menu `⋮` (canto superior direito) e selecione **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
- **No iPhone / iPad (Safari):** Abra a URL no Safari, toque no ícone de **Compartilhar** (quadrado com seta para cima) e selecione **"Adicionar à Tela de Início"**.

---

### 🔔 Configurar Envio Diário de E-mail Matinal (Resumo Unificado)

Para receber todos os dias pela manhã um único e-mail elegante com as contas a vencer (janela de 3 dias) e contas em atraso:
1. No editor do Apps Script, clique no menu lateral esquerdo no ícone de relógio ⏰ (**Acionadores**).
2. Clique em **+ Adicionar acionador**.
3. Selecione a função `enviarResumoMatinalContas`, fonte `Baseado no tempo`, `Temporizador por dia` e selecione o horário matinal (ex.: `06:00 às 07:00`).

---

## Principais Funcionalidades e Diferenciais do Sistema

1. **Gestão de Contas Bancárias com Titularidade:**
   - Cadastro completo de contas correntes, poupanças, carteiras e contas digitais.
   - **Vínculo com Usuários do Sistema:** Ao cadastrar ou editar uma conta bancária, selecione quem é o **Proprietário / Titular da Conta** entre os membros aprovados da família ou equipe.
   - Extrato analítico por período, conciliação manual de saldo e transferências entre contas próprias (`TRANSFERENCIA`) sem distorcer despesas e receitas.

2. **Módulo Completo de Cartões de Crédito e Faturas:**
   - Acompanhamento de limites concedidos, disponíveis e comprometidos.
   - Cálculo automático do **Melhor Dia de Compra** com base no dia de fechamento.
   - Compras parceladas distribuídas cronologicamente nas faturas futuras.
   - Reconhecimento contábil correto: a compra aparece na competência de consumo, e a saída bancária ocorre apenas na quitação da fatura.

3. **Demonstrativo do Resultado do Exercício (DRE Gerencial):**
   - Visão estruturada de Receita Bruta, Deduções, Margem de Contribuição, Despesas Fixas e Variáveis, e Resultado Líquido.
   - Visão por competência mensal e comparativo anual.

4. **Oráculo Financeiro IA 2.0 (Google Gemini):**
   - Diagnóstico financeiro automatizado, detecção de gastos anômalos e gargalos orçamentários.
   - Simulador de cenários hipotéticos e recomendações personalizadas.

5. **Bot do Telegram com IA e Transcrição de Áudio:**
   - Registre receitas e despesas por mensagem de texto ou por mensagens de voz gravadas em português.
   - Prévia com validação criptográfica (`preview_hash`) antes de qualquer lançamento no banco de dados.

6. **Integridade Contábil e Segurança em Centavos:**
   - Todos os cálculos em centavos inteiros (sem imprecisão de ponto flutuante).
   - Senhas criptografadas com PBKDF2 (30.000 iterações), proteção contra força bruta e auditoria completa em `LOGS_AUDITORIA`.

---

## Como Executar os Testes Automatizados Localmente

O repositório possui uma suíte completa de testes com mock harness do Google Apps Script:

```bash
node tests/run-all.js
```
*Total de 9 suítes e 69 cenários de validação (100% aprovados).*

---

## Documentação Técnica Detalhada

- [📖 Guia Completo de Instalação, Clasp e Quotas](docs/DEPLOYMENT.md)
- [🏗️ Arquitetura em 6 Camadas e Decisões Técnicas](docs/ARCHITECTURE.md)
- [📊 Modelo de Dados — 28 Abas do Google Sheets](docs/DATA_MODEL.md)
- [🔒 Segurança, Autenticação, PBKDF2 e Isolamento Multigrupo](docs/SECURITY.md)
- [🤖 Configuração do Bot do Telegram e Webhook em 1 Clique](docs/TELEGRAM_SETUP.md)
- [🧠 Configuração do Oráculo IA e Transcrição de Áudio](docs/AI_SETUP.md)
- [💾 Guia de Backup, Restauração e Exportação](docs/BACKUP_RESTORE.md)
- [🧪 Relatório de Testes Automatizados](docs/TEST_REPORT.md)
