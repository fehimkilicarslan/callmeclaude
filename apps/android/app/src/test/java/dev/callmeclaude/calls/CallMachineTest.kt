package dev.callmeclaude.calls

import dev.callmeclaude.calls.CallMachine.Direction
import dev.callmeclaude.calls.CallMachine.Effect
import dev.callmeclaude.calls.CallMachine.EndCause
import dev.callmeclaude.calls.CallMachine.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the flow in apps/ios/CallMeClaude/CallManager.swift. */
class CallMachineTest {
    private var now = 1_000L
    private val m = CallMachine { now }

    private fun connected() = m.handle(Event.HubConnected)

    private fun ringing(callId: String = "c_hub1"): List<Effect> {
        connected()
        return m.handle(Event.Incoming(callId, "acme-web"))
    }

    @Test fun `incoming call rings and schedules the missed-call timeout`() {
        val fx = ringing()
        assertEquals(
            listOf(Effect.ReportIncoming("c_hub1", "acme-web"), Effect.Schedule(Event.RingTimeout("c_hub1"), 50_000)),
            fx,
        )
        assertEquals(Direction.OUTBOUND, m.active?.direction)
    }

    @Test fun `answering sends call start with the same callId as outbound`() {
        ringing()
        val fx = m.handle(Event.Begin("c_hub1"))
        assertEquals(
            listOf(
                Effect.SetConnectionActive("c_hub1"),
                Effect.StartAudio,
                Effect.Schedule(Event.ReadyTimeout("c_hub1"), 15_000),
                Effect.SendStart("c_hub1", Direction.OUTBOUND),
            ),
            fx,
        )
        // Telecom and our own UI may both report the answer: only once.
        assertEquals(emptyList<Effect>(), m.handle(Event.Begin("c_hub1")))
    }

    @Test fun `placing a call uses a fresh callId and inbound direction`() {
        connected()
        val id = CallMachine.newCallId("ABCDEF12-3456-7890-abcd-ef1234567890")
        assertEquals("c_abcdef12", id)
        assertEquals(listOf(Effect.PlaceOutgoing(id)), m.handle(Event.Place(id)))
        val fx = m.handle(Event.Begin(id))
        assertEquals(Effect.SendStart(id, Direction.INBOUND), fx.last())
        assertTrue(Effect.SetConnectionActive(id) !in fx) // only once the hub is ready
        val ready = m.handle(Event.Ready(id))
        assertEquals(listOf(Effect.SetConnectionActive(id)), ready)
        assertEquals(now, m.active?.connectedAt)
    }

    @Test fun `reconnecting is shown only for a talking call whose link dropped`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        m.handle(Event.HubDisconnected)
        assertFalse(m.reconnecting) // not talking yet: the screen still says "Connecting…"
        m.handle(Event.HubConnected)
        m.handle(Event.Ready("c_hub1"))
        assertFalse(m.reconnecting)
        m.handle(Event.HubDisconnected)
        assertTrue(m.reconnecting)
        // Back: call.start goes out again on the new link (the hub re-attaches) and the label clears.
        assertEquals(listOf(Effect.SendStart("c_hub1", Direction.OUTBOUND)), m.handle(Event.HubConnected))
        assertFalse(m.reconnecting)
    }

    @Test fun `generated callIds match the iOS format`() {
        repeat(20) { assertTrue(CallMachine.newCallId().matches(Regex("c_[0-9a-f]{8}"))) }
    }

    @Test fun `messages for another callId are ignored`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        assertEquals(emptyList<Effect>(), m.handle(Event.Ready("c_other")))
        assertEquals(emptyList<Effect>(), m.handle(Event.HubEnded("c_other", "phone-hangup")))
        assertEquals("c_hub1", m.active?.callId)
        assertEquals(false, m.active?.ready)
    }

    @Test fun `busy - a second incoming call is ended, the same one again is ignored`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        assertEquals(listOf(Effect.SendEnd("c_hub2")), m.handle(Event.Incoming("c_hub2", "x")))
        // The hub re-announces a ringing call after a reconnect.
        assertEquals(emptyList<Effect>(), m.handle(Event.Incoming("c_hub1", "Claude")))
        assertEquals("c_hub1", m.active?.callId)
    }

    @Test fun `reconnect during a call re-sends call start with the same callId and direction`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        m.handle(Event.Ready("c_hub1"))
        assertEquals(emptyList<Effect>(), m.handle(Event.HubDisconnected))
        assertEquals(listOf(Effect.SendStart("c_hub1", Direction.OUTBOUND)), m.handle(Event.HubConnected))
        // A second hello confirmation on the same link does not send it twice.
        assertEquals(emptyList<Effect>(), m.handle(Event.HubConnected))
    }

    @Test fun `reconnect while only ringing sends nothing`() {
        ringing()
        m.handle(Event.HubDisconnected)
        assertEquals(emptyList<Effect>(), m.handle(Event.HubConnected))
    }

    @Test fun `answering while disconnected waits for the link`() {
        m.handle(Event.Incoming("c_hub1", ""))
        val fx = m.handle(Event.Begin("c_hub1"))
        assertEquals(Effect.EnsureConnected("c_hub1"), fx.last())
        assertTrue(fx.none { it is Effect.SendStart })
        assertEquals(listOf(Effect.SendStart("c_hub1", Direction.OUTBOUND)), m.handle(Event.HubConnected))
    }

    @Test fun `no call ready within 15 s - unreachable, then hang up`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        now += 15_000
        val fx = m.handle(Event.ReadyTimeout("c_hub1"))
        assertEquals(
            listOf(Effect.Unreachable("c_hub1"), Effect.Schedule(Event.HangUp("c_hub1"), 6_000)),
            fx,
        )
        // A late reconnect must not start the conversation any more.
        m.handle(Event.HubDisconnected)
        assertEquals(emptyList<Effect>(), m.handle(Event.HubConnected))
        val end = m.handle(Event.HangUp("c_hub1"))
        assertEquals(
            listOf(Effect.SendEnd("c_hub1"), Effect.StopAudio, Effect.EndConnection("c_hub1", EndCause.LOCAL)),
            end,
        )
        assertNull(m.active)
    }

    @Test fun `ready timeout after ready, or for an old call, does nothing`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        m.handle(Event.Ready("c_hub1"))
        assertEquals(emptyList<Effect>(), m.handle(Event.ReadyTimeout("c_hub1")))
        assertEquals(emptyList<Effect>(), m.handle(Event.ReadyTimeout("c_old")))
    }

    @Test fun `hub unreachable when connecting for the call`() {
        connected()
        m.handle(Event.HubDisconnected)
        m.handle(Event.Place("c_me"))
        m.handle(Event.Begin("c_me"))
        assertEquals(Effect.Unreachable("c_me"), m.handle(Event.HubUnreachable("c_me")).first())
        // Only once, even if the 15 s timer fires as well.
        assertEquals(emptyList<Effect>(), m.handle(Event.ReadyTimeout("c_me")))
    }

    @Test fun `user hangs up - call end is sent and audio stops`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        m.handle(Event.Ready("c_hub1"))
        assertEquals(
            listOf(Effect.SendEnd("c_hub1"), Effect.StopAudio, Effect.EndConnection("c_hub1", EndCause.LOCAL)),
            m.handle(Event.HangUp()),
        )
        assertNull(m.active)
        assertEquals(emptyList<Effect>(), m.handle(Event.HangUp()))
    }

    @Test fun `hub ended - clean up without sending anything`() {
        ringing()
        m.handle(Event.Begin("c_hub1"))
        assertEquals(
            listOf(Effect.StopAudio, Effect.EndConnection("c_hub1", EndCause.REMOTE)),
            m.handle(Event.HubEnded("c_hub1", "phone-hangup")),
        )
        ringing("c_hub2")
        m.handle(Event.Begin("c_hub2"))
        assertEquals(
            listOf(Effect.StopAudio, Effect.EndConnection("c_hub2", EndCause.ERROR)),
            m.handle(Event.HubEnded("c_hub2", "voice-error")),
        )
    }

    @Test fun `declining a ringing call sends call end`() {
        ringing()
        assertEquals(
            listOf(Effect.SendEnd("c_hub1"), Effect.EndConnection("c_hub1", EndCause.REJECTED)),
            m.handle(Event.Reject("c_hub1")),
        )
        assertNull(m.active)
    }

    @Test fun `unanswered call stops ringing after 50 s`() {
        ringing()
        assertEquals(
            listOf(Effect.SendEnd("c_hub1"), Effect.EndConnection("c_hub1", EndCause.MISSED)),
            m.handle(Event.RingTimeout("c_hub1")),
        )
        ringing("c_hub2")
        m.handle(Event.Begin("c_hub2"))
        assertEquals(emptyList<Effect>(), m.handle(Event.RingTimeout("c_hub2")))
    }

    @Test fun `telecom refusing the call clears it without ending a connection`() {
        ringing()
        assertEquals(emptyList<Effect>(), m.handle(Event.TelecomFailed("c_hub1")))
        assertNull(m.active)
    }

    @Test fun `placing while busy is ignored, unless the call is stuck`() {
        connected()
        m.handle(Event.Place("c_a"))
        m.handle(Event.Begin("c_a"))
        assertEquals(emptyList<Effect>(), m.handle(Event.Place("c_b")))
        now += 21_000
        val fx = m.handle(Event.Place("c_b"))
        assertEquals(
            listOf(Effect.StopAudio, Effect.EndConnection("c_a", EndCause.ERROR), Effect.PlaceOutgoing("c_b")),
            fx,
        )
        assertEquals("c_b", m.active?.callId)
    }
}
