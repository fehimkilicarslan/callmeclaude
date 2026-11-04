package dev.callmeclaude

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Keeps the hub WebSocket open while the app is paired, so the hub can ring the phone directly
 * over it (there is no push service on Android).
 *
 * Foreground service types (see the manifest):
 *  - idle: `specialUse` — none of the dedicated types fits "hold a socket so a paired computer can
 *    ring us" (`dataSync` is capped at 6 h per day on Android 15+ and is meant for transfers);
 *  - in a call: `specialUse|phoneCall|microphone`, see [CallManager].
 */
class HubService : Service() {
    private val app get() = application as CallMeClaudeApp
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var foreground = false

    override fun onCreate() {
        super.onCreate()
        ensureChannels(this)
        app.hub.setActive(REASON, true)
        scope.launch {
            combine(app.hub.connected, app.hub.status, app.hub.pairing) { c, s, p -> Triple(c, s, p) }
                .collect { (connected, status, pairing) ->
                    if (pairing == null) {
                        stopSelf()
                        return@collect
                    }
                    if (foreground) notify(statusNotification(connected, status, pairing.name))
                }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (app.hub.pairing.value == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val hub = app.hub
        startForegroundTyped(statusNotification(hub.connected.value, hub.status.value, hub.pairing.value?.name), idleTypes())
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        app.hub.setActive(REASON, false)
        foreground = false
        super.onDestroy()
    }

    private fun startForegroundTyped(n: Notification, types: Int): Boolean = try {
        startForeground(NOTIFICATION_ID, n, types)
        foreground = true
        true
    } catch (e: RuntimeException) {
        // ForegroundServiceStartNotAllowedException / SecurityException (missing eligibility for a type).
        Log.w(TAG, "startForeground(types=$types) failed: $e")
        false
    }

    private fun notify(n: Notification) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, n)
    }

    private fun statusNotification(connected: Boolean, status: String, name: String?): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = Notification.Builder(this, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_claude)
            .setContentTitle(if (connected) "Connected to ${name ?: "your computer"}" else status)
            .setContentText(if (connected) "Claude can call you." else "Claude can't call you until this reconnects.")
            .setContentIntent(open)
            .setOngoing(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
    }

    companion object {
        private const val TAG = "cmc.service"
        private const val REASON = "service"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_STATUS = "connection"

        fun idleTypes(): Int =
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0

        /** Start (paired) or stop (unpaired). Call from a foreground Activity: background starts are restricted. */
        fun sync(context: Context, paired: Boolean) {
            val i = Intent(context, HubService::class.java)
            if (!paired) {
                context.stopService(i)
                return
            }
            try {
                context.startForegroundService(i)
            } catch (e: IllegalStateException) {
                // ForegroundServiceStartNotAllowedException (API 31+) extends IllegalStateException.
                Log.w(TAG, "could not start the service: $e")
            }
        }

        fun ensureChannels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_STATUS, "Connection", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows whether your computer can reach this phone."
                    setShowBadge(false)
                },
            )
        }
    }
}
