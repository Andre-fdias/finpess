package com.finpess.app.core

import java.text.NumberFormat
import java.util.Locale

object CurrencyUtils {
    private val brLocale = Locale("pt", "BR")
    private val formatter = NumberFormat.getCurrencyInstance(brLocale)

    /**
     * Converte centavos inteiros (ex: 125050) em string formatada R$ 1.250,50
     */
    fun formatCentsToBrl(cents: Long): String {
        val reais = cents / 100.0
        return formatter.format(reais)
    }

    fun formatCentavosToBrl(cents: Long): String = formatCentsToBrl(cents)

    /**
     * Converte string de entrada digitada (ex: "45,50" ou "45.50") em centavos inteiros (4550L)
     */
    fun parseInputToCents(input: String): Long {
        val clean = input.replace("[^0-9,.]".toRegex(), "")
            .replace(",", ".")
        val doubleVal = clean.toDoubleOrNull() ?: 0.0
        return Math.round(doubleVal * 100)
    }

    fun parseBrlToCentavos(input: String): Long = parseInputToCents(input)
}
