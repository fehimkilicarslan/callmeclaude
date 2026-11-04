package dev.callmeclaude

import dev.callmeclaude.LinkPolicy.Effect
import dev.callmeclaude.LinkPolicy.Link
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkPolicyTest {
    private val p = LinkPolicy()

    private fun up(network: String = "wifi", inCall: Boolean = false) {
        p.callChanged(inCall)
        p.networkAvailable(network)
        p.connectRequested()
        p.connected()
        assertEquals(Link.UP, p.link)
    }

    // region transitions

    @Test
    fun `connect request starts a race once`() {
        assertEquals(listOf(Effect.Connect(7_000)), p.connectRequested())
        assertEquals(Link.CONNECTING, p.link)
        assertEquals(emptyList<Effect>(), p.connectRequested())
    }

    @Test
    fun `idle keeps the iOS timings`() {
        p.connectRequested()
        assertEquals(listOf(Effect.RetryIn(3_000)), p.attemptTimedOut())
        assertEquals(listOf(Effect.Connect(7_000)), p.retryFired())
        // Idle: a fast failure of every address waits for the timeout, like iOS.
        assertEquals(emptyList<Effect>(), p.allAddressesFailed())
        p.connected()
        assertEquals(listOf(Effect.RetryIn(500)), p.dropped())
    }

    @Test
    fun `in a call a drop reconnects immediately and failures retry sooner`() {
        up(inCall = true)
        assertEquals(listOf(Effect.Connect(4_000)), p.dropped())
        assertEquals(listOf(Effect.RetryIn(1_000)), p.allAddressesFailed())
        assertEquals(listOf(Effect.Connect(4_000)), p.retryFired())
        assertEquals(listOf(Effect.RetryIn(1_000)), p.attemptTimedOut())
    }

    @Test
    fun `losing the network closes the socket right away`() {
        up()
        assertEquals(listOf(Effect.Close, Effect.RetryIn(3_000)), p.networkLost())
        assertEquals(Link.DOWN, p.link)
    }

    @Test
    fun `network back cancels the back-off and connects now`() {
        up(inCall = true)
        p.networkLost()
        assertTrue(p.retryPending)
        assertEquals(listOf(Effect.CancelRetry, Effect.Connect(4_000)), p.networkAvailable("wifi"))
        assertEquals(false, p.retryPending)
    }

    @Test
    fun `network back while idle and waiting also connects now`() {
        p.connectRequested()
        p.attemptTimedOut()
        assertEquals(listOf(Effect.CancelRetry, Effect.Connect(7_000)), p.networkAvailable("wifi"))
    }

    @Test
    fun `a race on a network that changed is restarted, the same network is left alone`() {
        p.networkAvailable("wifi")
        p.connectRequested()
        assertEquals(emptyList<Effect>(), p.networkAvailable("wifi"))
        assertEquals(listOf(Effect.Connect(7_000)), p.networkAvailable("cellular"))
    }

    @Test
    fun `wifi to mobile switch during a call reconnects, idle keeps the socket`() {
        up("wifi", inCall = true)
        assertEquals(listOf(Effect.Close, Effect.Connect(4_000)), p.networkAvailable("cellular"))

        val idle = LinkPolicy()
        idle.networkAvailable("wifi")
        idle.connectRequested()
        idle.connected()
        assertEquals(emptyList<Effect>(), idle.networkAvailable("cellular"))
        assertEquals(Link.UP, idle.link)
    }

    @Test
    fun `socket connected before the first network report adopts it`() {
        p.connectRequested()
        p.connected()
        p.callChanged(true)
        assertEquals(emptyList<Effect>(), p.networkAvailable("wifi"))
        assertEquals("wifi", p.socketNetwork)
    }

    @Test
    fun `liveness pings during a call and drops a silent link`() {
        up(inCall = true)
        assertEquals(listOf(Effect.Ping), p.tick(nowMs = 10_000, lastReceivedMs = 9_000))
        assertEquals(listOf(Effect.Ping), p.tick(nowMs = 15_000, lastReceivedMs = 9_000))
        assertEquals(listOf(Effect.Close, Effect.Connect(4_000)), p.tick(nowMs = 15_001, lastReceivedMs = 9_000))
        // Not while idle.
        val idle = LinkPolicy()
        idle.connectRequested()
        idle.connected()
        assertEquals(emptyList<Effect>(), idle.tick(nowMs = 60_000, lastReceivedMs = 0))
    }

    @Test
    fun `stale events are ignored`() {
        assertEquals(emptyList<Effect>(), p.attemptTimedOut())
        assertEquals(emptyList<Effect>(), p.dropped())
        up()
        assertEquals(emptyList<Effect>(), p.retryFired())
        assertEquals(emptyList<Effect>(), p.attemptTimedOut())
    }

    @Test
    fun `stopped cancels a pending retry`() {
        p.connectRequested()
        p.attemptTimedOut()
        assertEquals(listOf(Effect.CancelRetry), p.stopped())
        assertEquals(Link.DOWN, p.link)
    }

    // endregion

    // region timers: a simulated hub/network with a virtual clock

    /**
     * Drives the policy the way [HubClient] does: one retry timer, one attempt timeout per race,
     * a liveness tick every 2 s during a call. [reachable] says whether a race started at time t
     * on the current network reaches the hub; unreachable races fail fast on a missing network
     * and time out otherwise.
     */
    private class Sim(inCall: Boolean, val reachable: (t: Long, network: String?) -> Boolean) {
        val p = LinkPolicy()
        var now = 0L
        private var retryAt: Long? = null
        private var raceEnd: Pair<Long, Boolean>? = null   // time, success
        private var raceTimeoutAt: Long? = null
        private var lastRx = 0L
        private var nextTick = LinkPolicy.CALL_TICK_MS
        val log = mutableListOf<Pair<Long, String>>()
        private val networkChanges = sortedMapOf<Long, String?>()

        init {
            p.callChanged(inCall)
            run(p.connectRequested())
            run(p.networkAvailable("wifi"))
            advanceTo(1_000)
        }

        fun network(at: Long, id: String?) {
            networkChanges[at] = id
        }

        fun run(effects: List<Effect>) = effects.forEach { e ->
            when (e) {
                is Effect.Connect -> {
                    log += now to "connect"
                    raceTimeoutAt = now + e.timeoutMs
                    raceEnd = when {
                        reachable(now, p.network) -> now + 50 to true
                        p.network == null -> now + 20 to false
                        else -> null // packets go nowhere: wait for the timeout
                    }
                }
                Effect.Close -> log += now to "close"
                is Effect.RetryIn -> retryAt = now + e.ms
                Effect.CancelRetry -> retryAt = null
                Effect.Ping -> Unit
            }
        }

        fun advanceTo(t: Long) {
            while (now < t) {
                now += 1
                if (networkChanges.containsKey(now)) {
                    val id = networkChanges[now]
                    log += now to "network ${id ?: "lost"}"
                    run(if (id == null) p.networkLost() else p.networkAvailable(id))
                }
                // Received frames while the link is up and the network carries it.
                if (p.link == Link.UP && reachable(now, p.network)) lastRx = now
                raceEnd?.let { (at, ok) ->
                    if (at == now) {
                        raceEnd = null
                        raceTimeoutAt = null
                        if (ok) {
                            log += now to "connected"
                            lastRx = now
                            run(p.connected())
                        } else {
                            run(p.allAddressesFailed())
                        }
                    }
                }
                if (raceTimeoutAt == now) {
                    raceTimeoutAt = null
                    raceEnd = null
                    run(p.attemptTimedOut())
                }
                if (retryAt == now) {
                    retryAt = null
                    run(p.retryFired())
                }
                if (p.inCall && now >= nextTick) {
                    nextTick += LinkPolicy.CALL_TICK_MS
                    run(p.tick(now, lastRx))
                }
            }
        }

        fun firstAfter(t: Long, what: String) = log.firstOrNull { it.first > t && it.second == what }?.first
    }

    @Test
    fun `wifi off for 5 s with no other network during a call reconnects within 100 ms of it coming back`() {
        val sim = Sim(inCall = true) { t, n -> n == "wifi" && (t < 10_000 || t >= 15_000) }
        sim.network(10_000, null)
        sim.network(15_000, "wifi")
        sim.advanceTo(40_000)
        assertEquals(10_000L, sim.firstAfter(9_999, "close"))
        val back = sim.firstAfter(15_000 - 1, "connected")!!
        assertTrue("reconnected at $back", back <= 15_100)
        // The phone was gone for ~5 s, well inside the hub's 20 s grace.
        assertTrue(back - 10_000 < LinkPolicy.HUB_GRACE_MS)
    }

    @Test
    fun `wifi off with mobile data taking over during a call reconnects as soon as wifi is the default again`() {
        // The LAN hub is unreachable over mobile data: races there time out.
        val sim = Sim(inCall = true) { t, n -> n == "wifi" && (t < 10_000 || t >= 15_000) }
        sim.network(10_000, "cellular")
        sim.network(15_000, "wifi")
        sim.advanceTo(40_000)
        assertEquals(10_000L, sim.firstAfter(9_999, "close"))
        val back = sim.firstAfter(14_999, "connected")!!
        assertTrue("reconnected at $back", back <= 15_100)
    }

    @Test
    fun `a silent link during a call is noticed by the liveness tick within 8 s`() {
        // Same network all along, but the path to the hub dies for 8 s (e.g. the access point hangs).
        // A shorter hiccup that ends before the tick notices is simply survived by TCP.
        val sim = Sim(inCall = true) { t, _ -> t < 10_000 || t >= 18_000 }
        sim.advanceTo(40_000)
        val closed = sim.firstAfter(9_999, "close")!!
        assertTrue("closed at $closed", closed in 16_000..18_000)
        // The race started at 16 s times out at 20 s, the retry at 21 s connects.
        val back = sim.firstAfter(closed, "connected")!!
        assertTrue("reconnected at $back", back <= 21_100 && back - 10_000 < LinkPolicy.HUB_GRACE_MS)
    }

    @Test
    fun `a 12 s silent outage still reconnects inside the hub's grace`() {
        // No network callbacks; the path is dead from 10 s to 22 s. Liveness closes at 16 s, then
        // races of 4 s + 1 s back-off: 16–20 timeout, 21–25 timeout, 26 connects.
        val sim = Sim(inCall = true) { t, _ -> t < 10_000 || t >= 22_000 }
        sim.advanceTo(60_000)
        val back = sim.firstAfter(9_999, "connected")!!
        assertTrue("reconnected at $back", back <= 26_100)
        assertTrue(back - 10_000 < LinkPolicy.HUB_GRACE_MS)
    }

    @Test
    fun `idle keeps the old pacing`() {
        val sim = Sim(inCall = false) { t, n -> n != null && (t < 10_000 || t >= 15_000) }
        sim.network(10_000, null)
        sim.network(15_000, "wifi")
        sim.advanceTo(40_000)
        // Idle still closes on network loss and reconnects when it is back.
        assertEquals(10_000L, sim.firstAfter(9_999, "close"))
        assertTrue(sim.firstAfter(14_999, "connected")!! <= 15_100)
    }

    // endregion
}
