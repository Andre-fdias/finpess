# Configuração de Inteligência Artificial (Oráculo IA e Transcrição de Áudio)

Este guia documenta a arquitetura modular de IA (`GeminiService.gs` e `TelegramAudioService.gs`), os dados trafegados, os limites gratuitos e pagos e o funcionamento em modo de contingência determinística.

---

## 1. Arquitetura Desacoplada e Regras de Segurança

O módulo `GeminiService.gs` foi projetado com separação estrita entre **cálculo contábil** e **interpretação/recomendação**:

1. **Cálculos sempre no Backend:**
   - A função `GeminiService.computeOracleDeterministicFacts(user, mesReferencia)` calcula em centavos inteiros todos os saldos, variações mensais, gastos por categoria, estouros de orçamento e contas que comprometem o saldo disponível.
   - O modelo de IA **nunca** calcula saldos livremente: ele recebe apenas os agregados já apurados pelo backend para redigir explicações e recomendações de organização financeira.
2. **Isolamento de Contexto:**
   - Somente dados pertencentes ao `grupo_id` do usuário autenticado são considerados na consulta.
3. **Contingência Determinística (`DETERMINISTIC_ENGINE_FALLBACK`):**
   - Caso a chave `GEMINI_API_KEY` não esteja configurada, a quota gratuita seja atingida ou o serviço externo apresente falha, o Oráculo IA continua funcionando normalmente por meio de `buildDeterministicInsight()`, exibindo os fatos calculados e um resumo analítico determinístico sem interromper o sistema.

---

## 2. Como Configurar a Chave da Gemini API

1. Acesse o **Google AI Studio** (`https://aistudio.google.com/`) com sua conta Google.
2. Crie uma chave de API (*Create API key*).
3. No projeto do Google Apps Script, acesse **Configurações do Projeto** -> **Propriedades do Script**.
4. Adicione a propriedade:
   - `GEMINI_API_KEY`: `<sua_chave_aqui>`

---

## 3. Transcrição de Áudio no Telegram (`TelegramAudioService.gs`)

### 3.1. Fluxo e Formatos Suportados
- **Formatos aceitos:** Mensagens de voz nativas do Telegram (`audio/ogg` com codec Opus) e arquivos de áudio (`audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`).
- **Limites aplicados pelo backend:**
  - Duração máxima por áudio: **180 segundos** (`MAX_DURATION_SECONDS`).
  - Tamanho máximo por arquivo: **10 MB** (`MAX_FILE_SIZE_BYTES`).
- **Política de Retenção Zero de Áudio:**
  - O arquivo de áudio é baixado em memória (`UrlFetchApp.fetch`), convertido em base64 para a chamada multimodal de transcrição e descartado imediatamente (`audioData = null`).
  - Nenhum arquivo de áudio é salvo no Google Drive ou nas planilhas.
- **Validação Determinística Pós-Transcrição:**
  - O texto transcrito passa por `TelegramParserService.parseNaturalLanguageLaunch()`, que trata separadamente milhares, centenas, dezenas e centavos em português brasileiro (impedindo confusões como *"quatrocentos e cinquenta"* vs *"quarenta e cinco"*) e exige confirmação obrigatória do usuário na prévia em reais (`R$`).

---

## 4. Quotas, Limites Gratuitos e Custos Potenciais

| Serviço / Recurso | Camada Gratuita (Free Tier) | Limites e Condições | Alternativa Sem Custo no Sistema |
| :--- | :--- | :--- | :--- |
| **Gemini API (`gemini-3.8-flash`)** | Disponível no Google AI Studio Free Tier (sujeito às políticas regionais do Google) | Limite de requisições por minuto (RPM) e por dia (RPD) conforme tabela vigente do Google AI Studio. Em planos pagos (Pay-as-you-go), há cobrança por milhão de tokens de texto/áudio. | O parser de texto em português (`TelegramParserService.gs`) e o motor de fatos do Oráculo (`computeOracleDeterministicFacts`) funcionam **100% localmente no Apps Script sem custo e sem depender de IA externa**. |
| **Transcrição de Áudio (Multimodal)** | Inclusa na quota da Gemini API quando utiliza `gemini-3.8-flash` | Áudios consomem tokens proporcionais aos segundos de duração e estão sujeitos ao limite de tempo de execução de 6 minutos do GAS e 20-50 MB de payload do `UrlFetchApp`. | Caso o usuário não configure uma chave de IA ou atinja a quota, o bot informa claramente e permite o envio imediato do lançamento por **mensagem de texto** em linguagem natural sem custo. |

---

## 5. Privacidade e Dados Enviados ao Provedor de IA

- **No Oráculo IA:** São enviados apenas a pergunta do usuário e o resumo numérico agregado do mês (`resumo_mensal` em centavos), sem enviar e-mails, IDs de contas bancárias, tokens ou dados de outros grupos.
- **Na Transcrição de Áudio:** É enviado exclusivamente o buffer de áudio da mensagem enviada voluntariamente pelo usuário ao bot para fins de conversão em texto.


