package dev.callmeclaude.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** Runtime permissions a call needs: the microphone, and notifications for the ringing UI (Android 13+). */
fun callPermissions(): Array<String> = buildList {
    add(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

fun missingCallPermissions(context: Context): List<String> =
    callPermissions().filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

/** Asks once per app launch, right after the home screen first appears (i.e. after pairing). */
@Composable
fun AskCallPermissionsOnce() {
    val context = LocalContext.current
    var asked by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
    LaunchedEffect(Unit) {
        if (asked) return@LaunchedEffect
        asked = true
        val missing = missingCallPermissions(context)
        if (missing.isNotEmpty()) launcher.launch(missing.toTypedArray())
    }
}
