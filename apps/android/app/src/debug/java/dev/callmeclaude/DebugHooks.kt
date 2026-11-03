package dev.callmeclaude

import android.content.Intent

/**
 * Debug builds only (the release source set has a no-op twin). Lets tests pair without a camera:
 *   adb shell am start -n dev.callmeclaude/.MainActivity --es pairing '<json>'
 */
object DebugHooks {
    fun pairingText(intent: Intent?): String? = intent?.getStringExtra("pairing")
}
