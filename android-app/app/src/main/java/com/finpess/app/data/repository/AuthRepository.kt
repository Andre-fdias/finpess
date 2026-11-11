package com.finpess.app.data.repository

import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.model.*
import com.finpess.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AuthRepository(private val securityManager: SecurityManager) {
    private val api = ApiClient.apiService

    suspend fun login(email: String, pass: String): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val response = api.login(
                LoginRequest(
                    email = email,
                    senha = pass,
                    payload = LoginPayload(email, pass)
                )
            )
            handleAuthResponse(response.body(), response.code())
        } catch (e: Exception) {
            Result.Error(e.localizedMessage ?: "Erro de conexão com o servidor Finpess", e)
        }
    }

    suspend fun loginWithGoogle(email: String, password: String? = null): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val response = api.googleLogin(
                GoogleLoginRequest(
                    payload = GoogleLoginPayload(email = email, senha = password)
                )
            )
            handleAuthResponse(response.body(), response.code())
        } catch (e: Exception) {
            Result.Error(e.localizedMessage ?: "Erro ao autenticar com a Conta Google", e)
        }
    }

    private fun handleAuthResponse(body: ApiResponse<LoginResponse>?, httpCode: Int): Result<LoginResponse> {
        if (body == null) {
            return Result.Error("Servidor retornou resposta vazia ($httpCode)")
        }

        if (!body.ok) {
            return Result.Error(body.error ?: "Falha ao autenticar usuário")
        }

        // Verifica se exige senha de segurança para a conta de proprietário
        if (body.requirePassword == true || body.data?.requirePassword == true) {
            return Result.Success(
                LoginResponse(
                    requirePassword = true,
                    message = body.message ?: body.data?.message ?: "Confirme sua senha de proprietário para prosseguir."
                )
            )
        }

        val token = body.sessionToken ?: body.token ?: body.data?.effectiveToken
        val user = body.user ?: body.usuario ?: body.data?.effectiveUser

        if (token.isNullOrBlank() || user == null) {
            return Result.Error(body.error ?: "Dados de sessão incompletos retornados pelo servidor.")
        }

        securityManager.saveSessionToken(token)
        securityManager.saveUserData(user.email, user.nome)

        val loginResponse = LoginResponse(
            sessionToken = token,
            user = user,
            status = user.status ?: "APROVADO",
            message = body.message
        )
        return Result.Success(loginResponse)
    }

    fun isUserLoggedIn(): Boolean {
        return !securityManager.getSessionToken().isNullOrBlank()
    }

    fun logout() {
        securityManager.clearSessionToken()
    }
}
