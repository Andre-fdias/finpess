package com.finpess.app.service

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.local.AppDatabase
import com.finpess.app.data.local.entity.BankAccountEntity
import com.finpess.app.data.remote.ApiClient
import com.finpess.app.data.repository.TransactionRepository
import com.finpess.app.data.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class QuickConfirmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CONFIRM_TRANSACTION) return

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val valorCentavos = intent.getLongExtra(EXTRA_VALOR_CENTAVOS, 0L)
        val descricao = intent.getStringExtra(EXTRA_DESCRICAO) ?: "Transação Automática"
        val tipo = intent.getStringExtra(EXTRA_TIPO) ?: "SAIDA"
        val banco = intent.getStringExtra(EXTRA_BANCO) ?: "Banco"
        val formaPagamento = intent.getStringExtra(EXTRA_FORMA_PAGAMENTO) ?: "PIX"

        if (notificationId != -1) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(notificationId)
        }

        if (valorCentavos <= 0L) return

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = AppDatabase.getInstance(context)
                val security = SecurityManager(context)
                val repo = TransactionRepository(ApiClient.apiService, db, security)

                val accounts = repo.getLocalBankAccountsFlow().firstOrNull() ?: emptyList()
                val matchedAccount: BankAccountEntity? = accounts.find {
                    it.instituicao.contains(banco, ignoreCase = true) || it.nome.contains(banco, ignoreCase = true)
                } ?: accounts.firstOrNull()

                val contaId = matchedAccount?.id ?: "CONTA_PADRAO"
                val contaNome = matchedAccount?.nome ?: banco
                val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

                repo.createLaunch(
                    tipo = tipo,
                    descricao = descricao,
                    valorCentavos = valorCentavos,
                    data = today,
                    contaId = contaId,
                    contaNome = contaNome,
                    categoriaId = if (tipo == "ENTRADA") "Salário" else "Outros",
                    categoriaNome = if (tipo == "ENTRADA") "Salário" else "Outros",
                    situacao = "CONFIRMADO",
                    formaPagamento = formaPagamento
                )

                // Dispara sincronização em segundo plano
                SyncWorker.triggerImmediateSync(context)

                CoroutineScope(Dispatchers.Main).launch {
                    Toast.makeText(context, "✓ Finpess: Lançamento registrado com sucesso!", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                // Silencioso ou log
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        const val ACTION_CONFIRM_TRANSACTION = "com.finpess.app.ACTION_CONFIRM_TRANSACTION"
        const val EXTRA_NOTIFICATION_ID = "extra_notification_id"
        const val EXTRA_VALOR_CENTAVOS = "extra_valor_centavos"
        const val EXTRA_DESCRICAO = "extra_descricao"
        const val EXTRA_TIPO = "extra_tipo"
        const val EXTRA_BANCO = "extra_banco"
        const val EXTRA_FORMA_PAGAMENTO = "extra_forma_pagamento"
    }
}
