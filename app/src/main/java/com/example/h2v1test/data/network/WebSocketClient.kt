package com.example.h2v1test.data.network

import com.example.h2v1test.data.models.WSEvent
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

class WebSocketClient(private val okHttpClient: OkHttpClient) {

    private val gson = Gson()
    private var webSocket: WebSocket? = null
    private var pingJob: kotlinx.coroutines.Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _events = MutableSharedFlow<WSEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<WSEvent> = _events

    var isConnected = false
        private set

    fun connect(token: String) {
        disconnect()
        val url = "${Config.WS_URL}?token=$token"
        val request = Request.Builder().url(url).build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                startPing()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                pingJob?.cancel()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected = false
                pingJob?.cancel()
            }
        })
    }

    fun disconnect() {
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, "Going away")
        webSocket = null
        isConnected = false
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(30_000)
                send("presence:ping")
            }
        }
    }

    private fun handleMessage(text: String) {
        try {
            @Suppress("UNCHECKED_CAST")
            val raw = gson.fromJson(text, Map::class.java) as? Map<String, Any?> ?: return
            val eventType = raw["event"] as? String ?: return
            @Suppress("UNCHECKED_CAST")
            val payload = (raw["payload"] as? Map<String, Any?>) ?: emptyMap()
            val event = WSEvent(eventType, payload)
            scope.launch { _events.emit(event) }
        } catch (_: Exception) {}
    }

    fun send(event: String, payload: Map<String, Any?> = emptyMap()) {
        val map = mutableMapOf<String, Any>("event" to event)
        if (payload.isNotEmpty()) map["payload"] = payload
        val json = gson.toJson(map)
        webSocket?.send(json)
    }

    fun sendMessage(
        chatId: String,
        text: String,
        type: String = "TEXT",
        mediaUrl: String? = null,
        replyToId: String? = null
    ) {
        val payload = mutableMapOf<String, Any>(
            "chatId" to chatId,
            "text" to text,
            "type" to type,
            "signalType" to 0
        )
        mediaUrl?.let { payload["mediaUrl"] = it }
        replyToId?.let { payload["replyToId"] = it }
        send("message:send", payload)
    }

    fun typingStart(chatId: String) = send("typing:start", mapOf("chatId" to chatId))
    fun typingStop(chatId: String) = send("typing:stop", mapOf("chatId" to chatId))
    fun markRead(messageId: String, chatId: String) =
        send("message:read", mapOf("messageId" to messageId, "chatId" to chatId))
}
