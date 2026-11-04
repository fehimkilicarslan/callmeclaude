package dev.callmeclaude

import android.app.Application
import android.os.Build
import android.provider.Settings
import dev.callmeclaude.calls.CallAudio
import dev.callmeclaude.calls.CallManager

class CallMeClaudeApp : Application() {
    /** One connection per process, shared by the UI and the foreground service. */
    lateinit var hub: HubClient
        private set

    lateinit var calls: CallManager
        private set

    override fun onCreate() {
        super.onCreate()
        val device = Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL
        hub = HubClient(PairingStore(this), device)
        HubService.ensureChannels(this)
        calls = CallManager(this, hub) { m -> CallAudio(this, hub::sendBinary) { m.micMuted } }
    }
}
