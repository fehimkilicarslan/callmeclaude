package dev.callmeclaude.calls

import android.os.Build
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
    private var endpoints: List<Any> = emptyList()   // CallEndpoint on API 34+
    private var current: Any? = null
    private var telecomMuted: Boolean? = null
    private var routeKnown = false

    init {
        connectionProperties = PROPERTY_SELF_MANAGED
        connectionCapabilities = CAPABILITY_MUTE
        audioModeIsVoip = true
        setAddress(android.net.Uri.fromParts("sip", "claude", null), android.telecom.TelecomManager.PRESENTATION_ALLOWED)
    }

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

    @Deprecated("Replaced by onCallEndpointChanged / onMuteStateChanged on API 34+")
    override fun onCallAudioStateChanged(state: CallAudioState) {
        if (Build.VERSION.SDK_INT >= 34) return
        muteChanged(state.isMuted)
        firstRoute()
    }

    override fun onMuteStateChanged(isMuted: Boolean) = muteChanged(isMuted)

    override fun onAvailableCallEndpointsChanged(available: List<CallEndpoint>) {
        endpoints = available
        firstRoute()
    }

    @TargetApi(34) // only called on API 34+
    @SuppressLint("UseRequiresApi")
    override fun onCallEndpointChanged(endpoint: CallEndpoint) {
        current = endpoint
        Log.d(TAG, "audio endpoint: ${endpoint.endpointName} (type ${endpoint.endpointType})")
    }

    private fun firstRoute() {
        if (routeKnown) return
        if (Build.VERSION.SDK_INT >= 34 && endpoints.isEmpty()) return
        routeKnown = true
        calls.routeReady(this)
    }

    /** Loudspeaker on, or off = Bluetooth / wired headset / earpiece (in that order, like iOS). */
    fun route(speaker: Boolean) {
        if (Build.VERSION.SDK_INT >= 34) routeEndpoint(speaker) else routeLegacy(speaker)
    }

    @TargetApi(34) // caller checks SDK_INT
    @SuppressLint("UseRequiresApi")
    private fun routeEndpoint(speaker: Boolean) {
        val eps = endpoints.filterIsInstance<CallEndpoint>()
        fun of(type: Int) = eps.firstOrNull { it.endpointType == type }
        val target = if (speaker) {
            of(CallEndpoint.TYPE_SPEAKER)
        } else {
            of(CallEndpoint.TYPE_BLUETOOTH) ?: of(CallEndpoint.TYPE_WIRED_HEADSET) ?: of(CallEndpoint.TYPE_EARPIECE)
        } ?: return
        if (target == current) return
        requestCallEndpointChange(
            target,
            { it.run() },
            object : OutcomeReceiver<Void, CallEndpointException> {
                override fun onResult(result: Void?) = Unit
                override fun onError(error: CallEndpointException) {
                    Log.w(TAG, "endpoint change to ${target.endpointName} failed: ${error.code}")
                }
            },
        )
    }

    @Suppress("DEPRECATION")
    private fun routeLegacy(speaker: Boolean) {
        val mask = callAudioState?.supportedRouteMask ?: 0
        setAudioRoute(
            when {
                speaker -> CallAudioState.ROUTE_SPEAKER
                mask and CallAudioState.ROUTE_BLUETOOTH != 0 -> CallAudioState.ROUTE_BLUETOOTH
                else -> CallAudioState.ROUTE_WIRED_OR_EARPIECE
            },
        )
    }

    private companion object {
        const val TAG = "cmc.telecom"
    }
}
