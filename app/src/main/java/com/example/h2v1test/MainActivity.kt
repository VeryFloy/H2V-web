package com.example.h2v1test

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.example.h2v1test.data.network.ApiClient
import com.example.h2v1test.data.network.WebSocketClient
import com.example.h2v1test.data.storage.TokenStorage
import com.example.h2v1test.ui.theme.H2VColors
import com.example.h2v1test.ui.theme.H2VTheme

class MainActivity : ComponentActivity() {

    private lateinit var appState: AppState

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val tokenStorage = TokenStorage(applicationContext)
        val apiClient = ApiClient(tokenStorage)
        val wsClient = WebSocketClient(apiClient.okHttpClient)
        appState = AppState(tokenStorage, apiClient, wsClient)

        setContent {
            H2VTheme(darkTheme = true) {
                androidx.compose.foundation.layout.Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(H2VColors.AppBgDark)
                ) {
                    AppNavigation(appState = appState)
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        appState.wsClient.disconnect()
    }
}
