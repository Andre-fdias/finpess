package com.finpess.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class AuthUiState {
    object Idle : AuthUiState()
    object Loading : AuthUiState()
    data class Authenticated(val userName: String) : AuthUiState()
    data class RequireOwnerPassword(val email: String, val message: String) : AuthUiState()
    data class Error(val message: String) : AuthUiState()
}

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val securityManager: SecurityManager
) : ViewModel() {

    private val _uiState = MutableStateFlow<AuthUiState>(AuthUiState.Idle)
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkExistingSession()
    }

    fun checkExistingSession() {
        if (authRepository.isUserLoggedIn()) {
            val name = securityManager.getUserName() ?: "Usuário"
            _uiState.value = AuthUiState.Authenticated(name)
        }
    }

    fun login(email: String, pass: String) {
        if (email.isBlank() || pass.isBlank()) {
            _uiState.value = AuthUiState.Error("Preencha o e-mail e a senha.")
            return
        }

        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            when (val result = authRepository.login(email.trim(), pass)) {
                is Result.Success -> {
                    securityManager.setBiometricEnabled(true)
                    val userName = result.data.effectiveUser?.nome ?: securityManager.getUserName() ?: "Usuário"
                    _uiState.value = AuthUiState.Authenticated(userName)
                }
                is Result.Error -> {
                    _uiState.value = AuthUiState.Error(result.message)
                }
                else -> Unit
            }
        }
    }

    fun loginWithGoogle(email: String, password: String? = null) {
        if (email.isBlank() || !email.contains("@")) {
            _uiState.value = AuthUiState.Error("Informe um e-mail válido da sua Conta Google.")
            return
        }

        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            when (val result = authRepository.loginWithGoogle(email.trim(), password)) {
                is Result.Success -> {
                    if (result.data.requirePassword == true) {
                        _uiState.value = AuthUiState.RequireOwnerPassword(
                            email = email.trim(),
                            message = result.data.message ?: "Conta de Proprietário identificada. Confirme sua senha do Finpess para continuar."
                        )
                    } else {
                        securityManager.setBiometricEnabled(true)
                        val userName = result.data.effectiveUser?.nome ?: securityManager.getUserName() ?: email.split("@")[0]
                        _uiState.value = AuthUiState.Authenticated(userName)
                    }
                }
                is Result.Error -> {
                    _uiState.value = AuthUiState.Error(result.message)
                }
                else -> Unit
            }
        }
    }

    fun resetState() {
        _uiState.value = AuthUiState.Idle
    }

    fun logout() {
        authRepository.logout()
        _uiState.value = AuthUiState.Idle
    }
}
