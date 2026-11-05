package dev.callmeclaude

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * The optional "Call Claude" app-list entry (an activity-alias of [CallClaudeActivity], off by
 * default). Routines and voice assistants can only open an app's launcher entry; this one calls.
 * Its state lives in PackageManager only.
 */
object LauncherEntry {
    private fun component(context: Context) = ComponentName(context, "dev.callmeclaude.CallClaudeEntry")

    fun isEnabled(context: Context): Boolean {
        val pm = context.packageManager
        val c = component(context)
        return when (pm.getComponentEnabledSetting(c)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> runCatching {
                pm.getActivityInfo(c, PackageManager.MATCH_DISABLED_COMPONENTS).enabled
            }.getOrDefault(false)
            else -> false
        }
    }

    fun setEnabled(context: Context, on: Boolean) {
        context.packageManager.setComponentEnabledSetting(
            component(context),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP,
        )
        AppLog.i("cmc.quick", "launcher entry ${if (on) "on" else "off"}")
    }
}
