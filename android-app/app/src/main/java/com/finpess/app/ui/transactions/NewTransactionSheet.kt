package com.finpess.app.ui.transactions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.finpess.app.core.CurrencyUtils
import com.finpess.app.data.local.entity.BankAccountEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewTransactionSheet(
    bankAccounts: List<BankAccountEntity>,
    onDismiss: () -> Unit,
    onSave: (
        tipo: String,
        descricao: String,
        valorCentavos: Long,
        data: String,
        contaId: String,
        contaNome: String?,
        categoria: String,
        situacao: String
    ) -> Unit
) {
    var tipo by remember { mutableStateOf("SAIDA") } // SAIDA ou ENTRADA
    var valorText by remember { mutableStateOf("") }
    var descricao by remember { mutableStateOf("") }
    var dataLancamento by remember {
        mutableStateOf(SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date()))
    }
    var situacao by remember { mutableStateOf("CONFIRMADO") } // CONFIRMADO ou PREVISTO
    var selectedAccount by remember {
        mutableStateOf(bankAccounts.firstOrNull())
    }
    var categoria by remember { mutableStateOf("Alimentação") }

    val defaultCategoriesSaida = listOf(
        "Alimentação", "Moradia", "Transporte", "Saúde", "Lazer", "Educação", "Compras", "Outros"
    )
    val defaultCategoriesEntrada = listOf(
        "Salário", "Rendimentos", "Vendas", "Restituição", "Presente", "Outros"
    )

    val currentCategories = if (tipo == "SAIDA") defaultCategoriesSaida else defaultCategoriesEntrada

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp)
                .verticalScroll(rememberScrollState())
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Novo Lançamento",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = onDismiss) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Fechar")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Seletor Tipo: Despesa vs Receita
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(4.dp)
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (tipo == "SAIDA") Color(0xFFEF4444) else Color.Transparent)
                        .clickable {
                            tipo = "SAIDA"
                            categoria = defaultCategoriesSaida.first()
                        }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.ArrowDownward,
                            contentDescription = null,
                            tint = if (tipo == "SAIDA") Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Despesa",
                            fontWeight = FontWeight.Bold,
                            color = if (tipo == "SAIDA") Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (tipo == "ENTRADA") Color(0xFF10B981) else Color.Transparent)
                        .clickable {
                            tipo = "ENTRADA"
                            categoria = defaultCategoriesEntrada.first()
                        }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.ArrowUpward,
                            contentDescription = null,
                            tint = if (tipo == "ENTRADA") Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Receita",
                            fontWeight = FontWeight.Bold,
                            color = if (tipo == "ENTRADA") Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Campo de Valor em Reais
            OutlinedTextField(
                value = valorText,
                onValueChange = { valorText = it },
                label = { Text("Valor (R$)") },
                placeholder = { Text("0,00") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                textStyle = MaterialTheme.typography.headlineMedium.copy(
                    fontWeight = FontWeight.Bold,
                    color = if (tipo == "SAIDA") Color(0xFFEF4444) else Color(0xFF10B981)
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Descrição
            OutlinedTextField(
                value = descricao,
                onValueChange = { descricao = it },
                label = { Text("Descrição") },
                placeholder = { Text("Ex: Supermercado, Aluguel, Salário...") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Categoria Chips
            Text(
                text = "Categoria",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                currentCategories.take(4).forEach { cat ->
                    FilterChip(
                        selected = categoria == cat,
                        onClick = { categoria = cat },
                        label = { Text(cat, fontSize = 12.sp) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Conta Bancária
            Text(
                text = "Conta de Origem/Destino",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            if (bankAccounts.isEmpty()) {
                Text(
                    text = "Nenhuma conta cadastrada",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    bankAccounts.take(3).forEach { acc ->
                        FilterChip(
                            selected = selectedAccount?.id == acc.id,
                            onClick = { selectedAccount = acc },
                            label = { Text(acc.nome, fontSize = 12.sp) }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Status: Confirmado (Já Pago) vs Previsto (Agendado)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = if (situacao == "CONFIRMADO") "Lançamento Confirmado (Realizado)" else "Lançamento Previsto (Agendado)",
                        fontWeight = FontWeight.Medium,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = if (situacao == "CONFIRMADO") "Afeta o saldo bancário imediatamente" else "Não afeta o saldo de caixa atual",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
                Switch(
                    checked = situacao == "CONFIRMADO",
                    onCheckedChange = { checked ->
                        situacao = if (checked) "CONFIRMADO" else "PREVISTO"
                    }
                )
            }

            Spacer(modifier = Modifier.height(28.dp))

            // Botão Salvar
            Button(
                onClick = {
                    val centavos = CurrencyUtils.parseBrlToCentavos(valorText)
                    val conta = selectedAccount ?: bankAccounts.firstOrNull()
                    if (centavos > 0 && descricao.isNotBlank() && conta != null) {
                        onSave(
                            tipo,
                            descricao,
                            centavos,
                            dataLancamento,
                            conta.id,
                            conta.nome,
                            categoria,
                            situacao
                        )
                    }
                },
                enabled = valorText.isNotBlank() && descricao.isNotBlank() && (selectedAccount != null || bankAccounts.isNotEmpty()),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(imageVector = Icons.Default.Check, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Salvar Lançamento", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
