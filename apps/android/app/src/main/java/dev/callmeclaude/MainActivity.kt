package dev.callmeclaude

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.callmeclaude.ui.App

class MainActivity : ComponentActivity() {
    private val hub get() = (application as CallMeClaudeApp).hub

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app is dark-only (like iOS), so system bar icons stay light regardless of the system theme.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        if (savedInstanceState == null) acceptDebugPairing(intent)
        setContent { App(hub) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        acceptDebugPairing(intent)
    }

    override fun onStart() {
        super.onStart()
        hub.setActive("ui", true)
    }

    override fun onStop() {
        super.onStop()
        hub.setActive("ui", false)
    }

    private fun acceptDebugPairing(intent: Intent?) {
        val text = DebugHooks.pairingText(intent) ?: return
        when (val r = PairingInfo.parse(text)) {
            is PairingResult.Ok -> hub.setPairing(r.info)
            is PairingResult.Invalid -> Toast.makeText(this, r.message, Toast.LENGTH_LONG).show()
        }
    }
}
