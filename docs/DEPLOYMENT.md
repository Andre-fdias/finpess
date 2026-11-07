# Guia Completo de Instalação, Implantação e Operação

Este documento reúne todas as instruções passo a passo para instalar, configurar, implantar e operar o **Finanças Inteligentes**, seja de forma automática (via terminal/PowerShell e Clasp) ou manual (direto pelo navegador no Google Drive e Google Apps Script), além de orientações para instalar no celular (Android e iOS) e configurar integrações.

---

## Sumário
1. [Visão Geral e Pré-requisitos](#1-visão-geral-e-pré-requisitos)
2. [Método 1: Instalação Automática (Recomendado via Clasp / PowerShell)](#2-método-1-instalação-automática-recomendado-via-clasp--powershell)
3. [Método 2: Instalação Manual Direta pelo Navegador (Sem Terminal)](#3-método-2-instalação-manual-direta-pelo-navegador-sem-terminal)
4. [Configuração das Propriedades do Script (`Script Properties`)](#4-configuração-das-propriedades-do-script-script-properties)
5. [Primeiro Acesso, Inicialização das 28 Abas e Gestão de Usuários](#5-primeiro-acesso-inicialização-das-28-abas-e-gestão-de-usuários)
6. [Como Instalar no Celular como Web App (Android e iOS / PWA)](#6-como-instalar-no-celular-como-web-app-android-e-ios--pwa)
7. [Configuração de Gatilhos Automáticos (Triggers de E-mail Matinal)](#7-configuração-de-gatilhos-automáticos-triggers-de-e-mail-matinal)
8. [Configuração de Integrações Opcionais (Telegram e Oráculo IA)](#8-configuração-de-integrações-opcionais-telegram-e-oráculo-ia)
9. [Quotas, Limitações do Google Apps Script e Custos](#9-quotas-limitações-do-google-apps-script-e-custos)
10. [Resolução de Problemas Frequentes (Troubleshooting)](#10-resolução-de-problemas-frequentes-troubleshooting)

---

## 1. Visão Geral e Pré-requisitos

O Finanças Inteligentes é um sistema completo de gestão financeira pessoal e familiar construído em arquitetura serverless utilizando exclusivamente o ecossistema Google (Google Apps Script V8 + Google Sheets) com frontend moderno responsivo.

### O que você precisa:
- **Conta Google:** Uma conta gratuita (`@gmail.com`) ou conta corporativa/institucional (Google Workspace).
- **Navegador Web:** Google Chrome, Microsoft Edge, Firefox, Brave ou Safari.
- **Node.js (Opcional, apenas para o Método 1):** Versão 18 ou superior instalada se optar por deploy via linha de comando (`clasp`).

---

## 2. Método 1: Instalação Automática (Recomendado via Clasp / PowerShell)

Se você tem familiaridade com terminal ou deseja agilidade e controle de versões:

### Passo 1: Habilitar a API do Google Apps Script
1. Acesse suas configurações de usuário do Google Apps Script:  
   👉 [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings)
2. Localize a opção **Google Apps Script API** e mude para **Ativado (On)**.

### Passo 2: Clonar o Repositório e Instalar Dependências
Abra o terminal (PowerShell no Windows ou Terminal no Linux/macOS) na pasta desejada:
```bash
git clone https://github.com/seu-usuario/finpess.git
cd finpess
```

### Passo 3: Fazer Login na Conta Google via Clasp
Execute o comando de autenticação:
```bash
npx @google/clasp login
```
Uma janela do seu navegador será aberta solicitando permissão para o Google Apps Script CLI acessar sua conta. Autorize o acesso. As credenciais seguras serão armazenadas localmente no seu perfil (`~/.clasprc.json`).

### Passo 4: Criar uma Nova Planilha no Google Drive ou Vincular uma Existente
- **Opção A (Criar nova planilha automaticamente):**
  Crie uma nova planilha pelo Google Drive ([sheets.new](https://sheets.new)) e copie o **ID da Planilha** da URL.  
  *(Exemplo de URL: `https://docs.google.com/spreadsheets/d/1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c/edit` -> o ID é `1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c`).*

- **Opção B (Usar o Script PowerShell Automatizado):**
  No Windows PowerShell, você pode executar o script fornecido na raiz:
  ```powershell
  .\deploy-automatico.ps1
  ```
  O script verifica as credenciais do Clasp, cria o vínculo no `.clasp.json`, envia todos os arquivos do backend e frontend (`src/`) e realiza o deploy da Web App.

- **Opção C (Comandos Manuais Clasp):**
  1. No arquivo `.clasp.json`, certifique-se de apontar para seu script:
     ```json
     {
       "scriptId": "SEU_SCRIPT_ID_DO_APPS_SCRIPT",
       "rootDir": "src"
     }
     ```
  2. Envie os arquivos para o Google Apps Script:
     ```bash
     npx @google/clasp push -f
     ```
  3. Publique uma versão do Web App:
     ```bash
     npx @google/clasp deploy --description "Finanças Inteligentes Produção"
     ```
  O terminal exibirá a URL de execução (`https://script.google.com/macros/s/.../exec`).

---

## 3. Método 2: Instalação Manual Direta pelo Navegador (Sem Terminal)

Se você não possui Node.js instalado e deseja criar tudo diretamente no seu navegador:

### Passo 1: Criar a Planilha Google
1. Acesse o Google Drive e crie uma nova planilha em branco ([sheets.new](https://sheets.new)).
2. Dê o nome de **"Finanças Inteligentes — Banco de Dados"**.
3. Copie o ID da planilha da barra de endereços (o código alfanumérico entre `/d/` e `/edit`).

### Passo 2: Abrir o Editor do Google Apps Script
1. Na planilha, clique no menu superior: **Extensões** > **Apps Script**.
2. O editor de código do Apps Script será aberto em uma nova aba.
3. Dê o nome do projeto como **"Finanças Inteligentes"** no canto superior esquerdo.

### Passo 3: Copiar os Arquivos do Projeto
Na barra lateral esquerda do Apps Script, você pode criar arquivos de **Script** (`.gs`) e arquivos de **HTML** (`.html`):

1. **Arquivos `.gs` (Scripts Backend):**
   Para cada arquivo `.gs` da pasta `src/` do projeto (ex.: `Code.gs`, `SpreadsheetRepository.gs`, `FinanceService.gs`, etc.):
   - Clique em **+** > **Script**.
   - Digite o nome do arquivo (ex.: `SpreadsheetRepository`).
   - Copie o conteúdo correspondente de `src/` e cole no editor.

2. **Arquivos `.html` (Frontend e Templates):**
   Para cada arquivo `.html` da pasta `src/` (ex.: `Index.html`, `App.html`, `Styles.html`, `Components.html`, `Dashboard.html`, `Launches.html`, `BankAccounts.html`, etc.):
   - Clique em **+** > **HTML**.
   - Digite o nome exato (sem a extensão `.html`, pois o Google adiciona automaticamente).
   - Cole o conteúdo do respectivo arquivo.

3. **Manifesto `appsscript.json`:**
   - No editor do Apps Script, clique no ícone de engrenagem ⚙️ (**Configurações do Projeto**).
   - Marque a caixa de seleção: **"Mostrar arquivo de manifesto 'appsscript.json' no editor"**.
   - Volte ao editor de arquivos, selecione `appsscript.json` e substitua pelo conteúdo de `src/appsscript.json`:
     ```json
     {
       "timeZone": "America/Sao_Paulo",
       "dependencies": {},
       "exceptionLogging": "STACKDRIVER",
       "runtimeVersion": "V8",
       "webapp": {
         "executeAs": "USER_DEPLOYING",
         "access": "ANYONE"
       },
       "oauthScopes": [
         "https://www.googleapis.com/auth/spreadsheets",
         "https://www.googleapis.com/auth/calendar",
         "https://www.googleapis.com/auth/script.send_mail",
         "https://www.googleapis.com/auth/script.external_request",
         "https://www.googleapis.com/auth/userinfo.email"
       ]
     }
     ```

### Passo 4: Publicar como Web App
1. No canto superior direito do editor Apps Script, clique no botão azul **Implantar** > **Nova implantação**.
2. No menu de engrenagem ⚙️ (Selecionar tipo), selecione **App da Web**.
3. Preencha as opções:
   - **Descrição:** `Versão Inicial Finanças Inteligentes`
   - **Executar como:** `Eu (seu_email@gmail.com)`
   - **Quem pode acessar:** `Qualquer pessoa` *(recomendado para permitir funcionamento do Webhook do Telegram e acesso por link)* ou `Qualquer pessoa com uma conta do Google`.
4. Clique em **Implantar**.
5. Se for a primeira vez, o Google solicitará **"Autorizar o acesso"**.
   - Clique em *Autorizar acesso*.
   - Escolha sua conta Google.
   - Na tela *"O Google não verificou este app"*, clique em **Avançado** (canto inferior esquerdo) e depois em **Acessar Finanças Inteligentes (não seguro)**.
   - Clique em **Permitir**.
6. Copie a **URL do App da Web** (ex: `https://script.google.com/macros/s/.../exec`). Esta é a URL que você usará no computador e no celular!

---

## 4. Configuração das Propriedades do Script (`Script Properties`)

Para que o sistema opere com máxima segurança e vincule todas as integrações, configure as propriedades do script:

1. No editor do Apps Script, clique em ⚙️ **Configurações do Projeto**.
2. Role até a seção **Propriedades do Script** e clique em **Editar propriedades do script** > **Adicionar propriedade do script**:

| Propriedade | Obrigatória? | Valor Recomendado / Exemplo | Descrição |
| :--- | :---: | :--- | :--- |
| `SPREADSHEET_ID` | **Sim** | `1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c` | ID da sua planilha Google. Se o script estiver vinculado (*container-bound*), é opcional, mas recomendável manter explícito. |
| `OWNER_EMAIL` | **Sim** | `seu_email@gmail.com` | E-mail da sua conta Google principal. Este usuário receberá automaticamente privilégios de Administrador Geral (`OWNER`). |
| `TELEGRAM_BOT_TOKEN` | Opcional | `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` | Token do Bot emitido pelo `@BotFather` no Telegram. |
| `TELEGRAM_WEBHOOK_SECRET` | Opcional | Ex: `FinPess_Secret_2026_xyz` | Chave de segurança para validar que as mensagens recebidas vêm exclusivamente do Telegram. |
| `GEMINI_API_KEY` | Opcional | Ex: `AIzaSy...` | Chave de API gratuita do Google AI Studio para o Oráculo Financeiro IA e transcrição de áudios do Telegram. |
| `GOOGLE_CALENDAR_ID` | Opcional | `primary` | Agenda do Google onde as contas e vencimentos serão sincronizados (deixe `primary` para a agenda principal). |

Clique em **Salvar propriedades do script**.

---

## 5. Primeiro Acesso, Inicialização das 28 Abas e Gestão de Usuários

1. **Inicialização Automática do Banco de Dados:**
   - Ao abrir a URL da Web App pela primeira vez no navegador, o sistema detecta que o esquema precisa ser preparado e cria automaticamente todas as **28 abas obrigatórias** do Google Sheets com formatação, cabeçalhos estáveis e fórmulas protegidas:
     `CONFIGURACOES`, `USUARIOS`, `GRUPOS_FINANCEIROS`, `CONTAS_BANCARIAS`, `CARTAO_CREDITO`, `FATURAS_CARTAO`, `CATEGORIAS`, `SUBCATEGORIAS`, `LANCAMENTOS`, `COMPRAS_CARTAO`, `PARCELAS_CARTAO`, `CONTAS_RECORRENTES`, `DIVIDAS`, `EMPRESTIMOS`, `INVESTIMENTOS`, `COTAS_ATIVOS`, `METAS`, `PLANEJAMENTO_MENSAL`, `ORCAMENTO_CATEGORIAS`, `ASSINATURAS`, `NOTIFICACOES_FILA`, `TELEGRAM_VINCULOS`, `TELEGRAM_PROPOSTAS`, `AGENDA_SYNC`, `LOGS_AUDITORIA`, `SECURITY_LOGS`, `INCIDENTES_SEGURANCA`, `CACHE_REGISTRY`.
   - Você também pode forçar a verificação manual a qualquer momento abrindo a planilha Google e clicando no menu superior:  
     `💰 Finanças Inteligentes` > `🚀 1. Instalar / Verificar 28 Abas`.

2. **Login e Acesso do Administrador (`OWNER`):**
   - O e-mail definido na propriedade `OWNER_EMAIL` tem status de superusuário e pode acessar imediatamente o sistema.
   - Caso crie um usuário através da tela de cadastro de e-mail/senha, o primeiro usuário pode ser aprovado pelo painel em **Configurações & Telegram** > **Gestão de Usuários**.

3. **Adicionando Membros da Família ou Equipe:**
   - Novos usuários acessam a URL da Web App e criam sua conta.
   - Eles entram em status `PENDENTE` (bloqueados contra qualquer leitura financeira por segurança).
   - O Administrador acessa a aba **Configurações & Telegram** e aprova o usuário definindo:
     - **Perfil:** `ADMIN`, `MEMBRO` ou `VISUALIZADOR`.
     - **Grupo Financeiro:** Permite que famílias compartilhem as mesmas contas ou que usuários tenham finanças 100% isoladas.
   - Agora, ao cadastrar Contas Bancárias, você poderá selecionar exatamente quem é o **Proprietário / Titular da Conta** dentre os usuários cadastrados!

---

## 6. Como Instalar no Celular como Web App (Android e iOS / PWA)

O Finanças Inteligentes foi projetado com uma barra de navegação inferior nativa (*Bottom Navigation*), área de toque ergonômica de 48px e suporte completo a temas Claro e Escuro. Você não precisa baixar nada pela Google Play Store ou App Store.

### No Android (Google Chrome ou Brave):
1. Abra o navegador no celular e acerte a URL da Web App (`https://script.google.com/macros/s/.../exec`).
2. Faça login na sua conta Google autorizada.
3. Toque no ícone de **três pontinhos (⋮)** no canto superior direito do navegador.
4. Selecione a opção **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
5. Confirme o nome como **"Finanças Inteligentes"** e toque em **Adicionar**.
6. Um ícone elegante do aplicativo será fixado na tela inicial do seu celular, abrindo em tela cheia como um app nativo!

### No iPhone / iPad (Safari):
1. Abra o Safari e acesse a URL da Web App.
2. Toque no botão de **Compartilhar** (ícone do quadrado com a seta para cima na barra inferior).
3. Role a lista e toque em **"Adicionar à Tela de Início"**.
4. Defina o nome como **"Finanças"** e toque em **Adicionar**.

---

## 7. Configuração de Gatilhos Automáticos (Triggers de E-mail Matinal)

O sistema possui um motor de notificação inteligente que envia um **resumo matinal unificado por e-mail** todas as manhãs com as contas a vencer em 3 dias, 2 dias, 1 dia, hoje e contas em atraso (evitando dezenas de e-mails fragmentados).

### Para ativar o envio automático matinal:
1. No editor do Apps Script, clique no menu lateral esquerdo no ícone de relógio ⏰ (**Acionadores / Triggers**).
2. Clique no botão azul **+ Adicionar acionador** (canto inferior direito).
3. Configure os campos:
   - **Escolha a função a ser executada:** `enviarResumoMatinalContas` (ou `executarRotinaDiariaManha`).
   - **Escolha a implantação:** `Head` (ou a versão principal do Web App).
   - **Selecione a fonte do evento:** `Baseado no tempo`.
   - **Selecione o tipo de acionador baseado em tempo:** `Temporizador por dia`.
   - **Hora do dia:** `06:00 às 07:00` (ou o horário matinal de sua preferência).
4. Clique em **Salvar**.

---

## 8. Configuração de Integrações Opcionais (Telegram e Oráculo IA)

### A. Bot do Telegram (Lançamentos por Texto e Áudio)
1. Abra o Telegram e procure por `@BotFather`.
2. Envie o comando `/newbot`, escolha um nome e um username para o seu bot (ex: `MeuFinancasBot`).
3. O BotFather fornecerá o token HTTP da API.
4. No sistema Finanças Inteligentes:
   - Acesse **Configurações & Telegram**.
   - Na seção **Integração Telegram**, informe o token do Bot.
   - Clique em **Salvar Configurações** e em seguida em **Configurar Webhook Automaticamente (1-Clique)**.
   - O sistema registra o webhook diretamente nos servidores do Telegram com segredo criptográfico.
5. Inicie uma conversa com seu novo bot no Telegram clicando no link gerado ou enviando `/start FIN-...` para vincular seu usuário com segurança.

### B. Oráculo IA (Google Gemini 2.0 / 1.5 Flash)
1. Acesse o [Google AI Studio](https://aistudio.google.com/) e faça login com sua conta Google.
2. Clique em **"Get API key"** e crie uma chave gratuita.
3. No sistema Finanças Inteligentes, acesse **Configurações & Telegram** > **Inteligência Artificial (Gemini)**.
4. Cole sua chave de API e clique em **Salvar e Testar Conexão**.
5. O Oráculo IA e a transcrição automática de áudios em português brasileiro estarão imediatamente habilitados!

---

## 9. Quotas, Limitações do Google Apps Script e Custos

| Serviço | Recurso Gratuito | Limites Técnicos Aplicáveis | Custo Operacional |
| :--- | :--- | :--- | :---: |
| **Google Apps Script** | Gratuito na conta Google | Tempo máx. de execução: 6 min/execução; Triggers: 90 min/dia (Gmail) ou 6h/dia (Workspace). | **R$ 0,00** |
| **Google Sheets** | Gratuito no Google Drive | Até 10 milhões de células por planilha (espaço para centenas de milhares de lançamentos). | **R$ 0,00** |
| **Envio de E-mails (`MailApp`)** | Gratuito | 100 e-mails/dia (Gmail) ou 1.500/dia (Workspace). O envio unificado gasta apenas 1 e-mail por dia por usuário. | **R$ 0,00** |
| **Google Calendar** | Gratuito | Criação e sincronização automática de eventos financeiros. | **R$ 0,00** |
| **Telegram Bot API** | Gratuito | Sem limite prático para uso pessoal/familiar. | **R$ 0,00** |
| **Google Gemini API** | Gratuito no AI Studio | Camada gratuita com cotas diárias generosas (RPM/RPD); se a chave não for configurada, o sistema usa motor determinístico local de contingência. | **R$ 0,00** |

---

## 10. Resolução de Problemas Frequentes (Troubleshooting)

- **A tela de autorização do Google diz "O Google não verificou este app":**
  - Isso é perfeitamente normal para qualquer script pessoal criado no seu próprio Google Drive. Clique em **Avançado** no canto inferior esquerdo e depois em **Acessar Finanças Inteligentes (não seguro)** para conceder permissão à sua própria planilha.
- **Os botões parecem não responder ou a tela fica carregando:**
  - Pressione `Ctrl + F5` (no Windows) ou `Cmd + Shift + R` (no Mac) para limpar o cache do navegador e carregar a versão mais recente dos scripts.
- **Como atualizar o sistema quando houver novidades no código:**
  - Se você instalou via Clasp, basta rodar `npx @google/clasp push -f` e em seguida atualizar o deploy com `npx @google/clasp deploy -i SEU_DEPLOYMENT_ID -d "Atualizacao"`. O banco de dados do Google Sheets mantém todos os seus dados preservados intactos.
- **Perdi o link de acesso ao sistema:**
  - Abra a sua planilha no Google Sheets, clique em **Extensões** > **Apps Script**, clique em **Implantar** > **Gerenciar implantações** e copie a URL do Web App ativo.
