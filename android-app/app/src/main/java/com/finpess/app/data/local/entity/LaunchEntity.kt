package com.finpess.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

enum class SyncStatus {
    SYNCED,
    PENDING_CREATE,
    PENDING_UPDATE,
    PENDING_DELETE
}

@Entity(tableName = "launches")
data class LaunchEntity(
    @PrimaryKey
    val id: String,
    val data: String,
    val tipo: String, // RECEITA, DESPESA, TRANSFERENCIA
    val descricao: String,
    val categoria: String,
    val subcategoria: String? = null,
    val valorCentavos: Long,
    val status: String, // CONFIRMADO, PREVISTO
    val contaId: String? = null,
    val contaNome: String? = null,
    val cartaoId: String? = null,
    val cartaoNome: String? = null,
    val formaPagamento: String? = null,
    val observacao: String? = null,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
    val updatedAt: Long = System.currentTimeMillis()
)
