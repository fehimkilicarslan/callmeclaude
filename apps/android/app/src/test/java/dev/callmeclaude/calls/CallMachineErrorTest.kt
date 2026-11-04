package dev.callmeclaude.calls

import dev.callmeclaude.calls.CallMachine.Effect
import dev.callmeclaude.calls.CallMachine.EndCause
import dev.callmeclaude.calls.CallMachine.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The hub's `error` frames: during a call attempt, during a live call, and outside a call. */
class CallMachineErrorTest {
    private var now = 1_000L
    private val m = CallMachine { now }
    private val key = "No Gemini API key. Run `cmc setup --gemini-key <KEY>`."

    /** "Call Claude" → Telecom placed it → call.start is out, call.ready not yet back. */
    private fun startedCall(id: String = "c_a"): String {
        m.handle(Event.HubConnected)
        m.handle(Event.Place(id))
        val fx = m.handle(Event.Begin(id))
        assertEquals(Effect.SendStart(id, CallMachine.Direction.INBOUND), fx.last())
        return id
    }

    @Test fun `error while waiting for call ready ends the attempt and keeps the message for the call screen`() {
        val id = startedCall()
        val fx = m.handle(Event.HubError(key))
        assertEquals(
            listOf(
                Effect.StopAudio,
                Effect.EndConnection(id, EndCause.ERROR),
                Effect.Schedule(Event.Dismiss(id), CallMachine.ERROR_SHOWN_MS),
            ),
            fx,
        )
        // No call.end: the hub dropped the call itself. The text is the hub's, unchanged.
        assertTrue(fx.none { it is Effect.SendEnd })
        assertEquals(key, m.active?.error)
        assertEquals(id, m.active?.callId)
    }

    @Test fun `after the error, the hub's call ended and late timers change nothing`() {
        val id = startedCall()
        m.handle(Event.HubError(key))
        assertEquals(emptyList<Effect>(), m.handle(Event.HubEnded(id, "voice-error")))
        assertEquals(emptyList<Effect>(), m.handle(Event.ReadyTimeout(id)))
        assertEquals(emptyList<Effect>(), m.handle(Event.HubUnreachable(id)))
        assertEquals(emptyList<Effect>(), m.handle(Event.Ready(id)))
        assertEquals(key, m.active?.error)
    }

    @Test fun `a reconnect after the error does not restart the failed call`() {
        val id = startedCall()
        m.handle(Event.HubError(key))
        m.handle(Event.HubDisconnected)
        assertEquals(emptyList<Effect>(), m.handle(Event.HubConnected))
        assertEquals(id, m.active?.callId)
    }

    @Test fun `the error screen goes away on its own, or when closed`() {
        val id = startedCall()
        m.handle(Event.HubError(key))
        assertEquals(emptyList<Effect>(), m.handle(Event.Dismiss("c_other")))
        assertEquals(key, m.active?.error)
        assertEquals(emptyList<Effect>(), m.handle(Event.Dismiss(id)))
        assertNull(m.active)

        val id2 = startedCall("c_b")
        m.handle(Event.HubError(key))
        // "Close" on the error screen: no call.end, the hub has nothing to end.
        assertEquals(emptyList<Effect>(), m.handle(Event.HangUp(id2)))
        assertNull(m.active)
    }

    @Test fun `calling again from the error screen starts a fresh call`() {
        startedCall()
        m.handle(Event.HubError(key))
        assertEquals(listOf(Effect.PlaceOutgoing("c_b")), m.handle(Event.Place("c_b")))
        assertEquals("c_b", m.active?.callId)
        assertNull(m.active?.error)
    }

    @Test fun `an incoming call replaces the error screen`() {
        startedCall()
        m.handle(Event.HubError(key))
        val fx = m.handle(Event.Incoming("c_hub", "acme"))
        assertEquals(Effect.ReportIncoming("c_hub", "acme"), fx.first())
        assertEquals("c_hub", m.active?.callId)
    }

    @Test fun `a second error while the error screen is up becomes a notice`() {
        startedCall()
        m.handle(Event.HubError(key))
        assertEquals(listOf(Effect.Notice("something else")), m.handle(Event.HubError("something else")))
    }

    @Test fun `error with no call is a home-screen notice, word for word`() {
        m.handle(Event.HubConnected)
        assertEquals(listOf(Effect.Notice(key)), m.handle(Event.HubError(key)))
        assertNull(m.active)
    }

    @Test fun `error during a live call is a notice and the call goes on`() {
        val id = startedCall()
        m.handle(Event.Ready(id))
        assertEquals(listOf(Effect.Notice("x")), m.handle(Event.HubError("x")))
        assertEquals(id, m.active?.callId)
        assertNull(m.active?.error)
    }

    @Test fun `error while a hub call is still ringing does not kill it`() {
        m.handle(Event.HubConnected)
        m.handle(Event.Incoming("c_hub", "acme"))
        assertEquals(listOf(Effect.Notice("x")), m.handle(Event.HubError("x")))
        assertEquals("c_hub", m.active?.callId)
    }

    @Test fun `error before call start went out (link down) is only a notice`() {
        m.handle(Event.Place("c_a"))
        m.handle(Event.Begin("c_a")) // link down: EnsureConnected, no call.start yet
        assertEquals(listOf(Effect.Notice("x")), m.handle(Event.HubError("x")))
        assertNull(m.active?.error)
    }
}
