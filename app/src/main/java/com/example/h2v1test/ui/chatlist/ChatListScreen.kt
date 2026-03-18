package com.example.h2v1test.ui.chatlist

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.h2v1test.AppState
import com.example.h2v1test.data.models.Chat
import com.example.h2v1test.data.models.MsgType
import com.example.h2v1test.data.models.User
import com.example.h2v1test.data.models.WSEvent
import com.example.h2v1test.data.network.Config
import com.example.h2v1test.ui.components.*
import com.example.h2v1test.ui.theme.H2VColors
import com.example.h2v1test.ui.theme.avatarColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

// MARK: - ViewModel

class ChatListViewModel(private val appState: AppState) : ViewModel() {
    var chats by mutableStateOf<List<Chat>>(emptyList())
    var isLoading by mutableStateOf(false)
    var hasMore by mutableStateOf(true)
    private var nextCursor: String? = null
    val typingPerChat = mutableStateMapOf<String, Map<String, String>>()
    val mutedChats = mutableStateOf<Set<String>>(emptySet())

    init {
        loadChats(refresh = true)
        observeWsEvents()
    }

    fun loadChats(refresh: Boolean = false) {
        if (isLoading) return
        if (refresh) { nextCursor = null; hasMore = true }
        if (!hasMore) return
        isLoading = true
        viewModelScope.launch {
            try {
                val result = appState.apiClient.getChats(cursor = nextCursor, limit = 30)
                chats = if (refresh) result.chats else chats + result.chats
                nextCursor = result.nextCursor
                hasMore = result.nextCursor != null
            } catch (_: Exception) {}
            isLoading = false
        }
    }

    fun loadMore() {
        if (hasMore && !isLoading) loadChats()
    }

    fun leaveChat(chatId: String) {
        viewModelScope.launch {
            appState.apiClient.leaveChat(chatId)
            chats = chats.filter { it.id != chatId }
        }
    }

    fun toggleMute(chatId: String) {
        val current = mutedChats.value
        mutedChats.value = if (chatId in current) current - chatId else current + chatId
    }

    fun typingLabel(chatId: String): String? {
        val typers = typingPerChat[chatId] ?: return null
        if (typers.isEmpty()) return null
        val names = typers.values.toList()
        return when (names.size) {
            1 -> "${names[0]} печатает..."
            2 -> "${names[0]} и ${names[1]} печатают..."
            else -> "${names.size} печатают..."
        }
    }

    private fun observeWsEvents() {
        appState.wsClient.events.onEach { event ->
            handleWSEvent(event)
            appState.handlePresence(event)
        }.launchIn(viewModelScope)
    }

    private fun handleWSEvent(event: WSEvent) {
        when (event.type) {
            "message:new", "new_message" -> {
                val chatId = event.chatId ?: return
                val idx = chats.indexOfFirst { it.id == chatId }
                if (idx >= 0) {
                    val updated = chats[idx]
                    val newList = chats.toMutableList()
                    newList.removeAt(idx)
                    newList.add(0, updated)
                    chats = newList
                }
                // Clear typing for this sender
                event.userId?.let { uid ->
                    typingPerChat[chatId] = (typingPerChat[chatId] ?: emptyMap()) - uid
                }
            }
            "typing:started", "typing:start" -> {
                val uid = event.userId ?: return
                val cid = event.chatId ?: return
                if (uid == appState.currentUser?.id) return
                val nick = event.nickname
                    ?: chats.firstOrNull { it.id == cid }
                        ?.members?.firstOrNull { it.userId == uid }?.user?.nickname
                    ?: "..."
                val current = typingPerChat[cid]?.toMutableMap() ?: mutableMapOf()
                current[uid] = nick
                typingPerChat[cid] = current
                viewModelScope.launch {
                    delay(5000)
                    val cur = typingPerChat[cid]?.toMutableMap() ?: return@launch
                    cur.remove(uid)
                    typingPerChat[cid] = cur
                }
            }
            "typing:stopped", "typing:stop" -> {
                val uid = event.userId ?: return
                val cid = event.chatId ?: return
                val cur = typingPerChat[cid]?.toMutableMap() ?: return
                cur.remove(uid)
                typingPerChat[cid] = cur
            }
        }
    }
}

// MARK: - ChatListScreen

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatListScreen(
    appState: AppState,
    onNavigateToChat: (String) -> Unit,
    onHideTabBar: () -> Unit,
    onShowTabBar: () -> Unit
) {
    val vm = remember { ChatListViewModel(appState) }
    var searchText by remember { mutableStateOf("") }
    var showNewChat by remember { mutableStateOf(false) }
    var showNewGroup by remember { mutableStateOf(false) }
    val currentUserId = appState.currentUser?.id ?: ""

    val filtered = remember(vm.chats, searchText, currentUserId) {
        if (searchText.isEmpty()) vm.chats
        else vm.chats.filter {
            it.displayName(currentUserId).contains(searchText, ignoreCase = true)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(H2VColors.AppBgDark)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header
            Row(
                verticalAlignment = Alignment.Bottom,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 18.dp)
                    .padding(bottom = 14.dp)
            ) {
                Text(
                    text = "Сообщения",
                    style = TextStyle(
                        fontSize = 30.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        letterSpacing = (-0.8).sp
                    )
                )
                Spacer(Modifier.weight(1f))
                // New chat menu
                var menuExpanded by remember { mutableStateOf(false) }
                Box {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(38.dp)
                            .glassBackground(cornerRadius = 19.dp, surfaceAlpha = 0.45f)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null
                            ) { menuExpanded = true }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = "Новый чат",
                            tint = H2VColors.TextSecondaryDark,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                        modifier = Modifier.background(H2VColors.GlassSurfaceDark)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Личный чат", color = Color.White) },
                            leadingIcon = {
                                Icon(Icons.Default.Person, null, tint = H2VColors.AccentBlue)
                            },
                            onClick = { menuExpanded = false; showNewChat = true }
                        )
                        DropdownMenuItem(
                            text = { Text("Создать группу", color = Color.White) },
                            leadingIcon = {
                                Icon(Icons.Default.People, null, tint = H2VColors.AccentBlue)
                            },
                            onClick = { menuExpanded = false; showNewGroup = true }
                        )
                    }
                }
            }

            // Search bar
            GlassSearchBar(
                value = searchText,
                onValueChange = { searchText = it },
                placeholder = "Поиск",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 10.dp)
            )

            // List
            if (vm.isLoading && vm.chats.isEmpty()) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = Color.White.copy(0.4f))
                }
            } else if (vm.chats.isEmpty()) {
                EmptyState()
            } else {
                val listState = rememberLazyListState()
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(filtered, key = { it.id }) { chat ->
                        val otherUser = chat.otherUser(currentUserId)
                        val isOnline = otherUser?.let { appState.onlineUserIds.containsKey(it.id) } ?: false
                        val isMuted = chat.id in vm.mutedChats.value
                        val typingLabel = vm.typingLabel(chat.id)

                        ChatRowView(
                            chat = chat,
                            currentUserId = currentUserId,
                            isOnline = isOnline,
                            isMuted = isMuted,
                            typingLabel = typingLabel,
                            onTap = { onNavigateToChat(chat.id) },
                            onMute = { vm.toggleMute(chat.id) },
                            onLeave = { vm.leaveChat(chat.id) }
                        )

                        HorizontalDivider(
                            color = Color.White.copy(alpha = 0.04f),
                            modifier = Modifier.padding(start = 72.dp)
                        )
                    }

                    if (vm.hasMore) {
                        item {
                            Box(
                                Modifier.fillMaxWidth().padding(16.dp),
                                Alignment.Center
                            ) {
                                CircularProgressIndicator(
                                    color = Color.White.copy(0.3f),
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                            LaunchedEffect(Unit) { vm.loadMore() }
                        }
                    }

                    item { Spacer(Modifier.height(100.dp)) }
                }
            }
        }
    }

    // New Chat Sheet
    if (showNewChat) {
        NewChatSheet(
            appState = appState,
            onDismiss = { showNewChat = false },
            onCreated = { chatId ->
                showNewChat = false
                onNavigateToChat(chatId)
            }
        )
    }

    // New Group Sheet
    if (showNewGroup) {
        NewGroupSheet(
            appState = appState,
            onDismiss = { showNewGroup = false },
            onCreated = { chatId ->
                showNewGroup = false
                onNavigateToChat(chatId)
            }
        )
    }
}

// MARK: - ChatRowView

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatRowView(
    chat: Chat,
    currentUserId: String,
    isOnline: Boolean,
    isMuted: Boolean,
    typingLabel: String?,
    onTap: () -> Unit,
    onMute: () -> Unit,
    onLeave: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }
    val isGroup = chat.type == "GROUP"
    val color = avatarColor(chat.id)

    val lastMsgText = remember(chat.lastMessage) {
        val m = chat.lastMessage
            ?: return@remember if (isGroup) "Группа создана" else "Начните переписку"
        when (m.messageType) {
            MsgType.IMAGE -> "📷 Фото"
            MsgType.FILE -> "📎 Файл"
            else -> {
                val prefix = if (isGroup) "${m.sender.nickname}: " else ""
                prefix + (m.text ?: "")
            }
        }
    }

    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onTap,
                    onLongClick = { showMenu = true }
                )
                .padding(horizontal = 20.dp, vertical = 9.dp)
        ) {
            // Avatar
            if (isGroup) {
                GroupChatAvatar(chatId = chat.id, size = 50.dp, color = color)
            } else {
                AvatarView(
                    url = chat.chatAvatarUrl(currentUserId, Config.BASE_URL),
                    initials = chat.chatInitials(currentUserId),
                    size = 50.dp,
                    isOnline = isOnline,
                    avatarColorOverride = color
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                // Name row
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            text = chat.displayName(currentUserId),
                            style = TextStyle(
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = H2VColors.TextPrimaryDark,
                                letterSpacing = (-0.2).sp
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (isGroup) {
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                Icons.Default.People,
                                null,
                                tint = H2VColors.AccentBlue.copy(0.7f),
                                modifier = Modifier.size(11.dp)
                            )
                        }
                        if (isMuted) {
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                Icons.Default.NotificationsOff,
                                null,
                                tint = H2VColors.TextTertiaryDark,
                                modifier = Modifier.size(10.dp)
                            )
                        }
                    }
                    Text(
                        text = chat.lastMessage?.let { MessageTime.rowTime(it.createdAt) } ?: "",
                        style = TextStyle(fontSize = 11.sp, color = H2VColors.TextTertiaryDark)
                    )
                }

                Spacer(Modifier.height(2.dp))

                // Subtitle row
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = typingLabel ?: lastMsgText,
                        style = TextStyle(
                            fontSize = 14.sp,
                            color = if (typingLabel != null) H2VColors.OnlineGreen
                                    else H2VColors.TextSecondaryDark,
                            fontWeight = if (typingLabel != null) FontWeight.Medium
                                         else FontWeight.Normal
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
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
                text = {
                    Text(if (isMuted) "Включить звук" else "Заглушить", color = Color.White)
                },
                leadingIcon = {
                    Icon(
                        if (isMuted) Icons.Default.Notifications else Icons.Default.NotificationsOff,
                        null,
                        tint = if (isMuted) H2VColors.OnlineGreen else Color(0xFFFF9500)
                    )
                },
                onClick = { showMenu = false; onMute() }
            )
            DropdownMenuItem(
                text = { Text("Покинуть чат", color = H2VColors.DangerRed) },
                leadingIcon = { Icon(Icons.Default.ExitToApp, null, tint = H2VColors.DangerRed) },
                onClick = { showMenu = false; onLeave() }
            )
        }
    }
}

@Composable
private fun GroupChatAvatar(chatId: String, size: Dp, color: Color) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(color.copy(alpha = 0.18f))
    ) {
        Icon(
            imageVector = Icons.Default.People,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(size * 0.4f)
        )
    }
}

@Composable
private fun EmptyState() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(40.dp)
    ) {
        Icon(
            Icons.Outlined.ChatBubbleOutline,
            contentDescription = null,
            tint = Color.White.copy(0.12f),
            modifier = Modifier.size(64.dp)
        )
        Spacer(Modifier.height(14.dp))
        Text(
            "Нет чатов",
            style = TextStyle(
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White.copy(0.25f)
            )
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Нажмите ✏ чтобы начать переписку",
            style = TextStyle(fontSize = 14.sp, color = Color.White.copy(0.15f)),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
    }
}

// MARK: - New Chat Sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatSheet(
    appState: AppState,
    onDismiss: () -> Unit,
    onCreated: (String) -> Unit
) {
    var searchText by remember { mutableStateOf("") }
    var users by remember { mutableStateOf<List<User>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val currentUserId = appState.currentUser?.id ?: ""

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = H2VColors.GlassSurfaceDark,
        dragHandle = {
            Box(
                Modifier
                    .padding(vertical = 12.dp)
                    .size(36.dp, 4.dp)
                    .background(Color.White.copy(0.2f), CircleShape)
            )
        }
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 40.dp)) {
            Text(
                "Новый чат",
                style = TextStyle(
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White
                ),
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 12.dp)
            )
            GlassSearchBar(
                value = searchText,
                onValueChange = {
                    searchText = it
                    if (it.length >= 2) {
                        scope.launch {
                            isLoading = true
                            users = try {
                                appState.apiClient.searchUsers(it)
                                    .filter { u -> u.id != currentUserId }
                            } catch (_: Exception) { emptyList() }
                            isLoading = false
                        }
                    } else {
                        users = emptyList()
                    }
                },
                placeholder = "Найти пользователя",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 8.dp)
            )
            if (isLoading) {
                Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
                    CircularProgressIndicator(color = Color.White.copy(0.4f), modifier = Modifier.size(24.dp))
                }
            } else {
                users.forEach { user ->
                    UserSearchRow(
                        user = user,
                        onClick = {
                            scope.launch {
                                try {
                                    val chat = appState.apiClient.createDirectChat(user.id)
                                    onCreated(chat.id)
                                } catch (_: Exception) {}
                            }
                        }
                    )
                    HorizontalDivider(
                        color = Color.White.copy(0.05f),
                        modifier = Modifier.padding(start = 68.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun UserSearchRow(user: User, isSelected: Boolean = false, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 10.dp)
    ) {
        AvatarView(
            url = user.avatarUrl(Config.BASE_URL),
            initials = user.initials,
            size = 44.dp,
            isOnline = user.isOnline ?: false,
            avatarColorOverride = avatarColor(user.id)
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = user.nickname,
                style = TextStyle(
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = H2VColors.TextPrimaryDark
                )
            )
            Text(
                text = "@${user.nickname}",
                style = TextStyle(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = H2VColors.AccentBlue.copy(0.8f)
                )
            )
            if (!user.bio.isNullOrEmpty()) {
                Text(
                    text = user.bio,
                    style = TextStyle(fontSize = 12.sp, color = H2VColors.TextSecondaryDark),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (isSelected) {
            Icon(
                Icons.Default.CheckCircle,
                null,
                tint = H2VColors.AccentBlue,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

// MARK: - New Group Sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewGroupSheet(
    appState: AppState,
    onDismiss: () -> Unit,
    onCreated: (String) -> Unit
) {
    var groupName by remember { mutableStateOf("") }
    var searchText by remember { mutableStateOf("") }
    var users by remember { mutableStateOf<List<User>>(emptyList()) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var isLoading by remember { mutableStateOf(false) }
    var isCreating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val currentUserId = appState.currentUser?.id ?: ""

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = H2VColors.GlassSurfaceDark,
        dragHandle = {
            Box(
                Modifier
                    .padding(vertical = 12.dp)
                    .size(36.dp, 4.dp)
                    .background(Color.White.copy(0.2f), CircleShape)
            )
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 40.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Text(
                    "Новая группа",
                    style = TextStyle(
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    ),
                    modifier = Modifier.weight(1f)
                )
                if (groupName.isNotBlank() && selectedIds.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                isCreating = true
                                try {
                                    val chat = appState.apiClient.createGroupChat(
                                        groupName.trim(),
                                        selectedIds.toList()
                                    )
                                    onCreated(chat.id)
                                } catch (_: Exception) {}
                                isCreating = false
                            }
                        }
                    ) {
                        Text(
                            if (isCreating) "..." else "Создать",
                            color = H2VColors.AccentBlue
                        )
                    }
                }
            }

            GlassInputField(
                label = "Название группы",
                value = groupName,
                onValueChange = { groupName = it },
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
            )

            GlassSearchBar(
                value = searchText,
                onValueChange = {
                    searchText = it
                    if (it.length >= 2) {
                        scope.launch {
                            isLoading = true
                            users = try {
                                appState.apiClient.searchUsers(it)
                                    .filter { u -> u.id != currentUserId }
                            } catch (_: Exception) { emptyList() }
                            isLoading = false
                        }
                    } else {
                        users = emptyList()
                    }
                },
                placeholder = "Добавить участников",
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
            )

            users.forEach { user ->
                UserSearchRow(
                    user = user,
                    isSelected = user.id in selectedIds,
                    onClick = {
                        selectedIds = if (user.id in selectedIds)
                            selectedIds - user.id else selectedIds + user.id
                    }
                )
            }
        }
    }
}
