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
        NetworkWatcher(this, hub::networkChanged).start()
        HubService.ensureChannels(this)
        calls = CallManager(this, hub) { m -> CallAudio(this, hub::sendBinary) { m.micMuted } }
        val p = dev.callmeclaude.ui.PlatformChecks.read(this)
        AppLog.i(
            "cmc.app",
            "start: sdk=${Build.VERSION.SDK_INT} paired=${hub.pairing.value != null} notifications=${p.notifications} " +
                "fullScreenIntent=${p.fullScreenIntent} batteryExempt=${p.battery}",
        )
    }
}
