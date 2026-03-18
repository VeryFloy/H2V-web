package com.example.h2v1test.ui.profile

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.h2v1test.AppState
import com.example.h2v1test.data.network.Config
import com.example.h2v1test.ui.components.AvatarView
import com.example.h2v1test.ui.components.GlassInputField
import com.example.h2v1test.ui.components.glassBackground
import com.example.h2v1test.ui.theme.H2VColors
import com.example.h2v1test.ui.theme.avatarColor
import kotlinx.coroutines.launch
import java.io.File

// MARK: - ViewModel

class ProfileViewModel(private val appState: AppState) : ViewModel() {
    var isUploading by mutableStateOf(false)
    var isSaving by mutableStateOf(false)
    var errorMsg by mutableStateOf<String?>(null)
    var editNickname by mutableStateOf("")
    var editBio by mutableStateOf("")

    init {
        val user = appState.currentUser
        editNickname = user?.nickname ?: ""
        editBio = user?.bio ?: ""
    }

    fun uploadAvatar(uri: Uri, context: android.content.Context) {
        viewModelScope.launch {
            isUploading = true
            try {
                val stream = context.contentResolver.openInputStream(uri) ?: return@launch
                val file = File.createTempFile("avatar", ".jpg", context.cacheDir)
                file.outputStream().use { stream.copyTo(it) }
                val result = appState.apiClient.uploadFile(file, "image/jpeg")
                file.delete()
                appState.apiClient.updateMe(nickname = null, bio = null, avatar = result.url)
                appState.refreshUser()
            } catch (e: Exception) {
                errorMsg = e.message
            } finally {
                isUploading = false
            }
        }
    }

    fun saveProfile() {
        viewModelScope.launch {
            isSaving = true
            try {
                appState.apiClient.updateMe(
                    nickname = editNickname.trim().takeIf { it.isNotBlank() },
                    bio = editBio.trim().takeIf { it.isNotBlank() },
                    avatar = null
                )
                appState.refreshUser()
            } catch (e: Exception) {
                errorMsg = e.message
            } finally {
                isSaving = false
            }
        }
    }

    fun deleteAccount() {
        viewModelScope.launch {
            try {
                appState.apiClient.deleteAccount()
                appState.signOut()
            } catch (_: Exception) {
                appState.signOut()
            }
        }
    }
}

// MARK: - ProfileScreen

@Composable
fun ProfileScreen(appState: AppState) {
    val vm = remember { ProfileViewModel(appState) }
    val user = appState.currentUser
    var showEditSheet by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val imagePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { vm.uploadAvatar(it, context) } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(H2VColors.AppBgDark)
            .verticalScroll(rememberScrollState())
    ) {
        Spacer(Modifier.height(20.dp))

        // Avatar section
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth().padding(24.dp)
        ) {
            Box(contentAlignment = Alignment.BottomEnd) {
                if (vm.isUploading) {
                    Box(
                        Modifier.size(90.dp).clip(CircleShape)
                            .background(H2VColors.GlassSurfaceDark),
                        Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            color = Color.White.copy(0.4f),
                            modifier = Modifier.size(32.dp)
                        )
                    }
                } else {
                    AvatarView(
                        url = user?.avatarUrl(Config.BASE_URL),
                        initials = user?.initials ?: "??",
                        size = 90.dp,
                        avatarColorOverride = user?.let { avatarColor(it.id) }
                    )
                }
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(
                            Brush.linearGradient(
                                listOf(H2VColors.GradientStart, H2VColors.GradientEnd)
                            )
                        )
                        .clickable(onClick = { imagePickerLauncher.launch("image/*") })
                ) {
                    Icon(
                        Icons.Default.CameraAlt,
                        null,
                        tint = Color.White,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            Text(
                text = user?.nickname ?: "",
                style = TextStyle(
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    letterSpacing = (-0.5).sp
                )
            )

            if (!user?.bio.isNullOrEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = user?.bio ?: "",
                    style = TextStyle(
                        fontSize = 14.sp,
                        color = H2VColors.TextSecondaryDark
                    )
                )
            }

            Spacer(Modifier.height(16.dp))

            // Edit profile button
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .glassBackground(cornerRadius = 12.dp, surfaceAlpha = 0.38f)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null
                    ) { showEditSheet = true }
                    .padding(horizontal = 24.dp, vertical = 10.dp)
            ) {
                Text(
                    "Редактировать профиль",
                    style = TextStyle(
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color.White.copy(0.8f)
                    )
                )
            }
        }

        // Settings section
        Spacer(Modifier.height(8.dp))
        SettingsSection(title = "Настройки") {
            SettingsRow(
                icon = Icons.Default.Notifications,
                title = "Уведомления",
                iconTint = Color(0xFFFF9F0A),
                onClick = {}
            )
            SettingsRow(
                icon = Icons.Default.Palette,
                title = "Оформление",
                iconTint = H2VColors.AccentBlue,
                onClick = {}
            )
            SettingsRow(
                icon = Icons.Default.Lock,
                title = "Конфиденциальность",
                iconTint = Color(0xFF30D158),
                onClick = {}
            )
            SettingsRow(
                icon = Icons.Default.Smartphone,
                title = "Устройства",
                iconTint = H2VColors.TextSecondaryDark,
                onClick = {}
            )
        }

        Spacer(Modifier.height(16.dp))

        SettingsSection(title = "Информация") {
            SettingsRow(
                icon = Icons.Default.Info,
                title = "О приложении",
                subtitle = "H2V v1.0.0",
                iconTint = H2VColors.TextSecondaryDark,
                onClick = {}
            )
        }

        Spacer(Modifier.height(16.dp))

        SettingsSection(title = "Аккаунт") {
            SettingsRow(
                icon = Icons.Default.ExitToApp,
                title = "Выйти",
                iconTint = H2VColors.DangerRed,
                titleColor = H2VColors.DangerRed,
                onClick = { appState.signOut() }
            )
            SettingsRow(
                icon = Icons.Default.Delete,
                title = "Удалить аккаунт",
                iconTint = H2VColors.DangerRed,
                titleColor = H2VColors.DangerRed,
                onClick = { showDeleteDialog = true }
            )
        }

        Spacer(Modifier.height(120.dp))
    }

    // Edit Profile Sheet
    if (showEditSheet) {
        EditProfileSheet(
            vm = vm,
            onDismiss = { showEditSheet = false }
        )
    }

    // Delete Account Dialog
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            containerColor = H2VColors.GlassSurfaceDark,
            title = {
                Text("Удалить аккаунт", color = Color.White, fontWeight = FontWeight.Bold)
            },
            text = {
                Text(
                    "Это действие необратимо. Все ваши данные будут удалены.",
                    color = H2VColors.TextSecondaryDark
                )
            },
            confirmButton = {
                TextButton(onClick = { showDeleteDialog = false; vm.deleteAccount() }) {
                    Text("Удалить", color = H2VColors.DangerRed, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("Отмена", color = H2VColors.TextSecondaryDark)
                }
            }
        )
    }
}

// MARK: - Settings Section

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 20.dp)) {
        Text(
            text = title.uppercase(),
            style = TextStyle(
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = H2VColors.TextTertiaryDark,
                letterSpacing = 0.9.sp
            ),
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 8.dp)
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .glassBackground(cornerRadius = 16.dp, surfaceAlpha = 0.38f)
        ) {
            content()
        }
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    iconTint: Color,
    titleColor: Color = H2VColors.TextPrimaryDark,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick
            )
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(iconTint.copy(alpha = 0.18f))
        ) {
            Icon(icon, null, tint = iconTint, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = TextStyle(fontSize = 15.sp, color = titleColor))
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = TextStyle(fontSize = 12.sp, color = H2VColors.TextTertiaryDark)
                )
            }
        }
        Icon(
            Icons.Default.ChevronRight,
            null,
            tint = H2VColors.TextTertiaryDark,
            modifier = Modifier.size(16.dp)
        )
    }
}

// MARK: - Edit Profile Sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditProfileSheet(vm: ProfileViewModel, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = H2VColors.GlassSurfaceDark,
        dragHandle = {
            Box(
                Modifier.padding(vertical = 12.dp)
                    .size(36.dp, 4.dp)
                    .background(Color.White.copy(0.2f), CircleShape)
            )
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    "Редактирование",
                    style = TextStyle(
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    ),
                    modifier = Modifier.weight(1f)
                )
                TextButton(
                    onClick = { vm.saveProfile(); onDismiss() },
                    enabled = !vm.isSaving
                ) {
                    if (vm.isSaving) {
                        CircularProgressIndicator(
                            color = H2VColors.AccentBlue,
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Сохранить", color = H2VColors.AccentBlue)
                    }
                }
            }

            GlassInputField(
                label = "Никнейм",
                value = vm.editNickname,
                onValueChange = { vm.editNickname = it },
                modifier = Modifier.fillMaxWidth()
            )

            GlassInputField(
                label = "О себе",
                value = vm.editBio,
                onValueChange = { vm.editBio = it },
                modifier = Modifier.fillMaxWidth()
            )

            vm.errorMsg?.let { err ->
                Text(
                    err,
                    style = TextStyle(fontSize = 13.sp, color = H2VColors.DangerRed)
                )
            }
        }
    }
}
