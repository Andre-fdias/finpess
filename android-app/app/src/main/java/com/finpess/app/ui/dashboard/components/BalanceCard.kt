package com.finpess.app.ui.dashboard.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.finpess.app.core.CurrencyUtils
import com.finpess.app.data.model.ConfirmadosDto
import com.finpess.app.ui.theme.*

@Composable
fun BalanceCard(
    confirmados: ConfirmadosDto,
    hideValues: Boolean,
    onToggleHideValues: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SlateSurfaceDark),
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, SlateBorderDark, RoundedCornerShape(16.dp))
    ) {
        Column(
            modifier = Modifier.padding(18.dp)
        ) {
            // Linha do Topo com Título e Olho de Privacidade
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "SALDO CONSOLIDADO EM CAIXA",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondaryDark,
                    letterSpacing = 1.sp,
                    fontWeight = FontWeight.Bold
                )

                IconButton(
                    onClick = onToggleHideValues,
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = if (hideValues) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = "Ocultar valores",
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // Saldo Principal
            val saldoText = if (hideValues) "••••••••" else CurrencyUtils.formatCentsToBrl(confirmados.saldoBancarioCentavos)
            Text(
                text = saldoText,
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(18.dp))
            Divider(color = SlateBorderDark, thickness = 1.dp)
            Spacer(modifier = Modifier.height(14.dp))

            // Linha com Entradas vs Saídas
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Receitas
                Column {
                    Text(
                        text = "Receitas do Mês",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondaryDark
                    )
                    val recText = if (hideValues) "••••" else "+${CurrencyUtils.formatCentsToBrl(confirmados.receitasMesCentavos)}"
                    Text(
                        text = recText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = SuccessGreen
                    )
                }

                // Despesas
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "Despesas Pagas",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondaryDark
                    )
                    val despText = if (hideValues) "••••" else "-${CurrencyUtils.formatCentsToBrl(confirmados.despesasMesCentavos)}"
                    Text(
                        text = despText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = DangerRed
                    )
                }
            }
        }
    }
}

