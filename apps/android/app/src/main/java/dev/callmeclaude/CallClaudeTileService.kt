package dev.callmeclaude

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * "Call Claude" quick settings tile. Tapping opens [CallClaudeActivity] (same decisions as the app
 * shortcut). Active while connected to the computer; inactive, with a short subtitle, when not
 * paired or offline. Inactive still calls: the call then says the computer can't be reached.
 */
class CallClaudeTileService : TileService() {
    private val app get() = application as CallMeClaudeApp
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watching: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        watching?.cancel()
        watching = scope.launch {
            combine(app.hub.pairing, app.hub.connected, app.calls.ui) { p, c, call ->
                tileView(paired = p != null, connected = c, inCall = call != null && call.error == null)
            }.collect(::show)
        }
    }

    override fun onStopListening() {
        watching?.cancel()
        watching = null
        super.onStopListening()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun show(v: TileView) {
        val tile = qsTile ?: return
        tile.state = if (v.active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = v.subtitle
        if (Build.VERSION.SDK_INT >= 30) tile.stateDescription = v.subtitle
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        // CallClaudeActivity is shown over the lock screen, so the system can open it without an unlock.
        val intent = CallClaudeActivity.intent(this).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
        } else {
            @Suppress("DEPRECATION")
            @SuppressLint("StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(intent)
        }
    }
}

/** What the tile shows under its "Call Claude" label. */
data class TileView(val active: Boolean, val subtitle: String)

fun tileView(paired: Boolean, connected: Boolean, inCall: Boolean): TileView = when {
    !paired -> TileView(active = false, subtitle = "Not paired")
    inCall -> TileView(active = true, subtitle = "In a call")
    !connected -> TileView(active = false, subtitle = "Not connected")
    else -> TileView(active = true, subtitle = "Ready")
}
