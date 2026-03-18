package com.example.h2v1test

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.h2v1test.data.models.User
import com.example.h2v1test.data.models.WSEvent
import com.example.h2v1test.data.network.ApiClient
import com.example.h2v1test.data.network.WebSocketClient
import com.example.h2v1test.data.storage.TokenStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AppState(
    val tokenStorage: TokenStorage,
    val apiClient: ApiClient,
    val wsClient: WebSocketClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var isAuthenticated by mutableStateOf(false)
    var currentUser by mutableStateOf<User?>(null)
    val onlineUserIds = mutableStateMapOf<String, Boolean>()
    var activeChatId by mutableStateOf<String?>(null)

    init {
        if (tokenStorage.accessToken != null) {
            isAuthenticated = true
            scope.launch { refreshUser() }
        }
    }

    suspend fun refreshUser() {
        try {
            val user = apiClient.getMe()
            currentUser = user
            val token = tokenStorage.accessToken ?: return
            wsClient.connect(token)
        } catch (_: Exception) {
            signOut()
        }
    }

    fun signIn(user: User, accessToken: String, refreshToken: String) {
        tokenStorage.save(accessToken, refreshToken)
        currentUser = user
        isAuthenticated = true
        wsClient.connect(accessToken)
    }

    fun signOut() {
        scope.launch {
            tokenStorage.refreshToken?.let { apiClient.logout(it) }
        }
        tokenStorage.clear()
        currentUser = null
        isAuthenticated = false
        onlineUserIds.clear()
        activeChatId = null
        wsClient.disconnect()
    }

    fun handlePresence(event: WSEvent) {
        when (event.type) {
            "user:online" -> event.userId?.let { onlineUserIds[it] = true }
            "user:offline" -> event.userId?.let { onlineUserIds.remove(it) }
            "presence:snapshot" -> {
                @Suppress("UNCHECKED_CAST")
                val ids = (event.payload["onlineUserIds"] as? List<String>) ?: return
                onlineUserIds.clear()
                ids.forEach { onlineUserIds[it] = true }
            }
        }
    }
}
