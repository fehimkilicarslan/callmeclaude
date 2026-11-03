package dev.callmeclaude

import android.app.Application
import android.os.Build
import android.provider.Settings

class CallMeClaudeApp : Application() {
    /** One connection per process, shared by the UI now and a foreground service later. */
    lateinit var hub: HubClient
        private set

    override fun onCreate() {
        super.onCreate()
        val device = Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL
        hub = HubClient(PairingStore(this), device)
    }
}
