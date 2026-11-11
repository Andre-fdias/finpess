package com.finpess.app.ui.main

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.local.AppDatabase
import com.finpess.app.data.remote.ApiClient
import com.finpess.app.data.repository.DashboardRepository
import com.finpess.app.data.repository.TransactionRepository
import com.finpess.app.ui.cards.CreditCardsScreen
import com.finpess.app.ui.cards.CreditCardsViewModel
import com.finpess.app.ui.dashboard.DashboardScreen
import com.finpess.app.ui.dashboard.DashboardViewModel
import com.finpess.app.ui.settings.SettingsScreen
import com.finpess.app.ui.transactions.TransactionListScreen
import com.finpess.app.ui.transactions.TransactionListViewModel

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Dashboard : Screen("dashboard", "Dashboard", Icons.Default.Dashboard)
    object Launches : Screen("launches", "Lançamentos", Icons.Default.ReceiptLong)
    object Cards : Screen("cards", "Cartões", Icons.Default.CreditCard)
    object Settings : Screen("settings", "Ajustes", Icons.Default.Settings)
}

@Composable
fun MainNavigationContainer(
    userName: String,
    securityManager: SecurityManager,
    dashboardRepository: DashboardRepository,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier
) {
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Dashboard) }

    val context = androidx.compose.ui.platform.LocalContext.current
    val database = remember { AppDatabase.getInstance(context) }
    val transactionRepository = remember {
        TransactionRepository(ApiClient.apiService, database, securityManager)
    }

    val dashViewModel = remember { DashboardViewModel(dashboardRepository, securityManager) }
    val dashState by dashViewModel.uiState.collectAsState()
    val hideValues by dashViewModel.hideValues.collectAsState()

    val transactionViewModel = remember { TransactionListViewModel(transactionRepository) }
    val cardsViewModel = remember { CreditCardsViewModel(transactionRepository) }

    val screens = listOf(Screen.Dashboard, Screen.Launches, Screen.Cards, Screen.Settings)

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface
            ) {
                screens.forEach { screen ->
                    NavigationBarItem(
                        icon = { Icon(imageVector = screen.icon, contentDescription = screen.title) },
                        label = { Text(screen.title) },
                        selected = currentScreen.route == screen.route,
                        onClick = { currentScreen = screen },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        Surface(
            modifier = modifier
                .fillMaxSize()
                .padding(innerPadding),
            color = MaterialTheme.colorScheme.background
        ) {
            when (currentScreen) {
                is Screen.Dashboard -> {
                    DashboardScreen(
                        uiState = dashState,
                        userName = userName,
                        hideValues = hideValues,
                        onToggleHideValues = { dashViewModel.toggleHideValues() },
                        onRefresh = { dashViewModel.loadDashboard() },
                        onLogout = onLogout,
                        onModuleClick = { moduleId ->
                            when (moduleId) {
                                "launches", "transacoes" -> currentScreen = Screen.Launches
                                "credit_cards", "cartoes" -> currentScreen = Screen.Cards
                                else -> {}
                            }
                        }
                    )
                }
                is Screen.Launches -> {
                    TransactionListScreen(
                        viewModel = transactionViewModel
                    )
                }
                is Screen.Cards -> {
                    CreditCardsScreen(
                        viewModel = cardsViewModel
                    )
                }
                is Screen.Settings -> {
                    SettingsScreen(
                        securityManager = securityManager,
                        onLogout = onLogout
                    )
                }
            }
        }
    }
}
