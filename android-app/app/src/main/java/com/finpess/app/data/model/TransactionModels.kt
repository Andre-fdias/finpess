package com.finpess.app.data.model

import com.google.gson.annotations.SerializedName

// Modelos para Lançamentos (Transações)
data class LaunchItemDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("data_lancamento")
    val dataLancamento: String,
    @SerializedName("tipo")
    val tipo: String, // ENTRADA ou SAIDA
    @SerializedName("descricao")
    val descricao: String,
    @SerializedName("categoria_id")
    val categoriaId: String? = null,
    @SerializedName("categoria_nome")
    val categoriaNome: String? = null,
    @SerializedName("subcategoria_id")
    val subcategoriaId: String? = null,
    @SerializedName("subcategoria_nome")
    val subcategoriaNome: String? = null,
    @SerializedName("valor_centavos")
    val valorCentavos: Long,
    @SerializedName("situacao")
    val situacao: String, // CONFIRMADO ou PREVISTO
    @SerializedName("conta_bancaria_id")
    val contaBancariaId: String? = null,
    @SerializedName("conta_bancaria_nome")
    val contaBancariaNome: String? = null,
    @SerializedName("forma_pagamento")
    val formaPagamento: String? = null,
    @SerializedName("observacao")
    val observacao: String? = null,
    @SerializedName("id_origem_externa")
    val idOrigemExterna: String? = null
)

data class CreateLaunchPayload(
    @SerializedName("tipo")
    val tipo: String, // ENTRADA ou SAIDA
    @SerializedName("descricao")
    val descricao: String,
    @SerializedName("valor_centavos")
    val valorCentavos: Long,
    @SerializedName("data_lancamento")
    val dataLancamento: String,
    @SerializedName("situacao")
    val situacao: String = "CONFIRMADO", // CONFIRMADO ou PREVISTO
    @SerializedName("conta_bancaria_id")
    val contaBancariaId: String,
    @SerializedName("categoria_id")
    val categoriaId: String,
    @SerializedName("subcategoria_id")
    val subcategoriaId: String? = null,
    @SerializedName("forma_pagamento")
    val formaPagamento: String = "PIX",
    @SerializedName("observacao")
    val observacao: String? = null,
    @SerializedName("id_origem_externa")
    val idOrigemExterna: String? = null
)

data class CreatePurchasePayload(
    @SerializedName("cartao_id")
    val cartaoId: String,
    @SerializedName("descricao")
    val descricao: String,
    @SerializedName("valor_centavos")
    val valorCentavos: Long,
    @SerializedName("data_compra")
    val dataCompra: String,
    @SerializedName("categoria_id")
    val categoriaId: String,
    @SerializedName("parcelas")
    val parcelas: Int = 1,
    @SerializedName("observacao")
    val observacao: String? = null
)

// Modelos para Contas Bancárias
data class BankAccountDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("nome")
    val nome: String,
    @SerializedName("instituicao")
    val instituicao: String,
    @SerializedName("tipo_conta")
    val tipoConta: String,
    @SerializedName("saldo_atual_centavos")
    val saldoAtualCentavos: Long,
    @SerializedName("cor_hex")
    val corHex: String? = null,
    @SerializedName("ativo")
    val ativo: Boolean = true
)

// Modelos para Cartões de Crédito
data class CreditCardDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("nome")
    val nome: String,
    @SerializedName("bandeira")
    val bandeira: String,
    @SerializedName("ultimos_quatro_digitos")
    val ultimosQuatroDigitos: String? = null,
    @SerializedName("dia_fechamento")
    val diaFechamento: Int,
    @SerializedName("dia_vencimento")
    val diaVencimento: Int,
    @SerializedName("limite_total_centavos")
    val limiteTotalCentavos: Long,
    @SerializedName("limite_disponivel_centavos")
    val limiteDisponivelCentavos: Long,
    @SerializedName("fatura_atual_centavos")
    val faturaAtualCentavos: Long,
    @SerializedName("melhor_dia_compra")
    val melhorDiaCompra: Int? = null,
    @SerializedName("cor_hex")
    val corHex: String? = null
)

// Modelos para Categorias
data class CategoryDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("nome")
    val nome: String,
    @SerializedName("tipo")
    val tipo: String, // RECEITA ou DESPESA
    @SerializedName("icone")
    val icone: String? = null,
    @SerializedName("cor_hex")
    val corHex: String? = null,
    @SerializedName("subcategorias")
    val subcategorias: List<SubcategoryDto> = emptyList()
)

data class SubcategoryDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("nome")
    val nome: String
)

// Requisições encapsuladas RPC
data class LaunchesListRequest(
    @SerializedName("action")
    val action: String = "launches.list",
    @SerializedName("payload")
    val payload: LaunchesListFilterPayload = LaunchesListFilterPayload(),
    @SerializedName("authContext")
    val authContext: AuthContextDto
)

data class LaunchesListFilterPayload(
    @SerializedName("mesReferencia")
    val mesReferencia: String? = null, // YYYY-MM
    @SerializedName("tipo")
    val tipo: String? = null,
    @SerializedName("situacao")
    val situacao: String? = null
)

data class CreateLaunchRequest(
    @SerializedName("action")
    val action: String = "launches.create",
    @SerializedName("payload")
    val payload: CreateLaunchPayload,
    @SerializedName("authContext")
    val authContext: AuthContextDto
)

data class CreatePurchaseRequest(
    @SerializedName("action")
    val action: String = "creditCards.purchases.create",
    @SerializedName("payload")
    val payload: CreatePurchasePayload,
    @SerializedName("authContext")
    val authContext: AuthContextDto
)

data class BankAccountsListRequest(
    @SerializedName("action")
    val action: String = "bankAccounts.list",
    @SerializedName("payload")
    val payload: Map<String, Any> = emptyMap(),
    @SerializedName("authContext")
    val authContext: AuthContextDto
)

data class CreditCardsListRequest(
    @SerializedName("action")
    val action: String = "creditCards.list",
    @SerializedName("payload")
    val payload: Map<String, Any> = emptyMap(),
    @SerializedName("authContext")
    val authContext: AuthContextDto
)
