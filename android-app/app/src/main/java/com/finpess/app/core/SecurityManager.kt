package com.finpess.app.core

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecurityManager(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val sharedPreferences: SharedPreferences = try {
        EncryptedSharedPreferences.create(
            context,
            Constants.PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Fallback para SharedPreferences padrão caso o dispositivo tenha erro no Keystore
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun saveSessionToken(token: String) {
        sharedPreferences.edit().putString(Constants.KEY_SESSION_TOKEN, token).apply()
    }

    fun getSessionToken(): String? {
        return sharedPreferences.getString(Constants.KEY_SESSION_TOKEN, null)
    }

    fun clearSessionToken() {
        sharedPreferences.edit().remove(Constants.KEY_SESSION_TOKEN).apply()
    }

    fun saveUserData(email: String, name: String) {
        sharedPreferences.edit()
            .putString(Constants.KEY_USER_EMAIL, email)
            .putString(Constants.KEY_USER_NAME, name)
            .apply()
    }

    fun getUserEmail(): String? = sharedPreferences.getString(Constants.KEY_USER_EMAIL, null)
    fun getUserName(): String? = sharedPreferences.getString(Constants.KEY_USER_NAME, null)

    fun setBiometricEnabled(enabled: Boolean) {
        sharedPreferences.edit().putBoolean(Constants.KEY_BIOMETRIC_ENABLED, enabled).apply()
    }

    fun isBiometricEnabled(): Boolean = sharedPreferences.getBoolean(Constants.KEY_BIOMETRIC_ENABLED, false)

    fun setHideValues(hide: Boolean) {
        sharedPreferences.edit().putBoolean(Constants.KEY_HIDE_VALUES, hide).apply()
    }

    fun isHideValues(): Boolean = sharedPreferences.getBoolean(Constants.KEY_HIDE_VALUES, false)
}
