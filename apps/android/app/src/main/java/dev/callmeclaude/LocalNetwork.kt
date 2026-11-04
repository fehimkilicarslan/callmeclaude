package dev.callmeclaude

/**
 * Android 17 local network protection, as plain Kotlin so it can be unit tested.
 *
 * Apps targeting SDK 37 need the ACCESS_LOCAL_NETWORK runtime permission (NEARBY_DEVICES group) to
 * open TCP connections to LAN addresses. Without it the connection doesn't fail, it just times out,
 * so the hub client alone can only say "Can't reach your computer". This picks the clearer state.
 * Loopback (`adb reverse`) is not restricted, which is why earlier device tests didn't notice.
 */
enum class LocalNetworkAccess {
    /** Below Android 17: INTERNET still covers the LAN. */
    NOT_REQUIRED,
    GRANTED,
    /** Denied, but the system dialog can still be shown. */
    DENIED,
    /** Denied and the system won't show the dialog again: only the app settings can fix it. */
    BLOCKED,
}

const val LOCAL_NETWORK_MIN_SDK = 37

/** `Manifest.permission.ACCESS_LOCAL_NETWORK` (API 37); spelled out so minSdk 29 code can name it. */
const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

const val LOCAL_NETWORK_RATIONALE = "CallMeClaude needs local network access to reach the hub on your computer."

/**
 * [blockedAfterRequest]: the last request in this app launch came back denied and the system said
 * there's no point showing a rationale (shouldShowRequestPermissionRationale == false), i.e. it
 * didn't show the dialog. It isn't persisted: the platform may reset the denial counter for this
 * permission, so each launch starts by asking again.
 */
fun localNetworkAccess(sdkInt: Int, granted: Boolean, blockedAfterRequest: Boolean): LocalNetworkAccess = when {
    sdkInt < LOCAL_NETWORK_MIN_SDK -> LocalNetworkAccess.NOT_REQUIRED
    granted -> LocalNetworkAccess.GRANTED
    blockedAfterRequest -> LocalNetworkAccess.BLOCKED
    else -> LocalNetworkAccess.DENIED
}

sealed interface ConnectionView {
    data class Connected(val name: String) : ConnectionView

    /** The hub client's own status ("Connecting…", "Can't reach your computer", …). */
    data class Offline(val status: String) : ConnectionView

    /** Not connected and the local network permission is missing. [canAsk]: the system dialog may still appear. */
    data class NeedsLocalNetwork(val canAsk: Boolean) : ConnectionView
}

/**
 * A live connection always wins (e.g. over Tailscale, if the permission doesn't apply there). Not
 * connected without the permission → say so instead of the generic timeout message.
 */
fun connectionView(connected: Boolean, status: String, name: String?, access: LocalNetworkAccess): ConnectionView = when {
    connected -> ConnectionView.Connected(name ?: "computer")
    access == LocalNetworkAccess.DENIED -> ConnectionView.NeedsLocalNetwork(canAsk = true)
    access == LocalNetworkAccess.BLOCKED -> ConnectionView.NeedsLocalNetwork(canAsk = false)
    else -> ConnectionView.Offline(status)
}
