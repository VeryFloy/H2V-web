package com.example.h2v1test.data.network

import com.example.h2v1test.data.models.*
import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // MARK: - Auth
    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): Response<ApiResponse<AuthData>>

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<ApiResponse<AuthData>>

    @POST("api/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Response<ApiResponse<Tokens>>

    @POST("api/auth/logout")
    suspend fun logout(@Body body: LogoutRequest): Response<ApiResponse<Unit>>

    // MARK: - Users
    @GET("api/users/me")
    suspend fun getMe(): Response<ApiResponse<User>>

    @PATCH("api/users/me")
    suspend fun updateMe(@Body body: UpdateMeRequest): Response<ApiResponse<User>>

    @DELETE("api/users/me")
    suspend fun deleteAccount(): Response<ApiResponse<Unit>>

    @GET("api/users/search")
    suspend fun searchUsers(@Query("q") query: String): Response<ApiResponse<List<User>>>

    @GET("api/users/{id}")
    suspend fun getUser(@Path("id") id: String): Response<ApiResponse<User>>

    @POST("api/users/me/device-token")
    suspend fun addDeviceToken(@Body body: DeviceTokenRequest): Response<ApiResponse<Unit>>

    // MARK: - Chats
    @GET("api/chats")
    suspend fun getChats(
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 30
    ): Response<ApiResponse<ChatsData>>

    @POST("api/chats/direct")
    suspend fun createDirectChat(@Body body: CreateDirectChatRequest): Response<ApiResponse<Chat>>

    @POST("api/chats/group")
    suspend fun createGroupChat(@Body body: CreateGroupChatRequest): Response<ApiResponse<Chat>>

    @DELETE("api/chats/{id}/leave")
    suspend fun leaveChat(@Path("id") id: String): Response<ApiResponse<Unit>>

    // MARK: - Messages
    @GET("api/chats/{chatId}/messages")
    suspend fun getMessages(
        @Path("chatId") chatId: String,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 50
    ): Response<ApiResponse<MessagesData>>

    @DELETE("api/messages/{id}")
    suspend fun deleteMessage(@Path("id") id: String): Response<ApiResponse<Unit>>

    @PATCH("api/messages/{id}")
    suspend fun editMessage(
        @Path("id") id: String,
        @Body body: EditMessageRequest
    ): Response<ApiResponse<Message>>

    @POST("api/messages/{id}/read")
    suspend fun markRead(@Path("id") id: String): Response<ApiResponse<Unit>>

    @POST("api/messages/{id}/reactions")
    suspend fun addReaction(
        @Path("id") id: String,
        @Body body: AddReactionRequest
    ): Response<ApiResponse<Reaction>>

    @DELETE("api/messages/{id}/reactions/{emoji}")
    suspend fun removeReaction(
        @Path("id") id: String,
        @Path("emoji", encoded = true) emoji: String
    ): Response<ApiResponse<Unit>>

    // MARK: - Upload
    @Multipart
    @POST("api/upload")
    suspend fun uploadFile(@Part file: MultipartBody.Part): Response<ApiResponse<UploadResult>>

    // MARK: - Health
    @GET("api/health")
    suspend fun health(): Response<ApiResponse<Unit>>
}
