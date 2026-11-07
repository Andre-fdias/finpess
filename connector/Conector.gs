/**
 * FINANÇAS INTELIGENTES — CONECTOR LEVE
 * Conecta a planilha ao servidor central desacoplado.
 */
var CENTRAL_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyzjzX7GYRl-IGmJ0S8kgoCfA9i3G9zC2AuAzUgXFyEYEmrt_ivlaxE2gyul7TCcaAM7g/exec';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 Finanças Inteligentes')
    .addItem('Abrir Painel em Tela Cheia', 'abrirPainelTelaCheia')
    .addItem('Abrir Painel na Barra Lateral', 'abrirBarraLateral')
    .addToUi();
}

function abrirPainelTelaCheia() {
  var html = HtmlService.createHtmlOutput(
    '<script>' +
    '  window.open("' + CENTRAL_WEBAPP_URL + '", "_blank");' +
    '  google.script.host.close();' +
    '</script>'
  ).setWidth(320).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abrindo Finanças Inteligentes...');
}

function abrirBarraLateral() {
  var html = HtmlService.createHtmlOutput(
    '<iframe src="' + CENTRAL_WEBAPP_URL + '" style="width:100%; height:100vh; border:none;"></iframe>'
  ).setTitle('Finanças Inteligentes');
  SpreadsheetApp.getUi().showSidebar(html);
}

