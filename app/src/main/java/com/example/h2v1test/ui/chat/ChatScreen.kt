package com.example.h2v1test.ui.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import com.example.h2v1test.AppState
import com.example.h2v1test.data.models.*
import com.example.h2v1test.data.network.Config
import com.example.h2v1test.ui.components.*
import com.example.h2v1test.ui.theme.H2VColors
import com.example.h2v1test.ui.theme.avatarColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import java.io.File

// MARK: - ViewModel

class ChatViewModel(
    private val chatId: String,
    private val appState: AppState
) : ViewModel() {
    var messages by mutableStateOf<List<Message>>(emptyList())
    var chat by mutableStateOf<Chat?>(null)
    var isLoading by mutableStateOf(false)
    var isUploading by mutableStateOf(false)
    var sendError by mutableStateOf<String?>(null)
    var hasMore by mutableStateOf(true)
    private var nextCursor: String? = null
    val typingUsers = mutableStateMapOf<String, String>()

    val typingLabel: String? get() {
        if (typingUsers.isEmpty()) return null
        val names = typingUsers.values.map { "@$it" }
        return when (names.size) {
            1 -> "${names[0]} печатает..."
            2 -> "${names[0]} и ${names[1]} печатают..."
            else -> "${names.size} человека печатают..."
        }
    }

    init {
        loadMessages(refresh = true)
        observeWsEvents()
    }

    fun loadMessages(refresh: Boolean = false) {
        if (isLoading) return
        if (refresh) { nextCursor = null; hasMore = true }
        if (!hasMore) return
        isLoading = true
        viewModelScope.launch {
            try {
                val data = appState.apiClient.getMessages(chatId, nextCursor, 50)
                val msgs = data.messages.reversed()
                messages = if (refresh) msgs else msgs + messages
                nextCursor = data.nextCursor
                hasMore = data.nextCursor != null
            } catch (_: Exception) {}
            isLoading = false
        }
    }

    fun sendText(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        sendError = null
        if (!appState.wsClient.isConnected) {
            sendError = "Нет подключения. Проверьте сеть."
            return
        }
        appState.wsClient.sendMessage(chatId = chatId, text = trimmed, type = "TEXT")
    }

    fun sendImage(uri: Uri, context: android.content.Context) {
        viewModelScope.launch {
            isUploading = true
            try {
                val stream = context.contentResolver.openInputStream(uri) ?: return@launch
                val file = File.createTempFile("upload", ".jpg", context.cacheDir)
                file.outputStream().use { stream.copyTo(it) }
                val result = appState.apiClient.uploadFile(file, "image/jpeg")
                file.delete()
                if (!appState.wsClient.isConnected) {
                    sendError = "Нет подключения. Проверьте сеть."
                    return@launch
                }
                appState.wsClient.sendMessage(
                    chatId = chatId,
                    text = result.url,
                    type = "IMAGE",
                    mediaUrl = result.url
                )
            } catch (e: Exception) {
                sendError = e.message
            } finally {
                isUploading = false
            }
        }
    }

    fun deleteMessage(id: String) {
        viewModelScope.launch {
            try {
                appState.apiClient.deleteMessage(id)
                messages = messages.filter { it.id != id }
            } catch (_: Exception) {}
        }
    }

    fun sendTypingStart() { appState.wsClient.typingStart(chatId) }
    fun sendTypingStop() { appState.wsClient.typingStop(chatId) }

    private fun observeWsEvents() {
        appState.wsClient.events.onEach { event ->
            handleEvent(event)
            appState.handlePresence(event)
        }.launchIn(viewModelScope)
    }

    private fun handleEvent(event: WSEvent) {
        when (event.type) {
            "message:new", "new_message" -> {
                val rawChatId = event.chatId ?: return
                if (rawChatId != chatId) return
                // Parse message from payload using gson
                val gson = com.google.gson.Gson()
                val json = gson.toJson(event.payload)
                val msg = try {
                    gson.fromJson(json, Message::class.java)
                } catch (_: Exception) { return }
                if (messages.none { it.id == msg.id }) {
                    messages = messages + msg
                }
            }
            "message:deleted", "message_deleted" -> {
                event.messageId?.let { id -> messages = messages.filter { it.id != id } }
            }
            "typing:started", "typing:start" -> {
                val uid = event.userId ?: return
                if (uid == appState.currentUser?.id) return
                if (event.chatId != chatId) return
                val nick = event.nickname ?: uid
                typingUsers[uid] = nick
                viewModelScope.launch {
                    delay(5000)
                    typingUsers.remove(uid)
                }
            }
            "typing:stopped", "typing:stop" -> {
                val uid = event.userId ?: return
                typingUsers.remove(uid)
            }
        }
    }
}

// MARK: - ChatScreen

@Composable
fun ChatScreen(
    chatId: String,
    appState: AppState,
    onBack: () -> Unit
) {
    val vm = remember { ChatViewModel(chatId, appState) }
    val currentUserId = appState.currentUser?.id ?: ""
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var typingTimer by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }

    val context = LocalContext.current
    val imagePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { vm.sendImage(it, context) } }

    // Найдём данные чата из сообщений (или передадим отдельно)
    val chat = remember { mutableStateOf<Chat?>(null) }
    LaunchedEffect(chatId) {
        try {
            chat.value = appState.apiClient.getChats(limit = 50).chats.firstOrNull { it.id == chatId }
        } catch (_: Exception) {}
    }

    val chatName = chat.value?.displayName(currentUserId) ?: ""
    val isGroup = chat.value?.type == "GROUP"
    val otherUser = chat.value?.otherUser(currentUserId)
    val isOnline = otherUser?.let { appState.onlineUserIds.containsKey(it.id) } ?: false

    // Auto-scroll on new message
    LaunchedEffect(vm.messages.size) {
        if (vm.messages.isNotEmpty()) {
            scope.launch { listState.animateScrollToItem(vm.messages.size - 1) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(H2VColors.AppBgDark)
    ) {
        // Header
        ChatHeader(
            chatName = chatName,
            isGroup = isGroup,
            isOnline = isOnline,
            otherUser = otherUser,
            chat = chat.value,
            currentUserId = currentUserId,
            typingLabel = vm.typingLabel,
            onBack = onBack
        )

        HorizontalDivider(color = H2VColors.GlassBorderDark)

        // Error banner
        AnimatedVisibility(
            visible = vm.sendError != null,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut()
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(H2VColors.DangerRed.copy(0.85f))
                    .padding(horizontal = 16.dp, vertical = 7.dp)
            ) {
                Icon(Icons.Default.CloudOff, null, tint = Color.White, modifier = Modifier.size(14.dp))
                Text(vm.sendError ?: "", style = TextStyle(color = Color.White, fontSize = 12.sp))
            }
        }

        // Messages
        Box(modifier = Modifier.weight(1f)) {
            if (vm.isLoading && vm.messages.isEmpty()) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = Color.White.copy(0.4f))
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    if (vm.hasMore) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(8.dp), Alignment.Center) {
                                CircularProgressIndicator(
                                    color = Color.White.copy(0.3f),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            LaunchedEffect(Unit) { vm.loadMessages() }
                        }
                    }

                    if (vm.messages.isNotEmpty()) {
                        item { DateSeparatorView("Сегодня") }
                    }

                    items(vm.messages, key = { it.id }) { msg ->
                        val isMe = msg.sender.id == currentUserId
                        val msgIdx = vm.messages.indexOf(msg)
                        val prevMsg = if (msgIdx > 0) vm.messages[msgIdx - 1] else null
                        val sameSender = prevMsg?.sender?.id == msg.sender.id

                        MessageBubbleView(
                            message = msg,
                            isMe = isMe,
                            sameSender = sameSender,
                            chatType = chat.value?.type ?: "DIRECT",
                            currentUserId = currentUserId,
                            onDelete = { vm.deleteMessage(msg.id) }
                        )
                        Spacer(Modifier.height(if (sameSender) 1.dp else 4.dp))
                    }

                    // Typing indicator
                    if (vm.typingLabel != null) {
                        item {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 4.dp)
                            ) {
                                TypingIndicatorView()
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    vm.typingLabel ?: "",
                                    style = TextStyle(
                                        fontSize = 12.sp,
                                        color = H2VColors.TextSecondaryDark
                                    ),
                                    maxLines = 1
                                )
                            }
                        }
                    }

                    item { Spacer(Modifier.height(8.dp)) }
                }
            }
        }

        HorizontalDivider(color = H2VColors.GlassBorderDark)

        // Input bar
        InputBar(
            text = inputText,
            isUploading = vm.isUploading,
            onTextChange = { new ->
                inputText = new
                if (new.isEmpty()) {
                    typingTimer?.cancel()
                    vm.sendTypingStop()
                } else {
                    vm.sendTypingStart()
                    typingTimer?.cancel()
                    typingTimer = scope.launch {
                        delay(3000)
                        vm.sendTypingStop()
                    }
                }
            },
            onSend = {
                val t = inputText
                inputText = ""
                typingTimer?.cancel()
                vm.sendTypingStop()
                vm.sendText(t)
            },
            onAttach = { imagePickerLauncher.launch("image/*") }
        )
    }
}

// MARK: - Chat Header

@Composable
private fun ChatHeader(
    chatName: String,
    isGroup: Boolean,
    isOnline: Boolean,
    otherUser: com.example.h2v1test.data.models.User?,
    chat: Chat?,
    currentUserId: String,
    typingLabel: String?,
    onBack: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        // Back button
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(36.dp)
                .glassBackground(cornerRadius = 18.dp, surfaceAlpha = 0.45f)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { onBack() }
        ) {
            Icon(
                Icons.Default.ArrowBack,
                contentDescription = "Назад",
                tint = H2VColors.TextSecondaryDark,
                modifier = Modifier.size(18.dp)
            )
        }

        Spacer(Modifier.width(10.dp))

        // Avatar
        if (isGroup && chat != null) {
            val color = avatarColor(chat.id)
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(color.copy(0.18f))
            ) {
                Icon(Icons.Default.People, null, tint = color, modifier = Modifier.size(16.dp))
            }
        } else if (otherUser != null) {
            AvatarView(
                url = otherUser.avatarUrl(Config.BASE_URL),
                initials = otherUser.initials,
                size = 38.dp,
                isOnline = isOnline,
                avatarColorOverride = chat?.let { avatarColor(it.id) }
            )
        }

        Spacer(Modifier.width(10.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = chatName,
                style = TextStyle(
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = H2VColors.TextPrimaryDark,
                    letterSpacing = (-0.2).sp
                ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            val subtitle = when {
                typingLabel != null -> typingLabel
                isGroup -> {
                    val count = chat?.members?.size ?: 0
                    "$count ${
                        when {
                            count == 1 -> "участник"
                            count < 5 -> "участника"
                            else -> "участников"
                        }
                    }"
                }
                isOnline -> "онлайн"
                otherUser != null -> "@${otherUser.nickname}"
                else -> ""
            }
            Text(
                text = subtitle,
                style = TextStyle(
                    fontSize = 12.sp,
                    color = if (typingLabel != null || isOnline) H2VColors.OnlineGreen
                            else H2VColors.AccentBlue.copy(0.7f)
                )
            )
        }

        // Action button
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(34.dp)
                .glassBackground(cornerRadius = 17.dp, surfaceAlpha = 0.38f)
        ) {
            Icon(
                if (isGroup) Icons.Default.Info else Icons.Default.Phone,
                contentDescription = null,
                tint = H2VColors.TextTertiaryDark,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

// MARK: - Input Bar

@Composable
private fun InputBar(
    text: String,
    isUploading: Boolean,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttach: () -> Unit
) {
    val hasText = text.trim().isNotEmpty()

    Row(
        verticalAlignment = Alignment.Bottom,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(top = 10.dp, bottom = 20.dp)
    ) {
        // Photo button
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(36.dp)
                .glassBackground(cornerRadius = 18.dp, surfaceAlpha = 0.38f)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = !isUploading
                ) { onAttach() }
        ) {
            if (isUploading) {
                CircularProgressIndicator(
                    color = Color.White.copy(0.4f),
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    Icons.Default.PhotoCamera,
                    null,
                    tint = Color.White.copy(if (isUploading) 0.2f else 0.4f),
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        Spacer(Modifier.width(8.dp))

        // Text field
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            maxLines = 5,
            textStyle = TextStyle(color = Color.White, fontSize = 15.sp),
            cursorBrush = SolidColor(Color.White),
            decorationBox = { inner ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .glassBackground(cornerRadius = 22.dp, surfaceAlpha = 0.38f)
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        if (text.isEmpty()) {
                            Text(
                                "Написать...",
                                style = TextStyle(
                                    color = Color.White.copy(0.22f),
                                    fontSize = 15.sp
                                )
                            )
                        }
                        inner()
                    }
                }
            },
            modifier = Modifier.weight(1f)
        )

        Spacer(Modifier.width(8.dp))

        // Send button
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (hasText) Color.White.copy(0.92f) else Color.White.copy(0.08f))
                .border(
                    0.5.dp,
                    if (hasText) Color.Transparent else Color.White.copy(0.12f),
                    CircleShape
                )
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = hasText
                ) { onSend() }
        ) {
            Icon(
                Icons.Default.Send,
                contentDescription = "Отправить",
                tint = if (hasText) Color.Black else Color.White.copy(0.25f),
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

// MARK: - Message Bubble

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubbleView(
    message: Message,
    isMe: Boolean,
    sameSender: Boolean,
    chatType: String,
    currentUserId: String,
    onDelete: () -> Unit
) {
    val isGroup = chatType == "GROUP"
    val showSenderName = isGroup && !isMe && !sameSender
    val clipboard = LocalClipboardManager.current
    var showMenu by remember { mutableStateOf(false) }

    val r = if (sameSender) 14.dp else 18.dp
    val myShape = RoundedCornerShape(
        topStart = r, topEnd = r,
        bottomStart = r, bottomEnd = 4.dp
    )
    val theirShape = RoundedCornerShape(
        topStart = r, topEnd = r,
        bottomStart = 4.dp, bottomEnd = r
    )
    val bubbleShape = if (isMe) myShape else theirShape

    Row(
        horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (isMe) Spacer(Modifier.weight(1f))

        Box {
            Column(
                horizontalAlignment = if (isMe) Alignment.End else Alignment.Start,
                modifier = Modifier.combinedClickable(
                    onClick = {},
                    onLongClick = { showMenu = true }
                )
            ) {
                // Sender name (group)
                if (showSenderName) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 4.dp, bottom = 2.dp)
                    ) {
                        AvatarView(
                            url = message.sender.avatarUrl(Config.BASE_URL),
                            initials = message.sender.nickname.take(2).uppercase(),
                            size = 18.dp,
                            avatarColorOverride = avatarColor(message.sender.id)
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            "@${message.sender.nickname}",
                            style = TextStyle(
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = avatarColor(message.sender.id)
                            )
                        )
                    }
                }

                // Bubble content
                when (message.messageType) {
                    MsgType.IMAGE -> ImageBubble(message, isMe, bubbleShape)
                    else -> TextBubble(message, isMe, bubbleShape)
                }

                // Time + read status
                Row(
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                ) {
                    Text(
                        MessageTime.shortTime(message.createdAt),
                        style = TextStyle(fontSize = 11.sp, color = Color.White.copy(0.2f))
                    )
                    if (isMe) {
                        val isRead = !(message.readReceipts?.isEmpty() ?: true)
                        Icon(
                            if (isRead) Icons.Default.DoneAll else Icons.Default.Done,
                            null,
                            tint = Color.White.copy(0.3f),
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }
            }

            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false },
                modifier = Modifier.background(H2VColors.GlassSurfaceDark)
            ) {
                DropdownMenuItem(
                    text = { Text("Копировать", color = Color.White) },
                    leadingIcon = { Icon(Icons.Default.ContentCopy, null, tint = Color.White) },
                    onClick = {
                        showMenu = false
                        clipboard.setText(AnnotatedString(message.text ?: ""))
                    }
                )
                if (isMe) {
                    DropdownMenuItem(
                        text = { Text("Удалить", color = H2VColors.DangerRed) },
                        leadingIcon = { Icon(Icons.Default.Delete, null, tint = H2VColors.DangerRed) },
                        onClick = { showMenu = false; onDelete() }
                    )
                }
            }
        }

        if (!isMe) Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun TextBubble(message: Message, isMe: Boolean, shape: RoundedCornerShape) {
    Box(
        modifier = Modifier
            .clip(shape)
            .background(
                if (isMe) H2VColors.BubbleMeDark else H2VColors.BubbleThemDark
            )
            .border(1.dp, H2VColors.GlassBorderDark.copy(if (isMe) 1f else 0.6f), shape)
            .padding(horizontal = 13.dp, vertical = 9.dp)
    ) {
        Text(
            text = if (message.isDeleted == true) "Сообщение удалено" else (message.text ?: ""),
            style = TextStyle(
                fontSize = 15.sp,
                color = if (message.isDeleted == true) H2VColors.TextTertiaryDark
                        else H2VColors.TextPrimaryDark,
                letterSpacing = (-0.1).sp,
                lineHeight = 20.sp
            )
        )
    }
}

@Composable
private fun ImageBubble(message: Message, isMe: Boolean, shape: RoundedCornerShape) {
    val url = message.mediaFullUrl(Config.BASE_URL)
    Box(
        modifier = Modifier
            .size(220.dp, 280.dp)
            .clip(shape)
    ) {
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = "Фото",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(if (isMe) H2VColors.BubbleMeDark else H2VColors.BubbleThemDark),
                Alignment.Center
            ) {
                Icon(Icons.Default.BrokenImage, null, tint = Color.White.copy(0.3f))
            }
        }
    }
}
