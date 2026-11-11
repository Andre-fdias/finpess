package com.finpess.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "credit_cards")
data class CreditCardEntity(
    @PrimaryKey
    val id: String,
    val nome: String,
    val bandeira: String,
    val finalCartao: String? = null,
    val diaFechamento: Int,
    val diaVencimento: Int,
    val limiteTotalCentavos: Long,
    val limiteDisponivelCentavos: Long,
    val faturaAtualCentavos: Long,
    val corHex: String? = null,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "bank_accounts")
data class BankAccountEntity(
    @PrimaryKey
    val id: String,
    val nome: String,
    val instituicao: String,
    val tipo: String, // CORRENTE, POUPANCA, PAGAMENTO, INVESTIMENTO
    val saldoCentavos: Long,
    val corHex: String? = null,
    val updatedAt: Long = System.currentTimeMillis()
)
