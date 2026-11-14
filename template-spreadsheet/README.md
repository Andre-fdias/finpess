# MANUAL DE PROVISIONAMENTO DA PLANILHA-MODELO OFICIAL (TEMPLATE)

## Como Disponibilizar a Planilha para os Compradores em 1 Clique

Para que o comprador crie sua própria instalação de forma independente e automática:

### 1. Criar a Planilha Matriz no Google Sheets
1. Crie uma nova planilha vazia no Google Sheets da conta oficial do Finpess.
2. Nomeie-a como: `Finpess — Planilha Oficial (Modelo)`.
3. Abra **Extensões > Apps Script** e execute `SetupService.installSpreadsheetAndSeed()`.
   - Isso criará todas as 28 abas oficiais com seus cabeçalhos formatados, cores padronizadas e categorias padrão de receitas e despesas.

### 2. Configurar o Compartilhamento Público para Cópia
1. No canto superior direito da planilha, clique em **Compartilhar**.
2. Em **Acesso geral**, selecione: `"Qualquer pessoa com o link"`.
3. Defina a função como: `"Leitor"`.
4. Copie o link da planilha. O link terá o formato:
   `https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA_MODELO/edit?usp=sharing`

### 3. Gerar o Link de Auto-Cópia (/copy)
Substitua `/edit?usp=sharing` por `/copy`:
```text
https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA_MODELO/copy
```

### 4. Experiência do Comprador
Quando o comprador clica nesse link (fornecido na página de compra ou no e-mail de boas-vindas), o próprio Google Sheets exibe a tela:
> **"Deseja fazer uma cópia de Finpess — Planilha Oficial (Modelo)?"**  
> `[ Fazer uma cópia ]`

Ao clicar, o Google cria automaticamente a planilha pessoal no Google Drive do cliente com um novo `Spreadsheet ID` exclusivo, 100% isolado do desenvolvedor e de outros clientes!
