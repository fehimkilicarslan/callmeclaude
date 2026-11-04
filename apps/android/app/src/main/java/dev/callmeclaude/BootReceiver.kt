package dev.callmeclaude

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Starts [HubService] after a reboot or an app update, so a paired phone can be called again without
 * the user opening the app.
 *
 * Both broadcasts are exemptions from the background foreground-service start restrictions. Since
 * Android 15 a BOOT_COMPLETED receiver may not start the dataSync, camera, mediaPlayback, phoneCall,
 * mediaProjection or microphone types; the idle service is `specialUse` only (see HubService), which
 * isn't on that list. The call types are added later, while a call is ringing.
 *
 * BOOT_COMPLETED arrives after the first unlock, so the Keystore key behind the pairing is available.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = context.applicationContext as CallMeClaudeApp
        val paired = app.hub.pairing.value != null
        AppLog.i(TAG, "${action.substringAfterLast('.')}: ${if (paired) "starting the hub service" else "not paired"}")
        if (paired) HubService.sync(context, true)
    }

    private companion object {
        const val TAG = "cmc.boot"
    }
}
