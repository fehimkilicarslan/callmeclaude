package dev.callmeclaude.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.callmeclaude.R
import dev.callmeclaude.calls.CallManager
import kotlinx.coroutines.delay

/** iOS CallOverlay (Views.swift), plus Answer/Decline while ringing and the last transcript lines. */
@Composable
fun CallScreen(calls: CallManager) {
    val call by calls.ui.collectAsStateWithLifecycle()
    val muted by calls.muted.collectAsStateWithLifecycle()
    val speaker by calls.speaker.collectAsStateWithLifecycle()
    val lines by calls.transcript.collectAsStateWithLifecycle()
    val c = call ?: return

    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val ringing = c.incoming && !c.answered
    val status = when {
        c.connectedAt != null -> {
            val s = ((now - c.connectedAt) / 1000).coerceAtLeast(0)
            "%02d:%02d".format(s / 60, s % 60)
        }
        ringing -> "Incoming call…"
        c.incoming -> "Connecting…"
        else -> "Calling…"
    }

    CompositionLocalProvider(LocalContentColor provides Color.White) { CallContent(calls, c, status, ringing, muted, speaker, lines) }
}

@Composable
private fun CallContent(
    calls: CallManager,
    c: CallManager.CallUi,
    status: String,
    ringing: Boolean,
    muted: Boolean,
    speaker: Boolean,
    lines: List<CallManager.Line>,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF292929), Color(0xFF0D0D0D))))
            .safeDrawingPadding()
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(72.dp))
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(128.dp).background(Palette.accent, CircleShape)) {
            Text("C", fontSize = 64.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }
        Text("Claude", fontSize = 34.sp, modifier = Modifier.padding(top = 22.dp))
        if (ringing && c.title.isNotEmpty() && c.title != "Claude") {
            Text(c.title, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            status,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
        Spacer(Modifier.height(24.dp))
        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom),
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            if (!ringing) {
                lines.takeLast(3).forEach { l ->
                    Text(
                        l.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (l.role == "user") MaterialTheme.colorScheme.onSurfaceVariant else Color.White,
                        textAlign = if (l.role == "user") TextAlign.End else TextAlign.Start,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        if (ringing) {
            Row(horizontalArrangement = Arrangement.spacedBy(96.dp), modifier = Modifier.padding(bottom = 70.dp)) {
                RoundAction(R.drawable.ic_call_end, "Decline", Palette.red) { calls.decline() }
                RoundAction(R.drawable.ic_call, "Answer", Palette.green) { calls.answer() }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(56.dp)) {
                CallKey(if (muted) R.drawable.ic_mic_off else R.drawable.ic_mic, "Mute", muted) { calls.setMuted(!muted) }
                CallKey(R.drawable.ic_speaker, "Speaker", speaker) { calls.setSpeaker(!speaker) }
            }
            Box(Modifier.padding(top = 44.dp, bottom = 70.dp)) {
                RoundAction(R.drawable.ic_call_end, "End call", Palette.red, label = null) { calls.hangUp() }
            }
        }
    }
}

@Composable
private fun CallKey(icon: Int, label: String, on: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledIconButton(
            onClick = onClick,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = if (on) Color.White else Color.White.copy(alpha = 0.18f),
                contentColor = if (on) Color.Black else Color.White,
            ),
            modifier = Modifier.size(76.dp),
        ) { Icon(painterResource(icon), contentDescription = label, modifier = Modifier.size(30.dp)) }
        Text(label, style = MaterialTheme.typography.labelLarge, color = Color.White)
    }
}

@Composable
private fun RoundAction(icon: Int, description: String, color: Color, label: String? = description, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledIconButton(
            onClick = onClick,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White),
            modifier = Modifier.size(78.dp),
        ) { Icon(painterResource(icon), contentDescription = description, modifier = Modifier.size(34.dp)) }
        if (label != null) Text(label, style = MaterialTheme.typography.labelLarge, color = Color.White)
    }
}

/** The green "Call Claude" button on the home screen (iOS CallHero, without the Siri hint). */
@Composable
fun CallHero(onCall: () -> Unit, enabled: Boolean) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
    ) {
        FilledIconButton(
            onClick = onCall,
            enabled = enabled,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = Palette.green, contentColor = Color.White),
            modifier = Modifier.size(92.dp),
        ) { Icon(painterResource(R.drawable.ic_call), contentDescription = "Call Claude", modifier = Modifier.size(38.dp)) }
        Text("Call Claude", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
    }
}
