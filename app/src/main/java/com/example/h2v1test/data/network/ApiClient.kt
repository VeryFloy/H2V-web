package com.example.h2v1test.data.network

import com.example.h2v1test.data.models.*
import com.example.h2v1test.data.storage.TokenStorage
import com.google.gson.GsonBuilder
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.File
import java.util.concurrent.TimeUnit

object Config {
    const val BASE_URL = "https://h2von.com/"
    const val WS_URL = "wss://h2von.com/ws"
}

class ApiClient(private val tokenStorage: TokenStorage) {

    private val authInterceptor = Interceptor { chain ->
        val token = tokenStorage.accessToken
        val request = if (token != null) {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val gson = GsonBuilder().setLenient().create()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(Config.BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()

    val service: ApiService = retrofit.create(ApiService::class.java)

    // MARK: - Helper

    private fun <T> Response<ApiResponse<T>>.unwrap(): T {
        val body = body()
        if (isSuccessful && body != null) {
            if (body.success && body.data != null) return body.data
            throw ApiException(body.message ?: "Unknown error")
        }
        if (code() == 401) throw UnauthorizedException()
        throw ApiException("Server error: ${code()}")
    }

    // MARK: - Auth

    suspend fun register(nickname: String, email: String, password: String): AuthData =
        service.register(RegisterRequest(nickname, email, password)).unwrap()

    suspend fun login(email: String, password: String): AuthData =
        service.login(LoginRequest(email, password)).unwrap()

    suspend fun logout(refreshToken: String) {
        runCatching { service.logout(LogoutRequest(refreshToken)) }
    }

    suspend fun refreshTokens(): Tokens {
        val rt = tokenStorage.refreshToken ?: throw UnauthorizedException()
        val noAuthClient = okHttpClient.newBuilder()
            .interceptors()
            .let {
                OkHttpClient.Builder()
                    .addInterceptor(loggingInterceptor)
                    .build()
            }
        val noAuthRetrofit = Retrofit.Builder()
            .baseUrl(Config.BASE_URL)
            .client(noAuthClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
        val noAuthService = noAuthRetrofit.create(ApiService::class.java)
        val resp = noAuthService.refresh(RefreshRequest(rt))
        val tokens = resp.body()?.data ?: throw UnauthorizedException()
        tokenStorage.save(tokens.accessToken, tokens.refreshToken)
        return tokens
    }

    // MARK: - Users

    suspend fun getMe(): User = service.getMe().unwrap()
    suspend fun updateMe(nickname: String?, bio: String?, avatar: String?): User =
        service.updateMe(UpdateMeRequest(nickname, bio, avatar)).unwrap()

    suspend fun deleteAccount() { service.deleteAccount().unwrap<Unit>() }
    suspend fun searchUsers(query: String): List<User> = service.searchUsers(query).unwrap()
    suspend fun getUser(id: String): User = service.getUser(id).unwrap()

    // MARK: - Chats

    suspend fun getChats(cursor: String? = null, limit: Int = 30): ChatsData =
        service.getChats(cursor, limit).unwrap()

    suspend fun createDirectChat(targetUserId: String): Chat =
        service.createDirectChat(CreateDirectChatRequest(targetUserId)).unwrap()

    suspend fun createGroupChat(name: String, memberIds: List<String>): Chat =
        service.createGroupChat(CreateGroupChatRequest(name, memberIds)).unwrap()

    suspend fun leaveChat(chatId: String) { service.leaveChat(chatId) }

    // MARK: - Messages

    suspend fun getMessages(chatId: String, cursor: String? = null, limit: Int = 50): MessagesData =
        service.getMessages(chatId, cursor, limit).unwrap()

    suspend fun deleteMessage(id: String) { service.deleteMessage(id) }
    suspend fun editMessage(id: String, text: String): Message =
        service.editMessage(id, EditMessageRequest(text)).unwrap()

    suspend fun markRead(messageId: String) { runCatching { service.markRead(messageId) } }

    suspend fun addReaction(messageId: String, emoji: String) {
        runCatching { service.addReaction(messageId, AddReactionRequest(emoji)) }
    }

    suspend fun removeReaction(messageId: String, emoji: String) {
        val encoded = emoji.encodeUrl()
        runCatching { service.removeReaction(messageId, encoded) }
    }

    // MARK: - Upload

    suspend fun uploadFile(file: File, mimeType: String): UploadResult {
        val requestBody = file.asRequestBody(mimeType.toMediaType())
        val part = MultipartBody.Part.createFormData("file", file.name, requestBody)
        return service.uploadFile(part).unwrap()
    }

    private fun String.encodeUrl(): String =
        java.net.URLEncoder.encode(this, "UTF-8")
}

class ApiException(message: String) : Exception(message)
class UnauthorizedException : Exception("Unauthorized")
