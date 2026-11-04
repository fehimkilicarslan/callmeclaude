package dev.callmeclaude.calls

import android.bluetooth.BluetoothDevice
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.OutcomeReceiver
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import android.annotation.SuppressLint
import android.annotation.TargetApi
import dev.callmeclaude.CallMeClaudeApp

/** Self-managed: Telecom arbitrates audio focus/routing and Bluetooth buttons; the UI is ours. */
class CmcConnectionService : ConnectionService() {
    private val calls get() = (application as CallMeClaudeApp).calls

    override fun onCreateIncomingConnection(account: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        val callId = callIdOf(request, TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
        return calls.createIncoming(callId) ?: failed("no matching incoming call $callId")
    }

    override fun onCreateIncomingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest) {
        val callId = callIdOf(request, TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
        Log.w(TAG, "incoming connection refused by Telecom: $callId")
        calls.connectionFailed(callId)
    }

    override fun onCreateOutgoingConnection(account: PhoneAccountHandle?, request: ConnectionRequest): Connection {
        val callId = callIdOf(request, TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)
        return calls.createOutgoing(callId) ?: failed("no matching outgoing call $callId")
    }

    override fun onCreateOutgoingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest) {
        val callId = callIdOf(request, TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)
        Log.w(TAG, "outgoing connection refused by Telecom: $callId")
        calls.connectionFailed(callId)
    }

    /**
     * AOSP flattens the incoming/outgoing call extras into the request extras; some builds
     * (One UI 9 here) keep them nested. Null means "not found": [CallManager] then takes its one
     * pending call, since there is never more than one.
     */
    private fun callIdOf(request: ConnectionRequest, nestedKey: String): String? {
        val x = request.extras ?: return null
        @Suppress("DEPRECATION")
        return x.getString(CallManager.EXTRA_CALL_ID) ?: x.getBundle(nestedKey)?.getString(CallManager.EXTRA_CALL_ID)
    }

    private fun failed(why: String): Connection {
        Log.w(TAG, why)
        return Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR, why))
    }

    private companion object {
        const val TAG = "cmc.telecom"
    }
}

class CmcConnection(private val calls: CallManager, val callId: String) : Connection() {
    private val router = AudioRouter()
    private var endpoints: Map<String, Any> = emptyMap()   // AudioRoute.id → CallEndpoint (API 34+)
    private var btDevices: Map<String, BluetoothDevice> = emptyMap()   // AudioRoute.id → device (API 29–33)
    private var telecomMuted: Boolean? = null
    private var routeKnown = false
    private val startedAt = SystemClock.elapsedRealtime()
    private val main = Handler(Looper.getMainLooper())

    init {
        connectionProperties = PROPERTY_SELF_MANAGED
        connectionCapabilities = CAPABILITY_MUTE
        audioModeIsVoip = true
        setAddress(android.net.Uri.fromParts("sip", "claude", null), android.telecom.TelecomManager.PRESENTATION_ALLOWED)
    }

    val routes: AudioRoutesUi get() = router.ui

    override fun onShowIncomingCallUi() = calls.showIncomingUi(callId)
    override fun onAnswer() = calls.telecomAnswered(callId)
    override fun onAnswer(videoState: Int) = onAnswer()
    override fun onReject() = calls.telecomRejected(callId)
    override fun onDisconnect() = calls.telecomDisconnect(callId)
    override fun onAbort() = calls.telecomDisconnect(callId)
    override fun onSilence() = calls.silenceRinger(callId)

    // Mute: the app mutes itself (silence frames); Telecom only tells us about outside toggles.
    private fun muteChanged(on: Boolean) {
        val before = telecomMuted
        telecomMuted = on
        if (before != null && before != on) calls.telecomMute(on)
    }

    override fun onMuteStateChanged(isMuted: Boolean) = muteChanged(isMuted)

    // region routes reported by Telecom

    @Deprecated("Replaced by onCallEndpointChanged / onAvailableCallEndpointsChanged / onMuteStateChanged on API 34+")
    override fun onCallAudioStateChanged(state: CallAudioState) {
        if (Build.VERSION.SDK_INT >= 34) return
        muteChanged(state.isMuted)
        val (routes, current) = legacyRoutes(state)
        routesChanged(routes, current)
    }

    @TargetApi(34) // only called on API 34+
    @SuppressLint("UseRequiresApi")
    override fun onAvailableCallEndpointsChanged(available: List<CallEndpoint>) {
        val routes = available.map(::routeOf)
        endpoints = routes.zip(available).associate { (r, e) -> r.id to e }
        routesChanged(routes, router.current)
    }

    @TargetApi(34) // only called on API 34+
    @SuppressLint("UseRequiresApi")
    override fun onCallEndpointChanged(endpoint: CallEndpoint) {
        routesChanged(router.available, routeOf(endpoint))
    }

    private fun routesChanged(available: List<AudioRoute>, current: AudioRoute?) {
        val before = router.current
        router.update(available, current, SystemClock.elapsedRealtime())
        // Let a burst of Telecom updates settle, then undo a switch Telecom made on its own.
        main.removeCallbacks(guardCheck)
        main.postDelayed(guardCheck, GUARD_SETTLE_MS)
        val t = SystemClock.elapsedRealtime() - startedAt
        Log.d(TAG, "routes +${t}ms: " + available.joinToString { describe(it, it.id == router.current?.id) } +
            (if (router.current?.id != before?.id) " | now ${router.current?.kind}" else ""))
        calls.routesChanged(this)
        firstRoute()
    }

    private val guardCheck = Runnable {
        router.guard(SystemClock.elapsedRealtime())?.let {
            Log.d(TAG, "Telecom left its initial route on its own: back to ${it.kind}")
            request(it)
        }
    }

    private fun firstRoute() {
        if (routeKnown || router.available.isEmpty() || router.current == null) return
        routeKnown = true
        Log.d(TAG, "Telecom's initial route: ${router.initial?.kind} " +
            "(bluetooth devices available: ${router.available.count { it.kind == AudioRoute.Kind.BLUETOOTH }})")
        calls.routeReady(this)
    }

    // endregion

    // region route requests

    /** Loudspeaker shortcut: on, or back to the route that was active before it. */
    fun speaker(on: Boolean) = router.speaker(on)?.let(::request)

    /** A route from the picker ([AudioRoute.id]). */
    fun select(id: String) = router.select(id)?.let(::request)

    private fun request(target: AudioRoute) {
        Log.d(TAG, "requesting route ${target.kind}")
        if (Build.VERSION.SDK_INT >= 34) requestEndpoint(target) else requestLegacy(target)
    }

    @TargetApi(34) // caller checks SDK_INT
    @SuppressLint("UseRequiresApi")
    private fun requestEndpoint(target: AudioRoute) {
        val ep = endpoints[target.id] as? CallEndpoint ?: return
        requestCallEndpointChange(
            ep,
            { it.run() },
            object : OutcomeReceiver<Void, CallEndpointException> {
                override fun onResult(result: Void?) = Unit
                override fun onError(error: CallEndpointException) {
                    Log.w(TAG, "endpoint change to ${target.kind} failed: ${error.code}")
                }
            },
        )
    }

    @Suppress("DEPRECATION")
    private fun requestLegacy(target: AudioRoute) {
        when (target.kind) {
            AudioRoute.Kind.BLUETOOTH -> {
                val d = btDevices[target.id]
                if (d != null) requestBluetoothAudio(d) else setAudioRoute(CallAudioState.ROUTE_BLUETOOTH)
            }
            AudioRoute.Kind.SPEAKER -> setAudioRoute(CallAudioState.ROUTE_SPEAKER)
            AudioRoute.Kind.WIRED -> setAudioRoute(CallAudioState.ROUTE_WIRED_HEADSET)
            AudioRoute.Kind.EARPIECE -> setAudioRoute(CallAudioState.ROUTE_EARPIECE)
            AudioRoute.Kind.STREAMING, AudioRoute.Kind.OTHER -> Unit
        }
    }

    // endregion

    // region mapping

    @TargetApi(34)
    @SuppressLint("UseRequiresApi")
    private fun routeOf(e: CallEndpoint) = AudioRoute(
        id = e.identifier.toString(),
        kind = when (e.endpointType) {
            CallEndpoint.TYPE_EARPIECE -> AudioRoute.Kind.EARPIECE
            CallEndpoint.TYPE_SPEAKER -> AudioRoute.Kind.SPEAKER
            CallEndpoint.TYPE_WIRED_HEADSET -> AudioRoute.Kind.WIRED
            CallEndpoint.TYPE_BLUETOOTH -> AudioRoute.Kind.BLUETOOTH
            CallEndpoint.TYPE_STREAMING -> AudioRoute.Kind.STREAMING
            else -> AudioRoute.Kind.OTHER
        },
        name = e.endpointName.toString(),
    )

    /** API 29–33: one route per bit of the supported mask, one per Bluetooth device. */
    @Suppress("DEPRECATION")
    private fun legacyRoutes(s: CallAudioState): Pair<List<AudioRoute>, AudioRoute?> {
        val mask = s.supportedRouteMask
        val out = mutableListOf<AudioRoute>()
        if (mask and CallAudioState.ROUTE_EARPIECE != 0) out += AudioRoute("earpiece", AudioRoute.Kind.EARPIECE, "Phone")
        if (mask and CallAudioState.ROUTE_WIRED_HEADSET != 0) out += AudioRoute("wired", AudioRoute.Kind.WIRED, "Wired headset")
        if (mask and CallAudioState.ROUTE_SPEAKER != 0) out += AudioRoute("speaker", AudioRoute.Kind.SPEAKER, "Speaker")
        val devices = s.supportedBluetoothDevices.orEmpty()
        val bt = devices.mapIndexed { i, d -> AudioRoute("bt:${d.address}", AudioRoute.Kind.BLUETOOTH, btName(d, i, devices.size)) }
        if (bt.isEmpty() && mask and CallAudioState.ROUTE_BLUETOOTH != 0) out += AudioRoute("bt", AudioRoute.Kind.BLUETOOTH, "Bluetooth")
        out += bt
        btDevices = bt.zip(devices).associate { (r, d) -> r.id to d }
        val current = when (s.route) {
            CallAudioState.ROUTE_EARPIECE -> out.firstOrNull { it.kind == AudioRoute.Kind.EARPIECE }
            CallAudioState.ROUTE_WIRED_HEADSET -> out.firstOrNull { it.kind == AudioRoute.Kind.WIRED }
            CallAudioState.ROUTE_SPEAKER -> out.firstOrNull { it.kind == AudioRoute.Kind.SPEAKER }
            CallAudioState.ROUTE_BLUETOOTH ->
                s.activeBluetoothDevice?.let { a -> out.firstOrNull { it.id == "bt:${a.address}" } }
                    ?: out.firstOrNull { it.kind == AudioRoute.Kind.BLUETOOTH }
            else -> null
        }
        return out to current
    }

    /**
     * BluetoothDevice.getName needs BLUETOOTH (API ≤ 30, granted at install) or the runtime
     * BLUETOOTH_CONNECT (API 31+), which this app does not ask for: fall back to a generic name.
     */
    @SuppressLint("MissingPermission")
    private fun btName(d: BluetoothDevice, i: Int, n: Int): String {
        val name = try {
            d.name
        } catch (_: SecurityException) {
            null
        }
        return name?.takeIf { it.isNotBlank() } ?: if (n > 1) "Bluetooth ${i + 1}" else "Bluetooth"
    }

    /** For logcat: kind and a marker, never the device name or address. */
    private fun describe(r: AudioRoute, active: Boolean) = (if (active) "*" else "") + r.kind.name.lowercase()

    // endregion

    override fun onStateChanged(state: Int) {
        if (state == STATE_DISCONNECTED) main.removeCallbacks(guardCheck)
    }

    private companion object {
        const val TAG = "cmc.telecom"
        const val GUARD_SETTLE_MS = 800L
    }
}
