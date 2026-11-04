package dev.callmeclaude.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import dev.callmeclaude.ACCESS_LOCAL_NETWORK
import dev.callmeclaude.LOCAL_NETWORK_MIN_SDK
import dev.callmeclaude.LocalNetworkAccess
import dev.callmeclaude.localNetworkAccess

/**
 * Runtime permissions the app asks for after pairing: the microphone, notifications for the ringing
 * UI (Android 13+), and local network access to reach the hub by LAN address (Android 17+).
 */
fun callPermissions(): Array<String> = buildList {
    add(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    if (Build.VERSION.SDK_INT >= LOCAL_NETWORK_MIN_SDK) add(ACCESS_LOCAL_NETWORK)
}.toTypedArray()

fun missingCallPermissions(context: Context): List<String> =
    callPermissions().filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

fun hasLocalNetworkPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < LOCAL_NETWORK_MIN_SDK ||
        context.checkSelfPermission(ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED

fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

/** Asks once per app launch, right after the home screen first appears (i.e. after pairing). */
@Composable
fun AskCallPermissionsOnce(onResult: (Map<String, Boolean>) -> Unit = {}) {
    val context = LocalContext.current
    var asked by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions(), onResult)
    LaunchedEffect(Unit) {
        if (asked) return@LaunchedEffect
        asked = true
        val missing = missingCallPermissions(context)
        if (missing.isNotEmpty()) launcher.launch(missing.toTypedArray())
    }
}

class LocalNetworkState(
    val access: LocalNetworkAccess,
    val request: () -> Unit,
    /** Feed a request result in (also from [AskCallPermissionsOnce]). */
    val onResult: (Boolean) -> Unit,
)

/**
 * Tracks ACCESS_LOCAL_NETWORK. Re-checked on every resume and whenever [recheckKey] changes (the hub
 * status cycles while it can't connect), so a grant or revoke from the settings shows up without a
 * restart. "Blocked" lives only for this launch: the platform resets the denial counter for this
 * permission, so the next launch tries the system dialog again before pointing at the settings.
 */
@Composable
fun rememberLocalNetworkState(recheckKey: Any?, onGranted: () -> Unit): LocalNetworkState {
    val context = LocalContext.current
    val activity = LocalActivity.current
    var resumes by remember { mutableIntStateOf(0) }
    var blocked by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        resumes++
        onPauseOrDispose {}
    }
    val granted = remember(resumes, recheckKey, blocked) { hasLocalNetworkPermission(context) }
    val onResult: (Boolean) -> Unit = { ok ->
        blocked = !ok && activity?.shouldShowRequestPermissionRationale(ACCESS_LOCAL_NETWORK) == false
        resumes++
        if (ok) onGranted()
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(), onResult)
    return LocalNetworkState(
        access = localNetworkAccess(Build.VERSION.SDK_INT, granted, blocked),
        request = { launcher.launch(ACCESS_LOCAL_NETWORK) },
        onResult = onResult,
    )
}
