package com.example.h2v1test

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.h2v1test.ui.auth.AuthScreen
import com.example.h2v1test.ui.chat.ChatScreen
import com.example.h2v1test.ui.chatlist.ChatListScreen
import com.example.h2v1test.ui.profile.ProfileScreen
import com.example.h2v1test.ui.theme.H2VColors
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.haze
import dev.chrisbanes.haze.hazeChild

sealed class Screen(val route: String) {
    object Auth : Screen("auth")
    object ChatList : Screen("chatlist")
    object Chat : Screen("chat/{chatId}") {
        fun createRoute(chatId: String) = "chat/$chatId"
    }
    object Profile : Screen("profile")
}

enum class AppTab { CHATS, PROFILE }

@Composable
fun AppNavigation(appState: AppState) {
    val navController = rememberNavController()

    LaunchedEffect(appState.isAuthenticated) {
        if (!appState.isAuthenticated) {
            navController.navigate(Screen.Auth.route) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    val startDestination = if (appState.isAuthenticated) Screen.ChatList.route else Screen.Auth.route

    NavHost(
        navController = navController,
        startDestination = startDestination,
        enterTransition = { slideInHorizontally(tween(300, easing = EaseOutCubic)) { it } + fadeIn(tween(200)) },
        exitTransition = { slideOutHorizontally(tween(300, easing = EaseInCubic)) { -it / 4 } + fadeOut(tween(150)) },
        popEnterTransition = { slideInHorizontally(tween(300, easing = EaseOutCubic)) { -it / 4 } + fadeIn(tween(200)) },
        popExitTransition = { slideOutHorizontally(tween(300, easing = EaseInCubic)) { it } + fadeOut(tween(150)) }
    ) {
        composable(Screen.Auth.route) {
            AuthScreen(appState = appState, onSuccess = {
                navController.navigate(Screen.ChatList.route) {
                    popUpTo(Screen.Auth.route) { inclusive = true }
                }
            })
        }

        composable(Screen.ChatList.route) {
            MainTabView(
                appState = appState,
                onNavigateToChat = { chatId ->
                    navController.navigate(Screen.Chat.createRoute(chatId))
                }
            )
        }

        composable(
            route = Screen.Chat.route,
            arguments = listOf(navArgument("chatId") { type = NavType.StringType })
        ) { backStack ->
            val chatId = backStack.arguments?.getString("chatId") ?: return@composable
            ChatScreen(
                chatId = chatId,
                appState = appState,
                onBack = { navController.popBackStack() }
            )
        }
    }
}

@Composable
fun MainTabView(
    appState: AppState,
    onNavigateToChat: (String) -> Unit
) {
    var selectedTab by remember { mutableStateOf(AppTab.CHATS) }
    var showTabBar by remember { mutableStateOf(true) }
    val hazeState = remember { HazeState() }

    Box(modifier = Modifier.fillMaxSize().background(H2VColors.AppBgDark)) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .haze(hazeState)
        ) {
            when (selectedTab) {
                AppTab.CHATS -> ChatListScreen(
                    appState = appState,
                    onNavigateToChat = onNavigateToChat,
                    onHideTabBar = { showTabBar = false },
                    onShowTabBar = { showTabBar = true }
                )
                AppTab.PROFILE -> ProfileScreen(appState = appState)
            }
        }

        AnimatedVisibility(
            visible = showTabBar,
            enter = slideInVertically(tween(300, easing = EaseOutCubic)) { it } + fadeIn(tween(200)),
            exit = slideOutVertically(tween(250, easing = EaseInCubic)) { it } + fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            LiquidGlassTabBar(
                hazeState = hazeState,
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it }
            )
        }
    }
}

@Composable
fun LiquidGlassTabBar(
    hazeState: HazeState,
    selectedTab: AppTab,
    onTabSelected: (AppTab) -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .hazeChild(state = hazeState)
                .drawBehind {
                    // Specular highlight — bright line at top edge
                    drawLine(
                        brush = Brush.horizontalGradient(
                            listOf(
                                Color.Transparent,
                                Color.White.copy(0.06f),
                                Color.White.copy(0.22f),
                                Color.White.copy(0.22f),
                                Color.White.copy(0.06f),
                                Color.Transparent
                            )
                        ),
                        start = Offset(0f, 0f),
                        end = Offset(size.width, 0f),
                        strokeWidth = 0.8.dp.toPx()
                    )
                }
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 10.dp)
        ) {
            LiquidGlassTabItem(
                icon = Icons.Filled.ChatBubble,
                label = "Чаты",
                isActive = selectedTab == AppTab.CHATS,
                onClick = { onTabSelected(AppTab.CHATS) }
            )
            LiquidGlassTabItem(
                icon = Icons.Filled.Person,
                label = "Профиль",
                isActive = selectedTab == AppTab.PROFILE,
                onClick = { onTabSelected(AppTab.PROFILE) }
            )
        }
    }
}

@Composable
fun RowScope.LiquidGlassTabItem(
    icon: ImageVector,
    label: String,
    isActive: Boolean,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }

    val iconScale by animateFloatAsState(
        targetValue = if (isActive) 1.18f else 1.0f,
        animationSpec = spring(dampingRatio = 0.55f, stiffness = 500f),
        label = "scale"
    )
    val iconAlpha by animateFloatAsState(
        targetValue = if (isActive) 1.0f else 0.42f,
        animationSpec = tween(220, easing = EaseInOutCubic),
        label = "alpha"
    )
    val textAlpha by animateFloatAsState(
        targetValue = if (isActive) 0.88f else 0.32f,
        animationSpec = tween(220),
        label = "textAlpha"
    )

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(20.dp))
            .clickable(interactionSource = interactionSource, indication = null) { onClick() }
            .padding(vertical = 4.dp)
    ) {
        // Active glow pill
        if (isActive) {
            AnimatedGlowPill()
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = if (isActive) H2VColors.AccentBlue.copy(alpha = iconAlpha)
                       else Color.White.copy(alpha = iconAlpha),
                modifier = Modifier
                    .size(24.dp)
                    .scale(iconScale)
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = label,
                fontSize = 10.sp,
                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                color = if (isActive) H2VColors.AccentBlue.copy(alpha = textAlpha)
                        else Color.White.copy(alpha = textAlpha),
                letterSpacing = 0.2.sp
            )
        }
    }
}

@Composable
private fun AnimatedGlowPill() {
    val infiniteTransition = rememberInfiniteTransition(label = "glow")
    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.16f,
        targetValue = 0.30f,
        animationSpec = infiniteRepeatable(
            animation = tween(1800, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glowAlpha"
    )

    Box(contentAlignment = Alignment.Center) {
        // Outer glow halo — layered radial gradients instead of setShadowLayer
        Box(
            modifier = Modifier
                .size(width = 90.dp, height = 58.dp)
                .background(
                    Brush.radialGradient(
                        listOf(
                            H2VColors.AccentBlue.copy(alpha = glowAlpha * 0.5f),
                            H2VColors.AccentBlue.copy(alpha = glowAlpha * 0.15f),
                            Color.Transparent
                        )
                    ),
                    RoundedCornerShape(29.dp)
                )
        )
        // Inner pill
        Box(
            modifier = Modifier
                .size(width = 72.dp, height = 44.dp)
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.White.copy(alpha = glowAlpha * 1.1f),
                            H2VColors.AccentBlue.copy(alpha = glowAlpha * 0.7f),
                            H2VColors.AccentBlue.copy(alpha = glowAlpha * 0.3f)
                        )
                    ),
                    RoundedCornerShape(22.dp)
                )
                .border(
                    width = 0.5.dp,
                    brush = Brush.verticalGradient(
                        listOf(
                            Color.White.copy(0.40f),
                            H2VColors.AccentBlue.copy(0.20f),
                            Color.Transparent
                        )
                    ),
                    shape = RoundedCornerShape(22.dp)
                )
        )
    }
}
