package dev.callmeclaude.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Same palette as apps/ios Views.swift `Theme`; the app is dark-only like the iOS one. */
object Palette {
    val accent = Color(0xFFD97857) // Claude orange
    val bg = Color(0xFF121214)
    val card = Color(0x0FFFFFFF)
    val stroke = Color(0x14FFFFFF)
    val green = Color(0xFF34C759)
    val orange = Color(0xFFFF9F0A)
    val red = Color(0xFFFF453A)
    val blue = Color(0xFF0A84FF)
    val gray = Color(0xFF8E8E93)

    fun state(s: String): Color = when (s) {
        "running" -> blue
        "blocked", "errored" -> red
        "waiting_permission", "waiting_input" -> orange
        "done" -> green
        else -> gray
    }
}

@Composable
fun CmcTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Color.White,
            secondary = Palette.accent,
            background = Palette.bg,
            surface = Palette.bg,
            surfaceContainer = Color(0xFF1C1C1F),
            surfaceContainerHigh = Color(0xFF242428),
            error = Palette.red,
        ),
        content = content,
    )
}
