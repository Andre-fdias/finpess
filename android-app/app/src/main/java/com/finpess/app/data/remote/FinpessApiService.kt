package com.finpess.app.data.remote

import com.finpess.app.core.Constants
import com.finpess.app.data.model.*
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface FinpessApiService {
    @POST(Constants.EXEC_PATH)
    suspend fun login(
        @Body request: LoginRequest
    ): Response<ApiResponse<LoginResponse>>

    @POST(Constants.EXEC_PATH)
    suspend fun getDashboard(
        @Body request: DashboardRequest
    ): Response<ApiResponse<DashboardDto>>

    @POST(Constants.EXEC_PATH)
    suspend fun getLaunches(
        @Body request: LaunchesListRequest
    ): Response<ApiResponse<List<LaunchItemDto>>>

    @POST(Constants.EXEC_PATH)
    suspend fun createLaunch(
        @Body request: CreateLaunchRequest
    ): Response<ApiResponse<LaunchItemDto>>

    @POST(Constants.EXEC_PATH)
    suspend fun createPurchase(
        @Body request: CreatePurchaseRequest
    ): Response<ApiResponse<Any>>

    @POST(Constants.EXEC_PATH)
    suspend fun getBankAccounts(
        @Body request: BankAccountsListRequest
    ): Response<ApiResponse<List<BankAccountDto>>>

    @POST(Constants.EXEC_PATH)
    suspend fun getCreditCards(
        @Body request: CreditCardsListRequest
    ): Response<ApiResponse<List<CreditCardDto>>>
}
