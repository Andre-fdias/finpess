package com.finpess.app.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.repository.AuthRepository
import com.finpess.app.data.repository.DashboardRepository
import com.finpess.app.security.BiometricAuthManager
import com.finpess.app.ui.auth.AuthUiState
import com.finpess.app.ui.auth.AuthViewModel
import com.finpess.app.ui.auth.LoginScreen
import com.finpess.app.ui.dashboard.DashboardScreen
import com.finpess.app.ui.dashboard.DashboardViewModel
import com.finpess.app.ui.theme.FinpessTheme
import com.finpess.app.ui.theme.SlateBgDark

class MainActivity : FragmentActivity() {

    private lateinit var securityManager: SecurityManager
    private lateinit var biometricManager: BiometricAuthManager
    private lateinit var authRepository: AuthRepository
    private lateinit var dashboardRepository: DashboardRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        securityManager = SecurityManager(applicationContext)
        biometricManager = BiometricAuthManager(this)
        authRepository = AuthRepository(securityManager)
        dashboardRepository = DashboardRepository(securityManager)

        setContent {
            FinpessTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = SlateBgDark
                ) {
                    val authViewModel: AuthViewModel = viewModel {
                        AuthViewModel(authRepository, securityManager)
                    }
                    val authState by authViewModel.uiState.collectAsState()

                    // Se já estiver logado, exibe Container Principal com Navegação; caso contrário, Tela de Login
                    when (val state = authState) {
                        is AuthUiState.Authenticated -> {
                            com.finpess.app.ui.main.MainNavigationContainer(
                                userName = state.userName,
                                securityManager = securityManager,
                                dashboardRepository = dashboardRepository,
                                onLogout = { authViewModel.logout() }
                            )
                        }
                        else -> {
                            LoginScreen(
                                uiState = state,
                                onLoginClick = { email, pass ->
                                    authViewModel.login(email, pass)
                                },
                                onBiometricClick = {
                                    triggerBiometricAuth {
                                        authViewModel.checkExistingSession()
                                    }
                                },
                                isBiometricAvailable = biometricManager.canAuthenticate() && securityManager.getSessionToken() != null
                            )
                        }
                    }
                }
            }
        }

        // Se o usuário já tiver sessão e biometria habilitada, dispara prompt na inicialização
        if (securityManager.getSessionToken() != null && securityManager.isBiometricEnabled() && biometricManager.canAuthenticate()) {
            triggerBiometricAuth {
                // Sessão desbloqueada via Biometria
            }
        }
    }

    private fun triggerBiometricAuth(onSuccess: () -> Unit) {
        biometricManager.authenticate(
            activity = this,
            title = "Desbloquear Finpess",
            subtitle = "Toque no leitor biométrico",
            onSuccess = onSuccess,
            onError = { errMsg ->
                Toast.makeText(this, errMsg, Toast.LENGTH_SHORT).show()
            }
        )
    }
}
