package com.example.h2v1test.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object H2VColors {
    // Main backgrounds — deep dark with subtle blue tint 
    val AppBgDark = Color(0xFF0C0C0E)
    val AppBgLight = Color(0xFFF2F2F7)

    // Glass surfaces — layered translucency
    val GlassSurfaceDark = Color(0xFF1C1C1F)
    val GlassSurfaceLight = Color(0xEBFFFFFF)

    // Glass borders — subtle specular
    val GlassBorderDark = Color(0x1FFFFFFF)   // white 12%
    val GlassBorderLight = Color(0x12000000)  // black 7%

    // Glass border bright (top specular highlight)
    val GlassBorderBright = Color(0x33FFFFFF)  // white 20%

    // Message bubbles — my messages (accent tinted)
    val BubbleMeDark = Color(0xFF1A3A5C)       // deep blue
    val BubbleMeLight = Color(0xFFD0E8FF)
    val BubbleThemDark = Color(0xFF1E1E22)     // near-black
    val BubbleThemLight = Color(0xFFFFFFFF)

    // Text hierarchy
    val TextPrimaryDark = Color(0xF0FFFFFF)    // white 94%
    val TextPrimaryLight = Color(0xE1000000)
    val TextSecondaryDark = Color(0x80FFFFFF)  // white 50%
    val TextSecondaryLight = Color(0x61000000)
    val TextTertiaryDark = Color(0x42FFFFFF)   // white 26%
    val TextTertiaryLight = Color(0x33000000)

    // Accent colors
    val OnlineGreen = Color(0xFF34C759)
    val DangerRed = Color(0xFFFF3B30)
    val AccentBlue = Color(0xFF4E86FF)         // more vibrant blue
    val AccentBlueLight = Color(0xFF7AADFF)    // lighter variant for active states
    val GradientStart = Color(0xFF4A7CFF)
    val GradientEnd = Color(0xFF7A4AFF)
    val GradientMid = Color(0xFF5E6AFF)

    // Message bubble — my messages exact colors
    val BubbleSolidMe = Color(0xFF1A3050)
    val BubbleSolidThem = Color(0xFF242428)

    // Tab bar  
    val TabBarBg = Color(0xD00C0C0F)           // dark with 82% alpha

    // Avatar pastel palette — warmer tones
    val AvatarPalette = listOf(
        Color(0xFFE8CFA0), Color(0xFF8BB8D4), Color(0xFFD4889A),
        Color(0xFF9B8BC8), Color(0xFF89C8A8), Color(0xFFD4A078),
        Color(0xFFA8C878), Color(0xFF78C8C0), Color(0xFFD4B890),
        Color(0xFF90A8D4)
    )
}

fun avatarColor(id: String): Color {
    val hash = id.fold(0) { acc, c -> acc + c.code }
    return H2VColors.AvatarPalette[Math.abs(hash) % H2VColors.AvatarPalette.size]
}

private val DarkColorScheme = darkColorScheme(
    primary = H2VColors.AccentBlue,
    onPrimary = Color.White,
    background = H2VColors.AppBgDark,
    onBackground = H2VColors.TextPrimaryDark,
    surface = H2VColors.GlassSurfaceDark,
    onSurface = H2VColors.TextPrimaryDark,
    surfaceVariant = Color(0xFF1A1A1E),
    onSurfaceVariant = H2VColors.TextSecondaryDark,
    error = H2VColors.DangerRed,
    secondary = H2VColors.AccentBlueLight,
)

@Composable
fun H2VTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
