package com.finpess.app.ui.transactions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.finpess.app.core.CurrencyUtils
import com.finpess.app.data.local.entity.LaunchEntity
import com.finpess.app.data.local.entity.SyncStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransactionListScreen(
    viewModel: TransactionListViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val launches by viewModel.launches.collectAsState()
    val bankAccounts by viewModel.bankAccounts.collectAsState()
    var showNewSheet by remember { mutableStateOf(false) }

    val totalEntradas = launches.filter { it.tipo == "ENTRADA" && it.status == "CONFIRMADO" }
        .sumOf { it.valorCentavos }
    val totalSaidas = launches.filter { it.tipo == "SAIDA" && it.status == "CONFIRMADO" }
        .sumOf { it.valorCentavos }
    val saldoMes = totalEntradas - totalSaidas

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Lançamentos", fontWeight = FontWeight.Bold)
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = "Atualizar")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showNewSheet = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White
            ) {
                Icon(imageVector = Icons.Default.Add, contentDescription = "Novo Lançamento")
            }
        }
    ) { paddingValues ->
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp)
        ) {
            // Seletor de Mês
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { viewModel.prevMonth() }) {
                    Icon(imageVector = Icons.Default.ChevronLeft, contentDescription = "Mês Anterior")
                }
                Text(
                    text = uiState.selectedYearMonth,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = { viewModel.nextMonth() }) {
                    Icon(imageVector = Icons.Default.ChevronRight, contentDescription = "Próximo Mês")
                }
            }

            // Resumo do Mês
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(
                            text = "Entradas",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.outline
                        )
                        Text(
                            text = CurrencyUtils.formatCentavosToBrl(totalEntradas),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF10B981)
                        )
                    }
                    Column {
                        Text(
                            text = "Saídas",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.outline
                        )
                        Text(
                            text = CurrencyUtils.formatCentavosToBrl(totalSaidas),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFEF4444)
                        )
                    }
                    Column {
                        Text(
                            text = "Saldo Mês",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.outline
                        )
                        Text(
                            text = CurrencyUtils.formatCentavosToBrl(saldoMes),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (saldoMes >= 0) Color(0xFF10B981) else Color(0xFFEF4444)
                        )
                    }
                }
            }

            // Barra de Busca
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = { viewModel.setSearchQuery(it) },
                placeholder = { Text("Buscar lançamentos...") },
                leadingIcon = {
                    Icon(imageVector = Icons.Default.Search, contentDescription = null)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            // Lista de Lançamentos
            if (launches.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (uiState.isLoading) "Carregando lançamentos..." else "Nenhum lançamento no período.",
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 8.dp)
                ) {
                    items(launches, key = { it.id }) { launch ->
                        LaunchItemRow(launch = launch)
                    }
                }
            }
        }
    }

    if (showNewSheet) {
        NewTransactionSheet(
            bankAccounts = bankAccounts,
            onDismiss = { showNewSheet = false },
            onSave = { tipo, desc, valor, data, contaId, contaNome, cat, sit ->
                viewModel.createTransaction(
                    tipo = tipo,
                    descricao = desc,
                    valorCentavos = valor,
                    data = data,
                    contaId = contaId,
                    contaNome = contaNome,
                    categoria = cat,
                    situacao = sit,
                    onSuccess = { showNewSheet = false }
                )
            }
        )
    }
}

@Composable
fun LaunchItemRow(launch: LaunchEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Círculo com inicial da Categoria
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(
                        if (launch.tipo == "ENTRADA") Color(0xFF10B981).copy(alpha = 0.15f)
                        else Color(0xFFEF4444).copy(alpha = 0.15f)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = launch.categoria.take(1).uppercase(),
                    fontWeight = FontWeight.Bold,
                    color = if (launch.tipo == "ENTRADA") Color(0xFF10B981) else Color(0xFFEF4444)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Detalhes (Descrição, Conta, Data)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = launch.descricao,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = launch.data,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.outline
                    )
                    if (!launch.contaNome.isNullOrBlank()) {
                        Text(
                            text = "• ${launch.contaNome}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.outline,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Valor e Status
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = (if (launch.tipo == "ENTRADA") "+ " else "- ") +
                            CurrencyUtils.formatCentavosToBrl(launch.valorCentavos),
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = if (launch.tipo == "ENTRADA") Color(0xFF10B981) else Color(0xFFEF4444)
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (launch.syncStatus != SyncStatus.SYNCED) {
                        Icon(
                            imageVector = Icons.Default.SyncProblem,
                            contentDescription = "Pendente de sincronização",
                            modifier = Modifier.size(12.dp),
                            tint = Color(0xFFF59E0B)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                    }

                    if (launch.status == "PREVISTO") {
                        Text(
                            text = "PREVISTO",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFF59E0B)
                        )
                    }
                }
            }
        }
    }
}
