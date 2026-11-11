package com.finpess.app.data.repository

import com.finpess.app.core.Result
import com.finpess.app.core.SecurityManager
import com.finpess.app.data.model.DashboardDto
import com.finpess.app.data.model.DashboardRequest
import com.finpess.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class DashboardRepository(private val securityManager: SecurityManager) {
    private val api = ApiClient.apiService

    suspend fun getDashboardData(mesReferencia: String = ""): Result<DashboardDto> = withContext(Dispatchers.IO) {
        val token = securityManager.getSessionToken()
        if (token.isNullOrBlank()) {
            return@withContext Result.Error("Sessão expirada. Faça login novamente.")
        }

        try {
            val response = api.getDashboard(DashboardRequest(token = token, mesReferencia = mesReferencia))
            if (response.isSuccessful && response.body()?.ok == true) {
                val data = response.body()!!.data!!
                Result.Success(data)
            } else {
                val errMsg = response.body()?.error ?: "Falha ao carregar dashboard (HTTP ${response.code()})"
                Result.Error(errMsg)
            }
        } catch (e: Exception) {
            Result.Error(e.localizedMessage ?: "Erro de rede ao carregar dados financeiros", e)
        }
    }
}

