package dev.callmeclaude

/**
 * When to (re)connect to the hub. Pure Kotlin: [HubClient] feeds it what happened (an attempt
 * started/failed, the socket dropped, the default network changed, a liveness tick) and carries
 * out the effects it returns; tests drive it directly with a fake clock.
 *
 * Idle, the timings are the iOS ones (HubClient.swift). During a call the hub keeps the
 * conversation for 20 s after the phone vanishes (apps/mac-agent/src/voice/call.ts: detach(), and
 * checkSilence()'s "phone-lost" after 20 s without microphone audio), so everything is tighter:
 *  - the network callback closes a socket whose network is gone right away and reconnects the
 *    moment a network is back, cancelling any pending back-off;
 *  - a Wi-Fi ↔ mobile data switch reconnects immediately;
 *  - an app-level ping every [CALL_TICK_MS] notices a dead link that the network callback can't see
 *    (same network, path gone) after [CALL_SILENCE_MS] instead of OkHttp's 8–16 s ping timeout;
 *  - attempts give up sooner and are retried sooner, and a race where every address failed fast
 *    retries without waiting for the attempt timeout.
 */
class LinkPolicy {

    enum class Link { DOWN, CONNECTING, UP }

    data class Timing(
        /** Give up on an address race after this long. */
        val attemptTimeoutMs: Long,
        /** Wait this long after a failed race. */
        val retryAfterFailureMs: Long,
        /** Wait this long after an established connection dropped (0 = reconnect now). */
        val retryAfterDropMs: Long,
    )

    sealed interface Effect {
        /** Abandon any running race and race all addresses now; fail it after [timeoutMs]. */
        data class Connect(val timeoutMs: Long) : Effect
        /** Close the established socket (dead network / silent link) and report the link as down. */
        data object Close : Effect
        /** (Re)arm the single retry timer; it reports [retryFired]. Replaces a pending one. */
        data class RetryIn(val ms: Long) : Effect
        data object CancelRetry : Effect
        /** Send an app-level ping; the hub answers with a heartbeat. */
        data object Ping : Effect
    }

    var link = Link.DOWN
        private set
    var inCall = false
        private set
    /** The current default network as reported by the system (null = none / not known yet). */
    var network: String? = null
        private set
    /** The default network when the current socket connected. */
    var socketNetwork: String? = null
        private set
    var retryPending = false
        private set
    /**
     * The hub closed the socket with [BAD_TOKEN]: the pairing is no longer valid. Retrying can't fix
     * that, so nothing reconnects until a new pairing is set ([paired]).
     */
    var rejected = false
        private set

    val timing: Timing get() = if (inCall) CALL else IDLE

    /** Something needs the link (UI, service, call, a waiter). */
    fun connectRequested(): List<Effect> = if (link == Link.DOWN && !rejected) connectNow() else emptyList()

    /** A (new) pairing was stored: forget an earlier rejection. */
    fun paired() {
        rejected = false
    }

    /**
     * The hub answered with close code [BAD_TOKEN] (on the winning socket or on any racing address:
     * a hub that answers at all is authoritative about its token). Stop everything and stay down.
     */
    fun tokenRejected(): List<Effect> {
        val wasUp = link == Link.UP
        rejected = true
        link = Link.DOWN
        return (if (wasUp) listOf(Effect.Close) else emptyList()) + cancelRetry()
    }

    /** The link isn't wanted any more (or can't be: not paired); a Connect was not carried out. */
    fun stopped(): List<Effect> {
        link = Link.DOWN
        return cancelRetry()
    }

    fun callChanged(active: Boolean) {
        inCall = active
    }

    /** The hub said hello on the winning socket. */
    fun connected(): List<Effect> {
        link = Link.UP
        socketNetwork = network
        return cancelRetry()
    }

    /** No address answered within the attempt timeout. */
    fun attemptTimedOut(): List<Effect> {
        if (link != Link.CONNECTING) return emptyList()
        link = Link.DOWN
        return retryIn(timing.retryAfterFailureMs)
    }

    /** Every address of the race failed before the timeout (refused, unreachable, DNS…). */
    fun allAddressesFailed(): List<Effect> {
        // Idle: keep the iOS behaviour and let the attempt timeout handle it.
        if (link != Link.CONNECTING || !inCall) return emptyList()
        link = Link.DOWN
        return retryIn(timing.retryAfterFailureMs)
    }

    /** The established socket failed or was closed by the hub. */
    fun dropped(): List<Effect> {
        if (link != Link.UP) return emptyList()
        link = Link.DOWN
        val wait = timing.retryAfterDropMs
        return if (wait <= 0) connectNow() else retryIn(wait)
    }

    fun retryFired(): List<Effect> {
        retryPending = false
        return if (link == Link.DOWN && !rejected) connectNow() else emptyList()
    }

    /** The system has no default network any more. */
    fun networkLost(): List<Effect> {
        network = null
        return when (link) {
            // The socket is bound to the network that just went away: don't wait for a ping timeout.
            Link.UP -> {
                link = Link.DOWN
                listOf(Effect.Close) + retryIn(timing.retryAfterFailureMs)
            }
            // Let the running race fail; a new network will restart it.
            Link.CONNECTING, Link.DOWN -> emptyList()
        }
    }

    /** A default network is up: the first one, the same one again, or a different one (Wi-Fi ↔ mobile). */
    fun networkAvailable(id: String): List<Effect> {
        val before = network
        network = id
        return when (link) {
            // Waiting out a back-off: the network is back, go now (unless the token was refused).
            Link.DOWN -> if (rejected) emptyList() else connectNow()
            // A race started on another (or no) network is doomed: restart it on this one.
            Link.CONNECTING -> if (before != id) connectNow() else emptyList()
            Link.UP -> when {
                socketNetwork == null -> {
                    socketNetwork = id
                    emptyList()
                }
                // Idle, keep the iOS behaviour (the ping notices if the old path is dead).
                socketNetwork != id && inCall -> listOf(Effect.Close) + connectNow()
                else -> emptyList()
            }
        }
    }

    /**
     * Liveness during a call, every [CALL_TICK_MS]: ping, and treat the link as dead when nothing
     * (audio, heartbeat) arrived for [CALL_SILENCE_MS].
     */
    fun tick(nowMs: Long, lastReceivedMs: Long): List<Effect> {
        if (link != Link.UP || !inCall) return emptyList()
        if (nowMs - lastReceivedMs > CALL_SILENCE_MS) {
            link = Link.DOWN
            return listOf(Effect.Close) + connectNow()
        }
        return listOf(Effect.Ping)
    }

    private fun connectNow(): List<Effect> {
        link = Link.CONNECTING
        return cancelRetry() + Effect.Connect(timing.attemptTimeoutMs)
    }

    private fun retryIn(ms: Long): List<Effect> {
        retryPending = true
        return listOf(Effect.RetryIn(ms))
    }

    private fun cancelRetry(): List<Effect> {
        if (!retryPending) return emptyList()
        retryPending = false
        return listOf(Effect.CancelRetry)
    }

    companion object {
        /** iOS HubClient.swift: 7 s race, 3 s after a failed race, 0.5 s after a drop. */
        val IDLE = Timing(attemptTimeoutMs = 7_000, retryAfterFailureMs = 3_000, retryAfterDropMs = 500)
        val CALL = Timing(attemptTimeoutMs = 4_000, retryAfterFailureMs = 1_000, retryAfterDropMs = 0)

        /** WebSocket close code the hub uses for a wrong app token (apps/mac-agent/src/appServer.ts). */
        const val BAD_TOKEN = 4003

        const val CALL_TICK_MS = 2_000L
        const val CALL_SILENCE_MS = 6_000L

        /** How long the hub keeps a call whose phone vanished (apps/mac-agent/src/voice/call.ts). */
        const val HUB_GRACE_MS = 20_000L
    }
}
