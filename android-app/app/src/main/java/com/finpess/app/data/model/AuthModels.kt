package com.finpess.app.data.model

import com.google.gson.annotations.SerializedName

data class ApiResponse<T>(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("data") val data: T? = null,
    @SerializedName("error") val error: String? = null,
    @SerializedName("sessionToken") val sessionToken: String? = null,
    @SerializedName("token") val token: String? = null,
    @SerializedName("user") val user: UserDto? = null,
    @SerializedName("usuario") val usuario: UserDto? = null,
    @SerializedName("requirePassword") val requirePassword: Boolean? = false,
    @SerializedName("status") val status: String? = null,
    @SerializedName("message") val message: String? = null
)

data class AuthContextDto(
    @SerializedName("sessionToken") val sessionToken: String
)

data class LoginRequest(
    @SerializedName("action") val action: String = "auth.login",
    @SerializedName("payload") val payload: LoginPayload? = null,
    @SerializedName("email") val email: String? = null,
    @SerializedName("senha") val senha: String? = null
)

data class LoginPayload(
    @SerializedName("email") val email: String,
    @SerializedName("senha") val senha: String
)

data class GoogleLoginRequest(
    @SerializedName("action") val action: String = "auth.googleLogin",
    @SerializedName("payload") val payload: GoogleLoginPayload
)

data class GoogleLoginPayload(
    @SerializedName("email") val email: String,
    @SerializedName("idToken") val idToken: String? = null,
    @SerializedName("senha") val senha: String? = null
)

data class LoginResponse(
    @SerializedName("sessionToken") val sessionToken: String? = null,
    @SerializedName("token") val token: String? = null,
    @SerializedName("user") val user: UserDto? = null,
    @SerializedName("usuario") val usuario: UserDto? = null,
    @SerializedName("requirePassword") val requirePassword: Boolean? = false,
    @SerializedName("status") val status: String? = null,
    @SerializedName("message") val message: String? = null
) {
    val effectiveToken: String get() = sessionToken ?: token ?: ""
    val effectiveUser: UserDto? get() = user ?: usuario
}

data class UserDto(
    @SerializedName("id") val id: String? = null,
    @SerializedName("email") val email: String,
    @SerializedName("nome") val nome: String,
    @SerializedName("papel") val papel: String? = "MEMBRO",
    @SerializedName("status") val status: String? = "APROVADO",
    @SerializedName("grupo_id") val grupoId: String? = null
)
