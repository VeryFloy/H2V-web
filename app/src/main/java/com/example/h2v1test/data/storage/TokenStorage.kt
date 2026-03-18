package com.example.h2v1test.data.storage

import android.content.Context
import android.content.SharedPreferences

class TokenStorage(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("h2v_prefs", Context.MODE_PRIVATE)

    var accessToken: String?
        get() = prefs.getString("accessToken", null)
        set(value) = prefs.edit().putString("accessToken", value).apply()

    var refreshToken: String?
        get() = prefs.getString("refreshToken", null)
        set(value) = prefs.edit().putString("refreshToken", value).apply()

    fun save(access: String, refresh: String) {
        prefs.edit()
            .putString("accessToken", access)
            .putString("refreshToken", refresh)
            .apply()
    }

    fun clear() {
        prefs.edit()
            .remove("accessToken")
            .remove("refreshToken")
            .apply()
    }
}
