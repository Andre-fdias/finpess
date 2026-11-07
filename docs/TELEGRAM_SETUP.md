# Guia de Criação, Configuração e Segurança do Bot do Telegram

Este documento descreve o procedimento completo para criar, configurar, vincular, testar e revogar o Bot do Telegram do **Finanças Inteligentes**.

---

## 1. Escopo Estrito do Bot

O bot do Telegram funciona exclusivamente como **interface de captura assistida** para propostas de:
- `ENTRADA` (Receitas)
- `SAIDA` (Despesas)

**Proibições impostas no código (`TelegramParserService.gs` e `TelegramLaunchService.gs`):**
- Não cria nem altera contas mensais recorrentes.
- Não cria nem altera contas bancárias.
- Não cria ativos, aportes, resgates nem modifica a carteira de investimentos.
- Não cria, edita nem renegocia dívidas ou empréstimos.
- Não executa comandos administrativos nem altera permissões.
- **Nunca grava um lançamento sem confirmação explícita do usuário na prévia.**

---

## 2. Passo a Passo: Criação pelo `@BotFather`

1. No aplicativo do Telegram, abra uma conversa com o perfil oficial verificado **`@BotFather`**.
2. Envie o comando `/newbot`.
3. Informe o nome de exibição do bot (ex.: `Finanças Inteligentes Assistente`).
4. Informe um nome de usuário exclusivo terminado em `bot` (ex.: `financas_inteligentes_seu_nome_bot`).
5. O `@BotFather` fornecerá o **HTTP API Token** (formato `1234567890:AAH...`).
6. Configure a lista de comandos enviando `/setcommands` ao `@BotFather` e colando:
   ```text
   start - Apresentação e instruções iniciais
   ajuda - Exemplos de mensagens e áudios aceitos
   status - Verificar situação do vínculo com o sistema
   vincular - Vincular sua conta usando código de uso único
   desvincular - Revogar o vínculo do Telegram com segurança
   cancelar - Cancelar proposta de lançamento em andamento
   ```
7. Desative a adição do bot a grupos públicos enviando `/setjoingroups` -> `Disable` (o bot deve operar em chat privado com usuários vinculados).

---

## 3. Armazenamento Seguro do Token e Segredo no Backend

**Nunca** coloque o token em arquivos HTML, JavaScript do navegador, planilhas ou commits Git.

1. Abra o projeto no editor do Google Apps Script (`clasp open` ou via painel do Google Apps Script).
2. Acesse **Configurações do Projeto** (ícone de engrenagem) -> **Propriedades do script** (*Script Properties*).
3. Adicione as propriedades abaixo:
   - `TELEGRAM_BOT_TOKEN`: cole o token obtido no `@BotFather`.
   - `TELEGRAM_WEBHOOK_SECRET`: crie uma string aleatória forte de pelo menos 32 caracteres alfanuméricos (ex.: gerada com `openssl rand -hex 24`).

---

## 4. Configuração do Webhook HTTPS e Validação no Google Apps Script

### 4.1. Como funciona a validação no Google Apps Script
O Google Apps Script não expõe cabeçalhos HTTP de entrada (como `X-Telegram-Bot-Api-Secret-Token`) no objeto `e` da função `doPost(e)`. Para garantir que **nenhuma requisição não autenticada seja aceita**:

1. **Opção A (Direta no GAS — Custo Zero):**
   O `TelegramWebhookService.gs` exige que a URL registrada no Telegram inclua o parâmetro `?secret=<TELEGRAM_WEBHOOK_SECRET>`, validado em tempo constante (`TelegramAuthService.constantTimeEquals`).
   Para registrar o webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?secret=<TELEGRAM_WEBHOOK_SECRET>",
       "allowed_updates": ["message", "callback_query"]
     }'
   ```

2. **Opção B (Validação Nativa de Cabeçalho com Cloudflare Worker Gratuito):**
   Caso deseje validar estritamente o cabeçalho HTTP `X-Telegram-Bot-Api-Secret-Token` na borda antes de acionar o Google Apps Script (também evitando problemas de redirecionamento HTTP 302 do GAS), publique um Cloudflare Worker no plano gratuito (até 100.000 requisições/dia grátis):
   ```javascript
   export default {
     async fetch(request, env) {
       if (request.method !== 'POST') {
         return new Response('Method Not Allowed', { status: 405 });
       }
       const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
       if (!headerSecret || headerSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
         return new Response('Unauthorized', { status: 401 });
       }
       const body = await request.text();
       const gasUrl = `${env.GAS_WEBAPP_URL}?secret=${encodeURIComponent(env.TELEGRAM_WEBHOOK_SECRET)}`;
       const resp = await fetch(gasUrl, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body,
         redirect: 'follow'
       });
       return new Response(await resp.text(), { status: 200 });
     }
   };
   ```

---

## 5. Vinculação Segura entre Usuário e Telegram

1. O usuário acessa o sistema web autenticado com sua conta Google já **APROVADA**.
2. Navega até **Configurações & Telegram** -> clica em **Gerar Código de Uso Único**.
3. O sistema gera um código temporário (ex.: `FIN-8K4P9M2X`), armazena apenas seu hash SHA-256 na aba `TELEGRAM_VINCULOS` e define expiração de 10 minutos.
4. No Telegram, o usuário envia ao bot:
   ```text
   /vincular FIN-8K4P9M2X
   ```
5. O backend valida o hash, o prazo de validade, o uso único e o status `APROVADO` do usuário, vinculando o `telegram_user_id` numérico imutável.

---

## 6. Procedimento para Revogar e Substituir o Token ou Vínculo

- **Revogar o acesso de um usuário ao Telegram:**
  - Pelo sistema web: **Configurações & Telegram** -> **Revogar Vínculo Telegram** (ou bloqueando o usuário na tabela de Controle de Acesso, o que revoga automaticamente qualquer vínculo ativo).
  - Pelo próprio Telegram: enviar `/desvincular`.
- **Revogar e substituir o Token do Bot (em caso de suspeita de comprometimento):**
  1. Abra conversa com `@BotFather` no Telegram e envie `/revoke`.
  2. Selecione o bot para invalidar imediatamente o token antigo.
  3. Copie o novo token gerado pelo `@BotFather`.
  4. Atualize a propriedade `TELEGRAM_BOT_TOKEN` nas **Propriedades do Script** do Google Apps Script.
  5. Gere um novo `TELEGRAM_WEBHOOK_SECRET` e execute novamente o comando `setWebhook`.

