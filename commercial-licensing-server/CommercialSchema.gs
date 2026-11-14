/**
 * @file CommercialSchema.gs
 * @description Definição do esquema de dados do Banco Comercial Privado do Vendedor (Google Sheets).
 * 
 * Regra Arquitetural Absoluta (LGPD e Privacidade):
 * - É terminantemente proibido armazenar dados financeiros dos compradores neste banco.
 * - Armazena exclusivamente metadados comerciais, de pagamento e chaves de licença.
 */

var CommercialSchema = (function () {
  var COMMERCIAL_SHEETS_SCHEMA = {
    PRODUTOS: [
      'id', 'codigo', 'nome', 'descricao', 'versao_atual', 'situacao', 'criado_em'
    ],
    PLANOS: [
      'id', 'produto_id', 'codigo', 'nome', 'tipo_cobranca', 'preco_centavos',
      'duracao_dias', 'limite_usuarios', 'recursos_permitidos_json', 'situacao', 'criado_em'
    ],
    PEDIDOS: [
      'id', 'gateway_pagamento', 'gateway_transacao_id', 'comprador_email',
      'plano_codigo', 'valor_centavos', 'status_pagamento', 'webhook_payload_json',
      'serial_gerado', 'pago_em', 'criado_em'
    ],
    COMPRADORES: [
      'id', 'email', 'nome', 'telefone', 'cpf_hash', 'total_compras',
      'status', 'criado_em', 'atualizado_em'
    ],
    LICENCAS: [
      'id', 'serial', 'plano_codigo', 'comprador_email', 'status',
      'tipo_validade', 'valido_ate', 'max_instalacoes', 'instalacoes_ativas',
      'criado_em', 'primeira_ativacao_em', 'atualizado_em'
    ],
    INSTALACOES: [
      'id', 'licenca_id', 'serial', 'installation_id', 'spreadsheet_id',
      'comprador_email', 'status', 'ip_origem', 'versao_app', 'versao_schema',
      'primeiro_acesso_em', 'ultimo_heartbeat_em', 'atualizado_em'
    ],
    TRANSFERENCIAS: [
      'id', 'licenca_id', 'serial', 'comprador_email', 'spreadsheet_id_origem',
      'spreadsheet_id_destino', 'motivo', 'autorizado_por', 'solicitado_em', 'executado_em'
    ],
    EVENTOS_SEGURANCA: [
      'id', 'tipo_evento', 'severidade', 'serial', 'installation_id',
      'spreadsheet_id', 'ip_origem', 'detalhes_json', 'registrado_em'
    ]
  };

  return {
    COMMERCIAL_SHEETS_SCHEMA: COMMERCIAL_SHEETS_SCHEMA
  };
})();
