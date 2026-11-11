package com.finpess.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import com.finpess.app.R
import com.finpess.app.core.CurrencyUtils
import com.finpess.app.ui.MainActivity
import java.util.UUID

class BankNotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        if (!BankNotificationParser.isSupportedBank(packageName)) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getString("android.title")
        val text = extras.getCharSequence("android.text")?.toString()

        val parsed = BankNotificationParser.parse(packageName, title, text) ?: return

        // Exibe notificação de confirmação 1-clique do Finpess
        postQuickConfirmNotification(parsed)
    }

    private fun postQuickConfirmNotification(parsed: ParsedBankTransaction) {
        val channelId = "finpess_bank_detection"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Detecção Inteligente de Transações",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifica quando compras ou transferências bancárias são detectadas"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val notificationId = (System.currentTimeMillis() % 100000).toInt()
        val formattedValue = CurrencyUtils.formatCentavosToBrl(parsed.valorCentavos)

        // Intent de Confirmação Rápida em 1-clique
        val confirmIntent = Intent(this, QuickConfirmReceiver::class.java).apply {
            action = QuickConfirmReceiver.ACTION_CONFIRM_TRANSACTION
            putExtra(QuickConfirmReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(QuickConfirmReceiver.EXTRA_VALOR_CENTAVOS, parsed.valorCentavos)
            putExtra(QuickConfirmReceiver.EXTRA_DESCRICAO, parsed.descricao)
            putExtra(QuickConfirmReceiver.EXTRA_TIPO, parsed.tipo)
            putExtra(QuickConfirmReceiver.EXTRA_BANCO, parsed.bancoOrigem)
            putExtra(QuickConfirmReceiver.EXTRA_FORMA_PAGAMENTO, parsed.formaPagamento)
        }

        val confirmPendingIntent = PendingIntent.getBroadcast(
            this,
            notificationId,
            confirmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Intent para Abrir o App
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            notificationId + 1,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_finpess_logo)
            .setContentTitle("💡 Transação no ${parsed.bancoOrigem}")
            .setContentText("Registrar $formattedValue em ${parsed.descricao}?")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("Detectamos $formattedValue em ${parsed.descricao} via ${parsed.formaPagamento}. Deseja adicionar automaticamente ao Finpess?")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openAppPendingIntent)
            .addAction(
                R.drawable.ic_finpess_logo,
                "✓ Confirmar ($formattedValue)",
                confirmPendingIntent
            )
            .build()

        notificationManager.notify(notificationId, notification)
    }
}
