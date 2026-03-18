package com.example.h2v1test.data.models

import com.google.gson.annotations.SerializedName

// MARK: - API Response

data class ApiResponse<T>(
    val success: Boolean,
    val data: T?,
    val message: String?
)

// MARK: - Auth

data class AuthData(
    val user: User,
    val tokens: Tokens
)

data class Tokens(
    val accessToken: String,
    val refreshToken: String
)

// MARK: - User

data class User(
    val id: String,
    val nickname: String,
    val avatar: String?,
    val bio: String?,
    val lastOnline: String?,
    val isOnline: Boolean?
) {
    val initials: String get() {
        val parts = nickname.split("_").take(2)
        return if (parts.isEmpty()) nickname.take(2).uppercase()
        else parts.joinToString("") { it.take(1).uppercase() }
    }

    fun avatarUrl(baseUrl: String): String? {
        if (avatar.isNullOrEmpty()) return null
        return if (avatar.startsWith("http")) avatar else "$baseUrl$avatar"
    }
}

// MARK: - Chat

data class Chat(
    val id: String,
    val type: String,
    val name: String?,
    val avatar: String?,
    val description: String?,
    val createdAt: String,
    val updatedAt: String,
    val members: List<ChatMember>,
    val messages: List<Message>?
) {
    val lastMessage: Message? get() = messages?.firstOrNull()

    fun displayName(currentUserId: String): String {
        if (type == "GROUP") return name ?: "Группа"
        return members.firstOrNull { it.userId != currentUserId }?.user?.nickname ?: "Чат"
    }

    fun otherUser(currentUserId: String): User? =
        members.firstOrNull { it.userId != currentUserId }?.user

    fun chatAvatarUrl(currentUserId: String, baseUrl: String): String? {
        return if (type == "GROUP") {
            avatar?.let { if (it.startsWith("http")) it else "$baseUrl$it" }
        } else {
            otherUser(currentUserId)?.avatarUrl(baseUrl)
        }
    }

    fun chatInitials(currentUserId: String): String {
        return if (type == "GROUP") name?.take(2)?.uppercase() ?: "GR"
        else otherUser(currentUserId)?.initials ?: "??"
    }
}

data class ChatMember(
    val id: String,
    val chatId: String,
    val userId: String,
    val role: String,
    val joinedAt: String,
    val user: User
)

data class ChatsData(
    val chats: List<Chat>,
    val nextCursor: String?
)

// MARK: - Message

data class Message(
    val id: String,
    val chatId: String?,
    val text: String?,
    val ciphertext: String?,
    val signalType: Int?,
    val type: String?,
    val mediaUrl: String?,
    val replyToId: String?,
    val isEdited: Boolean?,
    val isDeleted: Boolean?,
    val createdAt: String,
    val updatedAt: String?,
    val sender: MessageSender,
    val readReceipts: List<ReadReceipt>?,
    val reactions: List<Reaction>?,
    val replyTo: ReplyTo?
) {
    val messageType: MsgType get() = MsgType.fromString(type ?: "TEXT")

    fun mediaFullUrl(baseUrl: String): String? {
        if (mediaUrl.isNullOrEmpty()) return null
        return if (mediaUrl.startsWith("http")) mediaUrl else "$baseUrl$mediaUrl"
    }
}

enum class MsgType {
    TEXT, IMAGE, FILE, AUDIO, VIDEO, SYSTEM;
    companion object {
        fun fromString(s: String) = values().firstOrNull { it.name == s } ?: TEXT
    }
}

data class MessagesData(
    val messages: List<Message>,
    val nextCursor: String?
)

data class MessageSender(
    val id: String,
    val nickname: String,
    val avatar: String?
) {
    fun avatarUrl(baseUrl: String): String? {
        if (avatar.isNullOrEmpty()) return null
        return if (avatar.startsWith("http")) avatar else "$baseUrl$avatar"
    }
}

data class ReadReceipt(
    val userId: String,
    val readAt: String
)

data class Reaction(
    val id: String,
    val userId: String,
    val emoji: String
)

data class ReplyTo(
    val id: String,
    val text: String?,
    val isDeleted: Boolean?,
    val sender: MessageSender
)

// MARK: - Upload

data class UploadResult(
    val url: String,
    val type: String,
    val name: String,
    val size: Int
)

// MARK: - Request Bodies

data class LoginRequest(val email: String, val password: String)
data class RegisterRequest(val nickname: String, val email: String, val password: String)
data class RefreshRequest(val refreshToken: String)
data class LogoutRequest(val refreshToken: String)
data class UpdateMeRequest(val nickname: String?, val bio: String?, val avatar: String?)
data class CreateDirectChatRequest(val targetUserId: String)
data class CreateGroupChatRequest(val name: String, val memberIds: List<String>)
data class SendMessageRequest(
    val chatId: String,
    val text: String,
    val type: String = "TEXT",
    val mediaUrl: String? = null,
    val replyToId: String? = null,
    val signalType: Int = 0
)
data class EditMessageRequest(val text: String)
data class AddReactionRequest(val emoji: String)
data class DeviceTokenRequest(val token: String, val platform: String = "android")

// MARK: - WebSocket Event

data class WSEvent(
    val type: String,
    val payload: Map<String, Any?>
) {
    val chatId: String? get() = payload["chatId"] as? String
    val userId: String? get() = payload["userId"] as? String
    val messageId: String? get() = payload["messageId"] as? String
    val nickname: String? get() = payload["nickname"] as? String
}
