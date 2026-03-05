package com.example.h2v1test.ui.auth

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.h2v1test.AppState
import com.example.h2v1test.data.network.ApiException
import com.example.h2v1test.ui.components.GlassInputField
import com.example.h2v1test.ui.components.liquidGlass
import com.example.h2v1test.ui.theme.H2VColors
import kotlinx.coroutines.launch

// MARK: - ViewModel

class AuthViewModel(private val appState: AppState) : ViewModel() {
    var isLogin by mutableStateOf(true)
    var email by mutableStateOf("")
    var password by mutableStateOf("")
    var nickname by mutableStateOf("")
    var isLoading by mutableStateOf(false)
    var errorMsg by mutableStateOf<String?>(null)

    val canSubmit: Boolean
        get() = email.isNotBlank() && password.isNotBlank() && (isLogin || nickname.isNotBlank())

    fun submit(onSuccess: () -> Unit) {
        if (!canSubmit || isLoading) return
        isLoading = true
        errorMsg = null
        viewModelScope.launch {
            try {
                val data = if (isLogin) {
                    appState.apiClient.login(email.trim(), password)
                } else {
                    appState.apiClient.register(nickname.trim(), email.trim(), password)
                }
                appState.signIn(data.user, data.tokens.accessToken, data.tokens.refreshToken)
                onSuccess()
            } catch (e: ApiException) {
                errorMsg = e.message
            } catch (e: Exception) {
                errorMsg = e.message ?: "Ошибка сети"
            } finally {
                isLoading = false
            }
        }
    }
}

// MARK: - AuthScreen

@Composable
fun AuthScreen(appState: AppState, onSuccess: () -> Unit) {
    val vm = remember { AuthViewModel(appState) }

    val infiniteTransition = rememberInfiniteTransition(label = "bg")
    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.06f,
        targetValue = 0.13f,
        animationSpec = infiniteRepeatable(
            animation = tween(3000, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(H2VColors.AppBgDark)
    ) {
        // Animated top gradient glow — vertical gradient (no radial to avoid NaN radius)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(420.dp)
                .background(
                    Brush.verticalGradient(
                        listOf(
                            H2VColors.GradientMid.copy(alpha = glowAlpha),
                            H2VColors.GradientEnd.copy(alpha = glowAlpha * 0.3f),
                            Color.Transparent
                        )
                    )
                )
        )

        // Bottom gradient glow
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp)
                .align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, H2VColors.GradientStart.copy(0.04f))
                    )
                )
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(horizontal = 24.dp)
                .padding(bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(72.dp))
            LogoSection(isLogin = vm.isLogin)
            Spacer(Modifier.height(52.dp))
            FormSection(vm = vm, onSuccess = onSuccess)
        }
    }
}

@Composable
private fun LogoSection(isLogin: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "logo")
    val logoGlow by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 0.8f,
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "logoGlow"
    )

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        // Logo with glow effect
        Box(contentAlignment = Alignment.Center) {
            // Outer glow ring — use verticalGradient to avoid RadialGradient crash
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                H2VColors.GradientMid.copy(alpha = logoGlow * 0.35f),
                                H2VColors.GradientEnd.copy(alpha = logoGlow * 0.12f),
                                Color.Transparent
                            )
                        ),
                        RoundedCornerShape(28.dp)
                    )
            )

            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(
                                H2VColors.GradientStart,
                                H2VColors.GradientMid,
                                H2VColors.GradientEnd
                            )
                        )
                    )
                    .drawBehind {
                        // Inner specular highlight
                        drawLine(
                            brush = Brush.horizontalGradient(
                                listOf(Color.Transparent, Color.White.copy(0.35f), Color.Transparent)
                            ),
                            start = Offset(8.dp.toPx(), 8.dp.toPx()),
                            end = Offset(size.width - 8.dp.toPx(), 8.dp.toPx()),
                            strokeWidth = 0.8.dp.toPx()
                        )
                    }
                    .border(
                        0.5.dp,
                        Brush.verticalGradient(
                            listOf(Color.White.copy(0.4f), Color.White.copy(0.1f))
                        ),
                        RoundedCornerShape(22.dp)
                    )
            ) {
                Text(
                    text = "H",
                    style = TextStyle(
                        fontSize = 36.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White
                    )
                )
            }
        }

        Spacer(Modifier.height(18.dp))

        Text(
            text = "H2V",
            style = TextStyle(
                fontSize = 30.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                letterSpacing = (-1.0).sp
            )
        )

        Spacer(Modifier.height(5.dp))

        AnimatedContent(
            targetState = isLogin,
            transitionSpec = {
                fadeIn(tween(250)) togetherWith fadeOut(tween(150))
            },
            label = "subtitle"
        ) { login ->
            Text(
                text = if (login) "С возвращением" else "Создать аккаунт",
                style = TextStyle(
                    fontSize = 15.sp,
                    color = Color.White.copy(alpha = 0.38f)
                )
            )
        }
    }
}

@Composable
private fun FormSection(vm: AuthViewModel, onSuccess: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ModePicker(isLogin = vm.isLogin, onToggle = { vm.isLogin = it })

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            GlassInputField(
                label = "Email",
                value = vm.email,
                onValueChange = { vm.email = it },
                keyboardType = KeyboardType.Email
            )

            AnimatedVisibility(
                visible = !vm.isLogin,
                enter = fadeIn(tween(200)) + expandVertically(tween(250, easing = EaseOutCubic)),
                exit = fadeOut(tween(150)) + shrinkVertically(tween(200, easing = EaseInCubic))
            ) {
                GlassInputField(
                    label = "Никнейм",
                    value = vm.nickname,
                    onValueChange = { vm.nickname = it }
                )
            }

            GlassInputField(
                label = "Пароль",
                value = vm.password,
                onValueChange = { vm.password = it },
                secure = true,
                keyboardType = KeyboardType.Password
            )
        }

        AnimatedVisibility(
            visible = vm.errorMsg != null,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            vm.errorMsg?.let { err ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            H2VColors.DangerRed.copy(alpha = 0.12f),
                            RoundedCornerShape(12.dp)
                        )
                        .border(0.5.dp, H2VColors.DangerRed.copy(0.3f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 11.dp)
                ) {
                    Text("⚠", fontSize = 13.sp)
                    Text(
                        text = err,
                        style = TextStyle(
                            color = H2VColors.DangerRed,
                            fontSize = 13.sp
                        )
                    )
                }
            }
        }

        SubmitButton(
            isLogin = vm.isLogin,
            isLoading = vm.isLoading,
            canSubmit = vm.canSubmit,
            onClick = { vm.submit(onSuccess) }
        )
    }
}

@Composable
private fun ModePicker(isLogin: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(cornerRadius = 16.dp)
            .padding(4.dp)
    ) {
        ModeTab(title = "Войти", active = isLogin, onClick = { onToggle(true) })
        ModeTab(title = "Регистрация", active = !isLogin, onClick = { onToggle(false) })
    }
}

@Composable
private fun RowScope.ModeTab(title: String, active: Boolean, onClick: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    val bg by animateColorAsState(
        targetValue = if (active) Color.White.copy(alpha = 0.14f) else Color.Transparent,
        animationSpec = tween(200),
        label = "tabBg"
    )
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .then(
                if (active) Modifier.border(0.5.dp, Color.White.copy(0.2f), RoundedCornerShape(12.dp))
                else Modifier
            )
            .clickable(interactionSource = interactionSource, indication = null) { onClick() }
            .padding(vertical = 9.dp)
    ) {
        Text(
            text = title,
            style = TextStyle(
                fontSize = 14.sp,
                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                color = if (active) Color.White.copy(0.92f) else Color.White.copy(0.35f)
            )
        )
    }
}

@Composable
private fun SubmitButton(
    isLogin: Boolean,
    isLoading: Boolean,
    canSubmit: Boolean,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1.0f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 600f),
        label = "btnScale"
    )

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .scale(scale)
            .clip(RoundedCornerShape(16.dp))
            .then(
                if (canSubmit) Modifier.background(
                    Brush.linearGradient(
                        listOf(H2VColors.GradientStart, H2VColors.GradientMid, H2VColors.GradientEnd)
                    )
                ) else Modifier.background(Color.White.copy(alpha = 0.07f))
            )
            .border(
                0.5.dp,
                if (canSubmit) Color.White.copy(0.25f) else Color.White.copy(0.08f),
                RoundedCornerShape(16.dp)
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = canSubmit && !isLoading
            ) { onClick() }
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                color = Color.White.copy(0.8f),
                modifier = Modifier.size(22.dp),
                strokeWidth = 2.dp
            )
        } else {
            Text(
                text = if (isLogin) "Войти" else "Создать аккаунт",
                style = TextStyle(
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (canSubmit) Color.White else Color.White.copy(0.3f)
                )
            )
        }
    }
}
