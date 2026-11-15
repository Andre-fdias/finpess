/**
 * ============================================================================
 * FINPESS — CONECTOR LEVE PARA PLANILHA CLIENTE
 * Biblioteca Central: FinpessLib (v68)
 * ============================================================================
 * Este conector permite que a planilha acesse todas as funcionalidades do Finpess
 * sem expor nenhuma linha do código-fonte proprietário aos compradores.
 */

function onOpen(e) {
  try {
    FinpessLib.onOpen(e);
  } catch (err) {
    SpreadsheetApp.getUi()
      .createMenu('💰 Finanças Inteligentes')
      .addItem('🚀 1. Instalar / Verificar 21 Abas e Dados Iniciais', 'instalarTudoNaPlanilha')
      .addItem('📱 2. Abrir Sistema na Planilha (Modal)', 'abrirPainelNaPlanilha')
      .addItem('🌐 3. Abrir Sistema em Tela Cheia (Navegador)', 'abrirEmTelaCheia')
      .addToUi();
  }
}

function instalarTudoNaPlanilha() {
  return FinpessLib.instalarTudoNaPlanilha();
}

function abrirPainelNaPlanilha() {
  return FinpessLib.abrirPainelNaPlanilha();
}

function abrirEmTelaCheia() {
  return FinpessLib.abrirEmTelaCheia();
}

function apiCall(action, payload, authContext) {
  return FinpessLib.apiCall(action, payload, authContext);
}

function doGet(e) {
  return FinpessLib.doGet(e);
}

function doPost(e) {
  return FinpessLib.doPost(e);
}

function executarEnvioMatinalNotificacoes() {
  return FinpessLib.executarEnvioMatinalNotificacoes();
}

function configurarGatilhoMatinal() {
  return FinpessLib.configurarGatilhoMatinal();
}
