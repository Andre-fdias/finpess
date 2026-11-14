# POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)
## Sistema Finpess — Finanças Pessoais e Familiares

> **Última Atualização:** 14 de Novembro de 2026  
> **Conformidade Legal:** Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD)

A privacidade e a segurança das suas informações financeiras são os pilares fundamentais do **Finpess**. Esta Política de Privacidade explica de forma transparente como seus dados são tratados dentro da nossa arquitetura descentralizada.

---

## 1. O PRINCÍPIO FUNDAMENTAL DA ARQUITETURA FINPESS

Diferente dos aplicativos financeiros tradicionais que armazenam os extratos, saldos e senhas bancárias dos usuários em servidores corporativos centralizados, **o Finpess opera em arquitetura descentralizada (Client-Side Storage)**:

1. **Seus Dados Financeiros pertencem a você e residem exclusivamente no seu próprio Google Drive**: Todos os seus lançamentos, saldos, contas bancárias, faturas de cartão, dívidas e investimentos ficam armazenados na sua planilha pessoal Google Sheets.
2. **O Desenvolvedor NÃO possui acesso aos seus dados financeiros**: A aplicação central do Finpess roda no seu navegador e executa operações diretamente na sua planilha através da sua própria autorização Google. Não temos canal de leitura nem visibilidade sobre o seu patrimônio.

---

## 2. QUAIS DADOS SÃO TRATADOS PELO SERVIDOR COMERCIAL

O Servidor de Licenciamento do Finpess coleta e trata **exclusivamente os metadados técnicos e comerciais estritamente necessários** para emissão da licença e prevenção de pirataria:

- **Dados de Identificação Comercial**: Nome e e-mail informados no momento da compra na plataforma de pagamento (Hotmart / Kiwify / Mercado Pago);
- **Dados Técnicos da Instalação**: Código de identificação exclusivo da instalação (`installation_id`), identificador alfanumérico da planilha Google (`spreadsheet_id`) e data da primeira ativação;
- **Status da Licença**: Situação da assinatura (`TRIAL`, `ACTIVE`, `EXPIRED`, `REVOKED`) e data de expiração;
- **Tentativas de Clonagem**: Registro técnico caso um mesmo serial tente ser ativado em planilhas diferentes.

> ⚠️ **GARANTIA EXPLÍCITA:** O Servidor Comercial do Finpess **JAMAIS** recebe, processa ou armazena valores monetários, descrições de despesas, saldos bancários, nomes de bancos ou qualquer dado de natureza financeira do usuário.

---

## 3. INTEGRAÇÕES EXTERNAS E PROCESSAMENTO DE DADOS

O Finpess oferece integrações opcionais para aprimorar a experiência do usuário:

- **Google Gemini (Inteligência Artificial)**: Utilizado exclusivamente para interpretação de texto e leitura óptica de cupons fiscais (OCR) quando acionado pelo usuário. Os dados trafegam por canal criptografado HTTPS diretamente via API oficial da Google.
- **Bot do Telegram**: Utilizado para captura ágil de despesas e notificações matinais. Os comandos trafegam exclusivamente entre o bot e a sua planilha. A vinculação pode ser revogada com 1 clique a qualquer momento.
- **AwesomeAPI e BCB (Cotações de Mercado)**: Consultas públicas de cotações em tempo real (Dólar, Euro, Bitcoin, Selic), sem envio de nenhuma informação pessoal.

---

## 4. DIREITOS DO TITULAR DOS DADOS (ARTIGO 18 DA LGPD)

Como titular dos seus dados pessoais, você pode a qualquer momento:
1. **Acessar e Exportar seus dados**: Você pode exportar todos os seus dados em formato `.csv` ou copiar a planilha completa para o seu computador a qualquer momento, sem depender de autorização nossa.
2. **Eliminar seus dados**: A exclusão dos dados financeiros depende exclusivamente de você excluir a sua própria planilha do seu Google Drive. Para exclusão dos dados de faturamento/e-mail no banco comercial, basta solicitar via suporte oficial.

---

## 5. CONTATO DO ENCARREGADO DE PROTEÇÃO DE DADOS (DPO)

Para qualquer dúvida sobre a privacidade dos seus dados ou solicitação relativa à LGPD, entre em contato diretamente com o nosso Encarregado de Proteção de Dados:
- **E-mail de Contato:** `privacidade@finpess.com.br`
- **Tempo de Resposta:** Até 48 horas úteis.
