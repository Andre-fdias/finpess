package com.finpess.app.service

import java.util.regex.Pattern

data class ParsedBankTransaction(
    val valorCentavos: Long,
    val descricao: String,
    val tipo: String, // SAIDA ou ENTRADA
    val bancoOrigem: String,
    val formaPagamento: String // PIX, CARTAO, DEBITO
)

object BankNotificationParser {

    private val BANK_PACKAGES = mapOf(
        "com.nu.production" to "Nubank",
        "br.com.intermedium" to "Banco Inter",
        "com.itau" to "Itaú",
        "com.bradesco" to "Bradesco",
        "com.santander.app" to "Santander",
        "com.c6bank.app" to "C6 Bank",
        "br.com.gabba.caixa" to "Caixa",
        "br.com.bb.android" to "Banco do Brasil",
        "com.mercadopago.wallet" to "Mercado Pago",
        "com.picpay" to "PicPay"
    )

    fun isSupportedBank(packageName: String): Boolean {
        return BANK_PACKAGES.containsKey(packageName)
    }

    fun getBankName(packageName: String): String {
        return BANK_PACKAGES[packageName] ?: "Banco"
    }

    fun parse(packageName: String, title: String?, text: String?): ParsedBankTransaction? {
        val fullText = "${title ?: ""} ${text ?: ""}".trim()
        if (fullText.isBlank()) return null

        // 1. Extração de valor em Reais (R$ 1.234,56 ou R$ 45,90)
        val valueRegex = Pattern.compile("""R\$\s*([\d\.]*,\d{2})""", Pattern.CASE_INSENSITIVE)
        val valueMatcher = valueRegex.matcher(fullText)
        if (!valueMatcher.find()) return null

        val rawAmount = valueMatcher.group(1) ?: return null
        val cleanNumber = rawAmount.replace(".", "").replace(",", "")
        val valorCentavos = cleanNumber.toLongOrNull() ?: return null

        // 2. Determinação de Tipo (ENTRADA vs SAIDA)
        val lower = fullText.lowercase()
        val isEntrada = lower.contains("recebeu") || lower.contains("recebida") ||
                lower.contains("transferência recebida") || lower.contains("depósito")

        val tipo = if (isEntrada) "ENTRADA" else "SAIDA"

        // 3. Forma de Pagamento
        val formaPagamento = when {
            lower.contains("pix") -> "PIX"
            lower.contains("crédito") || lower.contains("cartao") || lower.contains("cartão") -> "CARTAO"
            lower.contains("débito") || lower.contains("debito") -> "DEBITO"
            else -> "OUTRO"
        }

        // 4. Extração de Descrição / Estabelecimento
        var merchant = ""
        val merchantRegexes = listOf(
            Pattern.compile("""(?:em|no|na)\s+([A-Za-z0-9\s\.\-_]{3,30})(?:\.|\s|$)""", Pattern.CASE_INSENSITIVE),
            Pattern.compile("""(?:para|de)\s+([A-Za-z0-9\s\.\-_]{3,30})(?:\.|\s|$)""", Pattern.CASE_INSENSITIVE),
            Pattern.compile("""compra aprovada(?:\s+no\s+valor)?\s+em\s+([^,\.]+)""", Pattern.CASE_INSENSITIVE)
        )

        for (regex in merchantRegexes) {
            val m = regex.matcher(fullText)
            if (m.find()) {
                val candidate = m.group(1)?.trim() ?: ""
                if (candidate.isNotBlank() && !candidate.startsWith("R$")) {
                    merchant = candidate
                    break
                }
            }
        }

        val bank = getBankName(packageName)
        val finalDescription = if (merchant.isNotBlank()) {
            merchant
        } else {
            if (tipo == "ENTRADA") "Transferência Recebida ($bank)" else "Compra/Pagamento ($bank)"
        }

        return ParsedBankTransaction(
            valorCentavos = valorCentavos,
            descricao = finalDescription,
            tipo = tipo,
            bancoOrigem = bank,
            formaPagamento = formaPagamento
        )
    }
}

