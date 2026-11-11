package com.finpess.app.ui.dashboard.components

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.finpess.app.core.CurrencyUtils
import com.finpess.app.data.model.ResumoGeralModulosDto
import com.finpess.app.ui.theme.*

@Composable
fun Executive360Section(
    resumoModulos: ResumoGeralModulosDto?,
    hideValues: Boolean,
    onModuleClick: (moduleId: String) -> Unit,
    modifier: Modifier = Modifier
) {
    if (resumoModulos == null) return

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Central Executiva 360°",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.width(8.dp))
            Surface(
                color = AccentPurple.copy(alpha = 0.2f),
                shape = RoundedCornerShape(6.dp)
            ) {
                Text(
                    text = "8 Módulos",
                    color = AccentPurple,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                )
            }
        }

        // Grade de Cards 360°
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // 1. Cartões de Crédito
            resumoModulos.cartoes?.let { cart ->
                ExecutiveCard(
                    title = "💳 Cartões de Crédito",
                    badge = "${cart.totalCartoes} cartões",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(cart.faturasAbertasCentavos),
                    mainLabel = "Faturas Abertas do Mês",
                    subText = if (hideValues) "Disp: ••••" else "Disp: ${CurrencyUtils.formatCentsToBrl(cart.limiteDisponivelCentavos)} de ${CurrencyUtils.formatCentsToBrl(cart.limiteTotalCentavos)}",
                    valueColor = DangerRed,
                    onClick = { onModuleClick("credit-cards") }
                )
            }

            // 2. Recorrentes & Fixas
            resumoModulos.recorrentes?.let { rec ->
                ExecutiveCard(
                    title = "🔁 Contas Recorrentes",
                    badge = "${rec.totalAtivas} ativas",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(rec.custoFixoMensalCentavos),
                    mainLabel = "Custo Fixo Comprometido",
                    subText = if (hideValues) "••••" else "Pagas: ${CurrencyUtils.formatCentsToBrl(rec.pagasMesCentavos)} | Pend: ${CurrencyUtils.formatCentsToBrl(rec.pendentesMesCentavos)}",
                    valueColor = EmeraldPrimary,
                    onClick = { onModuleClick("recurring") }
                )
            }

            // 3. Dívidas & Acordos
            resumoModulos.dividas?.let { div ->
                ExecutiveCard(
                    title = "⚖️ Dívidas & Acordos",
                    badge = "${div.totalDividas} dívidas",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(div.saldoDevedorCentavos),
                    mainLabel = "Saldo Devedor Total",
                    subText = if (hideValues) "••••" else "Em Acordo: ${CurrencyUtils.formatCentsToBrl(div.emAcordoCentavos)}",
                    valueColor = WarningAmber,
                    onClick = { onModuleClick("debts") }
                )
            }

            // 4. Empréstimos & Consignados
            resumoModulos.emprestimos?.let { emp ->
                ExecutiveCard(
                    title = "🏢 Empréstimos & Consignados",
                    badge = "${emp.totalEmprestimos} contratos",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(emp.saldoDevedorCentavos),
                    mainLabel = "Saldo Devedor Restante",
                    subText = if (hideValues) "••••" else "Parcelas: ${CurrencyUtils.formatCentsToBrl(emp.parcelaMensalCentavos)} (Folha: ${CurrencyUtils.formatCentsToBrl(emp.consignadoFolhaCentavos)})",
                    valueColor = AccentBlue,
                    onClick = { onModuleClick("loans") }
                )
            }

            // 5. Investimentos
            resumoModulos.investimentos?.let { inv ->
                ExecutiveCard(
                    title = "📈 Investimentos",
                    badge = "${inv.totalAtivos} ativos",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(inv.patrimonioTotalCentavos),
                    mainLabel = "Patrimônio em Carteira",
                    subText = if (hideValues) "••••" else "Retorno: +${CurrencyUtils.formatCentsToBrl(inv.rentabilidadeCentavos)} (${inv.rentabilidadePct}%)",
                    valueColor = AccentPurple,
                    onClick = { onModuleClick("investments") }
                )
            }

            // 6. Metas & Reserva
            resumoModulos.metas?.let { met ->
                ExecutiveCard(
                    title = "🎯 Metas & Reserva de Emergência",
                    badge = "${met.totalMetas} metas",
                    mainValue = if (hideValues) "••••" else CurrencyUtils.formatCentsToBrl(met.totalAcumuladoCentavos),
                    mainLabel = "Total Guardado (${met.percentualGeral}% alcançado)",
                    subText = "Reserva: ${met.mesesReservaCobertos} meses de despesas cobertos",
                    valueColor = SuccessGreen,
                    onClick = { onModuleClick("goals") }
                )
            }
        }
    }
}

@Composable
fun ExecutiveCard(
    title: String,
    badge: String,
    mainValue: String,
    mainLabel: String,
    subText: String,
    valueColor: Color,
    onClick: () -> Unit
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = SlateSurfaceDark),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, SlateBorderDark, RoundedCornerShape(12.dp))
            .clickable { onClick() }
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
                Surface(
                    color = SlateBorderDark,
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        text = badge,
                        color = TextSecondaryDark,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = mainValue,
                fontSize = 20.sp,
                fontWeight = FontWeight.ExtraBold,
                color = valueColor
            )

            Text(
                text = mainLabel,
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondaryDark
            )

            Spacer(modifier = Modifier.height(6.dp))
            Divider(color = SlateBorderDark.copy(alpha = 0.5f), thickness = 0.8.dp)
            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = subText,
                fontSize = 11.sp,
                color = TextMutedDark
            )
        }
    }
}

