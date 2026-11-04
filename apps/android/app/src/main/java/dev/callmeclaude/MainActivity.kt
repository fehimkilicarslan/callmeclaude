package dev.callmeclaude

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.callmeclaude.ui.App
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch

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
        setContent { App(hub, (application as CallMeClaudeApp).calls) }
        // Paired → keep the hub connection in the foreground service; unpaired → stop it.
        // Started from here because foreground services can't be started from the background.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                hub.pairing.distinctUntilChangedBy { it != null }.collect { HubService.sync(this@MainActivity, it != null) }
            }
        }
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
