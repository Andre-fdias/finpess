package com.finpess.app.data.model

import com.google.gson.annotations.SerializedName

data class ApiResponse<T>(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("data") val data: T?,
    @SerializedName("error") val error: String?
)

data class LoginRequest(
    @SerializedName("action") val action: String = "auth.login",
    @SerializedName("email") val email: String,
    @SerializedName("senha") val senha: String
)

data class LoginResponse(
    @SerializedName("token") val token: String,
    @SerializedName("usuario") val usuario: UserDto
)

data class UserDto(
    @SerializedName("id") val id: String,
    @SerializedName("email") val email: String,
    @SerializedName("nome") val nome: String,
    @SerializedName("papel") val papel: String,
    @SerializedName("status") val status: String,
    @SerializedName("grupo_id") val grupoId: String
)

