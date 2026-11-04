package dev.callmeclaude.calls

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.callmeclaude.CallMeClaudeApp
import dev.callmeclaude.ui.CallScreen
import dev.callmeclaude.ui.CmcTheme
import kotlinx.coroutines.launch

/** The ringing / in-call screen. Shown over the lock screen (full-screen intent, notification taps). */
class CallActivity : ComponentActivity() {
    private val calls get() = (application as CallMeClaudeApp).calls

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        handle(intent)
        setContent { CmcTheme { CallScreen(calls) } }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                calls.ui.collect { if (it == null) finish() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        if (intent?.action == ACTION_ANSWER) calls.answer()
    }

    companion object {
        private const val ACTION_ANSWER = "dev.callmeclaude.ANSWER"

        fun pendingIntent(context: Context, answer: Boolean): PendingIntent = PendingIntent.getActivity(
            context,
            if (answer) 2 else 1,
            Intent(context, CallActivity::class.java)
                .setAction(if (answer) ACTION_ANSWER else Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
