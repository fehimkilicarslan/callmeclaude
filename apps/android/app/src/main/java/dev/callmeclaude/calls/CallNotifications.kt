package dev.callmeclaude.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import dev.callmeclaude.R

/**
 * Ringing and in-call notifications. They replace the hub service's status notification
 * (same id), so a CallStyle notification is always tied to a foreground service.
 */
object CallNotifications {
    const val CHANNEL_INCOMING = "incoming_calls"
    const val CHANNEL_ONGOING = "ongoing_calls"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_INCOMING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Claude calling you."
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "The call with Claude in progress."
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
    }

    fun canUseFullScreenIntent(context: Context): Boolean =
        Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    fun build(context: Context, c: CallManager.CallUi): Notification =
        if (c.incoming && !c.answered) incoming(context, c) else ongoing(context, c)

    private fun person(context: Context) = Person.Builder()
        .setName("Claude")
        .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
        .setImportant(true)
        .build()

    private fun incoming(context: Context, c: CallManager.CallUi): Notification {
        val screen = CallActivity.pendingIntent(context, answer = false)
        val answer = CallActivity.pendingIntent(context, answer = true)
        val decline = CallActionReceiver.pendingIntent(context, CallActionReceiver.ACTION_DECLINE)
        val b = Notification.Builder(context, CHANNEL_INCOMING)
            .setSmallIcon(R.drawable.ic_stat_claude)
            .setContentTitle(CallManager.displayName(c.title))
            .setContentText("Incoming call")
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(screen)
            .setOnlyAlertOnce(c.silenced)
        // Without the permission (Android 14+) the system shows it as a heads-up notification instead.
        if (canUseFullScreenIntent(context)) b.setFullScreenIntent(screen, true)
        if (Build.VERSION.SDK_INT >= 31) {
            b.setStyle(Notification.CallStyle.forIncomingCall(person(context), decline, answer))
        } else {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call_end), "Decline", decline).build())
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call), "Answer", answer).build())
        }
        return b.build().apply { if (!c.silenced) flags = flags or Notification.FLAG_INSISTENT }
    }

    private fun ongoing(context: Context, c: CallManager.CallUi): Notification {
        val screen = CallActivity.pendingIntent(context, answer = false)
        val hangUp = CallActionReceiver.pendingIntent(context, CallActionReceiver.ACTION_HANG_UP)
        val b = Notification.Builder(context, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_claude)
            .setContentTitle("Claude")
            .setContentText(
                when {
                    c.ready -> "On call"
                    c.incoming -> "Connecting…"
                    else -> "Calling…"
                },
            )
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(screen)
        c.connectedAt?.let { b.setWhen(it).setUsesChronometer(true).setShowWhen(true) }
        if (Build.VERSION.SDK_INT >= 31) {
            b.setStyle(Notification.CallStyle.forOngoingCall(person(context), hangUp))
        } else {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call_end), "Hang up", hangUp).build())
        }
        return b.build()
    }
}

/** Decline / hang up from the notification without opening the app. */
class CallActionReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val calls = (context.applicationContext as dev.callmeclaude.CallMeClaudeApp).calls
        when (intent.action) {
            ACTION_DECLINE -> calls.decline()
            ACTION_HANG_UP -> calls.hangUp()
        }
    }

    companion object {
        const val ACTION_DECLINE = "dev.callmeclaude.DECLINE"
        const val ACTION_HANG_UP = "dev.callmeclaude.HANG_UP"

        fun pendingIntent(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
            context,
            action.hashCode(),
            Intent(context, CallActionReceiver::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
