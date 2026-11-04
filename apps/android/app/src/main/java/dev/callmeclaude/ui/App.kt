package dev.callmeclaude.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.callmeclaude.Decision
import dev.callmeclaude.HubClient
import dev.callmeclaude.PendingCard
import dev.callmeclaude.SessionCard
import dev.callmeclaude.calls.CallManager

@Composable
fun App(hub: HubClient, calls: CallManager) {
    CmcTheme {
        val pairing by hub.pairing.collectAsStateWithLifecycle()
        val call by calls.ui.collectAsStateWithLifecycle()
        var showSettings by rememberSaveable { mutableStateOf(false) }
        when {
            call != null -> CallScreen(calls)
            pairing == null -> PairingScreen(hub)
            showSettings -> {
                BackHandler { showSettings = false }
                SettingsScreen(hub, onDone = { showSettings = false })
            }
            else -> HomeScreen(hub, calls, onSettings = { showSettings = true })
        }
    }
}

// region Home

private data class ModeOption(val id: String, val label: String, val hint: String)

private val modes = listOf(
    ModeOption("desk", "Desk", "At the computer. No calls."),
    ModeOption("away", "Away", "Calls when a session is stuck or done."),
    ModeOption("ride", "Ride", "Like Away, extra short sentences."),
    ModeOption("sleep", "Sleep", "Emergencies only."),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(hub: HubClient, calls: CallManager, onSettings: () -> Unit) {
    val connected by hub.connected.collectAsStateWithLifecycle()
    val snapshot by hub.snapshot.collectAsStateWithLifecycle()
    val status by hub.status.collectAsStateWithLifecycle()
    val pairing by hub.pairing.collectAsStateWithLifecycle()
    var confirmPanic by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    AskCallPermissionsOnce()
    val context = LocalContext.current
    // "Call Claude" needs the microphone; ask first if it's missing, then place the call anyway
    // (without it the hub still gets silence frames and the call stays up).
    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { calls.placeCall() }
    val placeCall = {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) calls.placeCall()
        else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    val sessions = snapshot?.sessions.orEmpty()
    val pending = snapshot?.pending.orEmpty()
    val paused = snapshot?.paused == true

    Scaffold(
        containerColor = Palette.bg,
        topBar = {
            TopAppBar(
                title = { Text("CallMeClaude", fontWeight = FontWeight.SemiBold) },
                actions = { TextButton(onClick = onSettings) { Text("Settings") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg),
            )
        },
    ) { inner ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                hub.ensureConnected { refreshing = false }
            },
            modifier = Modifier.padding(inner).fillMaxSize(),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    ConnectionPill(
                        connected = connected,
                        text = if (connected) "Connected to ${pairing?.name ?: "computer"}" else status,
                    )
                }
                item { CallHero(onCall = placeCall, enabled = pairing != null) }
                item { ModePicker(current = snapshot?.mode ?: "away", onPick = hub::setMode) }
                if (paused) item { PausedBanner(onResume = hub::resume) }
                if (pending.isNotEmpty()) {
                    item { SectionHeader("Needs your decision", pending.size) }
                    items(pending, key = { "p_" + it.id }) { p ->
                        PendingCardView(p, onDecision = { d -> hub.resolve(p.id, d) })
                    }
                }
                item { SectionHeader("Sessions", sessions.size) }
                if (sessions.isEmpty()) {
                    item {
                        Card {
                            Text(
                                if (connected) "No open Claude Code sessions." else "Waiting for your computer…",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                items(sessions, key = { "s_" + it.id }) { SessionCardView(it) }
                if (!paused) {
                    item {
                        OutlinedButton(
                            onClick = { confirmPanic = true },
                            border = BorderStroke(1.dp, Palette.red.copy(alpha = 0.6f)),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.red),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 8.dp),
                        ) { Text("Stop everything") }
                    }
                }
            }
        }
    }

    if (confirmPanic) {
        AlertDialog(
            onDismissRequest = { confirmPanic = false },
            title = { Text("Interrupt all sessions and pause automation?") },
            confirmButton = {
                TextButton(
                    onClick = { confirmPanic = false; hub.panic() },
                    colors = ButtonDefaults.textButtonColors(contentColor = Palette.red),
                ) { Text("Stop everything") }
            },
            dismissButton = { TextButton(onClick = { confirmPanic = false }) { Text("Cancel") } },
        )
    }
}

@Composable
fun Card(tint: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Palette.card, shape)
            .border(1.dp, tint?.copy(alpha = 0.6f) ?: Palette.stroke, shape)
            .padding(14.dp),
        content = content,
    )
}

@Composable
private fun ConnectionPill(connected: Boolean, text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(Palette.card, CircleShape)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Dot(if (connected) Palette.green else Palette.red, 8)
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Dot(color: Color, size: Int) {
    Box(Modifier.size(size.dp).background(color, CircleShape))
}

@Composable
private fun ModePicker(current: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            modes.forEach { m ->
                val selected = current == m.id
                val shape = RoundedCornerShape(12.dp)
                TextButton(
                    onClick = { onPick(m.id) },
                    shape = shape,
                    colors = ButtonDefaults.textButtonColors(
                        containerColor = if (selected) Palette.accent.copy(alpha = 0.22f) else Palette.card,
                        contentColor = if (selected) Palette.accent else MaterialTheme.colorScheme.onSurface,
                    ),
                    border = BorderStroke(1.dp, if (selected) Palette.accent else Palette.stroke),
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) { Text(m.label, fontWeight = FontWeight.Medium) }
            }
        }
        Text(
            modes.firstOrNull { it.id == current }?.hint.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

@Composable
private fun PausedBanner(onResume: () -> Unit) {
    Card(tint = Palette.orange) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Automation paused", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Nothing is approved or held automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(onClick = onResume) { Text("Resume") }
        }
    }
}

@Composable
private fun SectionHeader(title: String, count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (count > 0) {
            Spacer(Modifier.width(8.dp))
            Text(
                "$count",
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.background(Palette.card, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
            )
        }
    }
}

@Composable
private fun SessionCardView(s: SessionCard) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(Palette.state(s.state), 10)
            Spacer(Modifier.width(8.dp))
            Text(
                s.project,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(stateLabel(s.state), style = MaterialTheme.typography.labelMedium, color = Palette.state(s.state))
        }
        Text(
            s.summary,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Text(relative(s.updatedAt), style = MaterialTheme.typography.labelSmall, color = Palette.gray)
    }
}

@Composable
private fun PendingCardView(p: PendingCard, onDecision: (Decision) -> Unit) {
    Card(tint = Palette.orange) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p.project, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            val hot = p.risk == "high" || p.risk == "critical"
            Text(
                p.risk.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .background(if (hot) Palette.red.copy(alpha = 0.3f) else Palette.card, CircleShape)
                    .padding(horizontal = 7.dp, vertical = 3.dp),
            )
        }
        Text(p.summary, style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onDecision(Decision.APPROVE) },
                colors = ButtonDefaults.buttonColors(containerColor = Palette.green, contentColor = Color.White),
            ) { Text("Approve") }
            OutlinedButton(onClick = { onDecision(Decision.DENY) }) { Text("Deny") }
            OutlinedButton(onClick = { onDecision(Decision.RELEASE) }) { Text("Let it stop") }
        }
    }
}

// endregion
