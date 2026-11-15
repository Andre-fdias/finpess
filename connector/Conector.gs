/**
 * ============================================================================
 * FINPESS — CONECTOR LEVE PARA PLANILHA CLIENTE
 * Biblioteca Central: FinpessLib (v70)
 * ============================================================================
 * Este conector permite que a planilha acesse todas as funcionalidades do Finpess
 * sem expor nenhuma linha do código-fonte proprietário aos compradores.
 */

var SPREADSHEET_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyo7GdmqSRMZ9ZrzEEoEU8ufjbohY5X9lXdxHnGMo2A7EIE0I2A3ixDNtP67GvcWzbj/exec';

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

function resolveWebAppUrl() {
  var url = '';
  try {
    if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
      url = ScriptApp.getService().getUrl() || '';
    }
  } catch (e) {}
  if (!url) {
    try {
      url = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '';
    } catch (eProps) {}
  }
  return url || SPREADSHEET_WEBAPP_URL;
}

function abrirPainelNaPlanilha() {
  var url = resolveWebAppUrl();
  var html = HtmlService.createHtmlOutput(
    '<iframe src="' + url + '" style="width:100%; height:100vh; border:none; position:fixed; top:0; left:0; right:0; bottom:0;"></iframe>'
  )
    .setWidth(1280)
    .setHeight(820)
    .setTitle('💰 Finanças Inteligentes');
  SpreadsheetApp.getUi().showModalDialog(html, '💰 Finanças Inteligentes — Painel Completo');
}

function abrirEmTelaCheia() {
  var url = resolveWebAppUrl();
  var html = HtmlService.createHtmlOutput(
    '<script>' +
    'window.open("' + url + '", "_blank");' +
    'google.script.host.close();' +
    '</script>'
  ).setWidth(50).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abrindo Finpess em Tela Cheia...');
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
