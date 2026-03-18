package com.example.h2v1test.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.example.h2v1test.ui.theme.*
import java.text.SimpleDateFormat
import java.util.*

// MARK: - Glass Modifiers

fun Modifier.glassBackground(
    cornerRadius: Dp = 16.dp,
    surfaceColor: Color = H2VColors.GlassSurfaceDark,
    borderColor: Color = H2VColors.GlassBorderDark,
    surfaceAlpha: Float = 0.52f
): Modifier = this
    .background(surfaceColor.copy(alpha = surfaceAlpha), RoundedCornerShape(cornerRadius))
    .border(0.5.dp, borderColor, RoundedCornerShape(cornerRadius))

// Liquid glass surface — adds specular top highlight + inner glow
fun Modifier.liquidGlass(
    cornerRadius: Dp = 16.dp,
    tintColor: Color = Color.White,
    alpha: Float = 0.48f
): Modifier = this
    .background(
        Brush.verticalGradient(
            listOf(
                tintColor.copy(alpha = alpha * 0.22f),
                tintColor.copy(alpha = alpha * 0.08f),
                Color.Black.copy(alpha = 0.22f)
            )
        ),
        RoundedCornerShape(cornerRadius)
    )
    .drawBehind {
        // Top specular line
        drawLine(
            brush = Brush.horizontalGradient(
                listOf(
                    Color.Transparent,
                    Color.White.copy(0.25f),
                    Color.White.copy(0.38f),
                    Color.White.copy(0.25f),
                    Color.Transparent
                )
            ),
            start = Offset(cornerRadius.toPx(), 0f),
            end = Offset(size.width - cornerRadius.toPx(), 0f),
            strokeWidth = 0.6.dp.toPx()
        )
        // Bottom subtle line
        drawLine(
            brush = Brush.horizontalGradient(
                listOf(
                    Color.Transparent,
                    Color.White.copy(0.06f),
                    Color.Transparent
                )
            ),
            start = Offset(cornerRadius.toPx(), size.height),
            end = Offset(size.width - cornerRadius.toPx(), size.height),
            strokeWidth = 0.4.dp.toPx()
        )
    }
    .border(
        width = 0.5.dp,
        brush = Brush.verticalGradient(
            listOf(
                Color.White.copy(0.22f),
                Color.White.copy(0.06f),
                Color.White.copy(0.04f)
            )
        ),
        shape = RoundedCornerShape(cornerRadius)
    )

fun Modifier.glassCapsule(
    surfaceColor: Color = H2VColors.GlassSurfaceDark,
    borderColor: Color = H2VColors.GlassBorderDark,
    surfaceAlpha: Float = 0.52f
): Modifier = this
    .background(surfaceColor.copy(alpha = surfaceAlpha), CircleShape)
    .border(0.5.dp, borderColor, CircleShape)

// MARK: - Avatar View

@Composable
fun AvatarView(
    url: String?,
    initials: String,
    size: Dp,
    isOnline: Boolean = false,
    avatarColorOverride: Color? = null,
    square: Boolean = false
) {
    val color = avatarColorOverride ?: H2VColors.AvatarPalette[0]
    val radius = if (square) size * 0.28f else size / 2

    Box(contentAlignment = Alignment.BottomEnd) {
        if (!url.isNullOrEmpty()) {
            Box(
                modifier = Modifier
                    .size(size)
                    .clip(RoundedCornerShape(radius))
                    .border(
                        width = 1.dp,
                        brush = Brush.verticalGradient(listOf(Color.White.copy(0.22f), Color.White.copy(0.06f))),
                        shape = RoundedCornerShape(radius)
                    )
            ) {
                AsyncImage(
                    model = url,
                    contentDescription = initials,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
        } else {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(size)
                    .clip(RoundedCornerShape(radius))
                    .background(
                        Brush.linearGradient(
                            listOf(color.copy(alpha = 0.28f), color.copy(alpha = 0.12f))
                        )
                    )
                    .border(
                        width = 0.8.dp,
                        brush = Brush.verticalGradient(
                            listOf(color.copy(alpha = 0.45f), color.copy(alpha = 0.15f))
                        ),
                        shape = RoundedCornerShape(radius)
                    )
            ) {
                Text(
                    text = initials.take(2).uppercase(),
                    style = TextStyle(
                        fontSize = (size.value * 0.34f).sp,
                        fontWeight = FontWeight.Bold,
                        color = color
                    )
                )
            }
        }

        if (isOnline) {
            val dotSize = size * 0.24f
            Box(
                modifier = Modifier
                    .size(dotSize)
                    .offset(x = 1.dp, y = 1.dp)
                    .clip(CircleShape)
                    .background(H2VColors.OnlineGreen)
                    .border(dotSize * 0.22f, H2VColors.AppBgDark, CircleShape)
            )
        }
    }
}

// MARK: - Group Avatar

@Composable
fun GroupAvatarView(chatId: String, size: Dp) {
    val color = avatarColor(chatId)
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.30f))
            .background(
                Brush.linearGradient(
                    listOf(color.copy(alpha = 0.25f), color.copy(alpha = 0.10f))
                )
            )
            .border(
                0.8.dp,
                Brush.verticalGradient(listOf(color.copy(0.4f), color.copy(0.12f))),
                RoundedCornerShape(size * 0.30f)
            )
    ) {
        Text(
            text = "#",
            style = TextStyle(
                fontSize = (size.value * 0.42f).sp,
                fontWeight = FontWeight.Bold,
                color = color
            )
        )
    }
}

// MARK: - Glass Search Bar

@Composable
fun GlassSearchBar(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "Поиск",
    modifier: Modifier = Modifier
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .liquidGlass(cornerRadius = 14.dp)
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = null,
            tint = H2VColors.TextTertiaryDark,
            modifier = Modifier.size(15.dp)
        )
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = H2VColors.TextPrimaryDark,
                fontSize = 15.sp
            ),
            cursorBrush = SolidColor(H2VColors.AccentBlue),
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = TextStyle(color = H2VColors.TextTertiaryDark, fontSize = 15.sp)
                    )
                }
                inner()
            },
            modifier = Modifier.weight(1f)
        )
    }
}

// MARK: - Glass Input Field

@Composable
fun GlassInputField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    secure: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text
) {
    Column(modifier = modifier) {
        Text(
            text = label.uppercase(),
            style = TextStyle(
                color = H2VColors.TextTertiaryDark,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.6.sp
            ),
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 4.dp)
        )
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = H2VColors.TextPrimaryDark,
                fontSize = 16.sp
            ),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
            cursorBrush = SolidColor(H2VColors.AccentBlue),
            decorationBox = { inner ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .liquidGlass(cornerRadius = 14.dp)
                        .padding(horizontal = 16.dp, vertical = 14.dp)
                ) { inner() }
            },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

// MARK: - Typing Indicator

@Composable
fun TypingIndicatorView() {
    val infiniteTransition = rememberInfiniteTransition(label = "typing")
    val dots = (0..2).map { i ->
        infiniteTransition.animateFloat(
            initialValue = 0.4f,
            targetValue = 1.0f,
            animationSpec = infiniteRepeatable(
                animation = keyframes {
                    durationMillis = 900
                    0.4f at 0
                    1.0f at (280 * (i + 1)) % 900
                    0.4f at 900
                },
                repeatMode = RepeatMode.Restart
            ),
            label = "dot$i"
        )
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .liquidGlass(cornerRadius = 20.dp)
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        dots.forEach { scale ->
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .scale(scale.value)
                    .clip(CircleShape)
                    .background(
                        Color.White.copy(alpha = scale.value * 0.7f + 0.1f)
                    )
            )
        }
    }
}

// MARK: - Unread Badge

@Composable
fun UnreadBadge(count: Int, muted: Boolean = false) {
    if (count <= 0) return
    val text = if (count > 99) "99+" else count.toString()
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .defaultMinSize(minWidth = 20.dp, minHeight = 20.dp)
            .then(
                if (muted) Modifier.background(Color.White.copy(0.12f), CircleShape)
                else Modifier.background(
                    Brush.linearGradient(listOf(H2VColors.GradientStart, H2VColors.GradientEnd)),
                    CircleShape
                )
            )
            .padding(horizontal = 5.dp)
    ) {
        Text(
            text = text,
            style = TextStyle(
                color = if (muted) H2VColors.TextTertiaryDark else Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
        )
    }
}

// MARK: - Date Separator

@Composable
fun DateSeparatorView(text: String) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
    ) {
        Text(
            text = text,
            style = TextStyle(
                color = Color.White.copy(alpha = 0.25f),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.3.sp
            ),
            modifier = Modifier
                .background(Color.White.copy(alpha = 0.06f), CircleShape)
                .border(0.3.dp, Color.White.copy(0.08f), CircleShape)
                .padding(horizontal = 12.dp, vertical = 4.dp)
        )
    }
}

// MARK: - Message Time Formatter

object MessageTime {
    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val weekFmt = SimpleDateFormat("EEE", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("dd.MM.yy", Locale.getDefault())

    private fun parseIso(s: String): Date? = try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        sdf.parse(s)
    } catch (_: Exception) {
        try {
            val sdf2 = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
            sdf2.timeZone = TimeZone.getTimeZone("UTC")
            sdf2.parse(s)
        } catch (_: Exception) { null }
    }

    fun shortTime(s: String): String {
        val date = parseIso(s) ?: return ""
        return timeFmt.format(date)
    }

    fun rowTime(s: String): String {
        val date = parseIso(s) ?: return ""
        val cal = Calendar.getInstance()
        val msgCal = Calendar.getInstance().also { it.time = date }
        return when {
            cal.get(Calendar.DAY_OF_YEAR) == msgCal.get(Calendar.DAY_OF_YEAR) &&
            cal.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) -> timeFmt.format(date)
            cal.get(Calendar.DAY_OF_YEAR) - msgCal.get(Calendar.DAY_OF_YEAR) == 1 &&
            cal.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) -> "Вчера"
            cal.get(Calendar.DAY_OF_YEAR) - msgCal.get(Calendar.DAY_OF_YEAR) < 7 &&
            cal.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) -> weekFmt.format(date)
            else -> dateFmt.format(date)
        }
    }
}
