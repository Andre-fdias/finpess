package com.finpess.app.data.repository

import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.model.LoginRequest
import com.finpess.app.data.model.LoginResponse
import com.finpess.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AuthRepository(private val securityManager: SecurityManager) {
    private val api = ApiClient.apiService

    suspend fun login(email: String, pass: String): Result<LoginResponse> = withContext(Dispatchers.IO) {
        try {
            val response = api.login(LoginRequest(email = email, senha = pass))
            if (response.isSuccessful && response.body()?.ok == true) {
                val data = response.body()!!.data!!
                securityManager.saveSessionToken(data.token)
                securityManager.saveUserData(data.usuario.email, data.usuario.nome)
                Result.Success(data)
            } else {
                val errMsg = response.body()?.error ?: "Falha ao realizar login (Erro HTTP ${response.code()})"
                Result.Error(errMsg)
            }
        } catch (e: Exception) {
            Result.Error(e.localizedMessage ?: "Erro de conexão com o servidor Finpess", e)
        }
    }

    fun isUserLoggedIn(): Boolean {
        return !securityManager.getSessionToken().isNullOrBlank()
    }

    fun logout() {
        securityManager.clearSessionToken()
    }
}
