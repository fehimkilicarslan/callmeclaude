package dev.callmeclaude.calls

import dev.callmeclaude.calls.AudioRoute.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioRouterTest {
    private val earpiece = AudioRoute("e", Kind.EARPIECE, "Earpiece")
    private val speaker = AudioRoute("s", Kind.SPEAKER, "Speaker")
    private val wired = AudioRoute("w", Kind.WIRED, "Wired headset")
    private val headset = AudioRoute("b1", Kind.BLUETOOTH, "Headphones")
    private val watch = AudioRoute("b2", Kind.BLUETOOTH, "Watch")

    private val r = AudioRouter()

    @Test
    fun `speaker off returns to the headset, not the first Bluetooth device`() {
        // The field bug: watch listed first, headset active; speaker on then off used to pick the watch.
        r.update(listOf(earpiece, speaker, watch, headset), headset)
        assertEquals(speaker, r.speaker(true))
        r.update(r.available, speaker)
        assertEquals(headset, r.speaker(false))
    }

    @Test
    fun `speaker off returns to the earpiece when Bluetooth is connected but the earpiece was in use`() {
        r.update(listOf(earpiece, speaker, headset, watch), earpiece)
        r.update(r.available, speaker)
        assertEquals(earpiece, r.speaker(false))
    }

    @Test
    fun `speaker off after the previous route disappeared falls back to wired, then earpiece`() {
        r.update(listOf(earpiece, speaker, headset), headset)
        r.update(r.available, speaker)
        r.update(listOf(earpiece, speaker, watch), speaker) // headset switched off
        assertEquals(earpiece, r.speaker(false))

        val r2 = AudioRouter()
        r2.update(listOf(speaker, wired, headset), headset)
        r2.update(r2.available, speaker)
        r2.update(listOf(speaker, wired), speaker)
        assertEquals(wired, r2.speaker(false))
    }

    @Test
    fun `fallback prefers wired, then earpiece, then Bluetooth, never the speaker`() {
        assertEquals(wired, AudioRouter.fallback(listOf(speaker, headset, wired, earpiece)))
        assertEquals(earpiece, AudioRouter.fallback(listOf(speaker, watch, earpiece)))
        assertEquals(watch, AudioRouter.fallback(listOf(speaker, watch)))
        assertNull(AudioRouter.fallback(listOf(speaker)))
    }

    @Test
    fun `speaker turned on outside the app still returns to the previous route`() {
        r.update(listOf(earpiece, speaker, headset), headset)
        r.update(r.available, speaker) // e.g. from the system call UI
        assertEquals(headset, r.speaker(false))
    }

    @Test
    fun `no-op requests return null, except an explicit pick`() {
        r.update(listOf(earpiece, speaker, headset), headset)
        assertNull(r.speaker(false))           // speaker already off
        assertEquals(headset, r.select(headset.id)) // asked again on purpose (see select)
        assertNull(r.select("gone"))           // not available
        r.update(r.available, speaker)
        assertNull(r.speaker(true))            // already on
    }

    @Test
    fun `any route can be picked, including the earpiece while Bluetooth is connected`() {
        r.update(listOf(earpiece, speaker, headset, watch), headset)
        assertEquals(earpiece, r.select(earpiece.id))
        assertEquals(watch, r.select(watch.id))
        assertEquals(speaker, r.select(speaker.id))
    }

    @Test
    fun `picking a route then the speaker shortcut returns to the picked route`() {
        r.update(listOf(earpiece, speaker, headset, watch), headset)
        r.update(r.available, watch)
        r.update(r.available, speaker)
        assertEquals(watch, r.speaker(false))
    }

    @Test
    fun `initial route is Telecom's first pick, current is resolved against the list`() {
        r.update(listOf(earpiece, speaker, headset), null)
        assertNull(r.initial)
        r.update(r.available, headset.copy(name = "renamed"))
        assertEquals(headset, r.initial)
        assertEquals(headset, r.current)
        r.update(r.available, speaker)
        assertEquals(headset, r.initial)
    }

    @Test
    fun `ui marks the active route and the speaker state`() {
        r.update(listOf(earpiece, speaker), earpiece)
        assertFalse(r.ui.speakerOn)
        r.update(r.available, speaker)
        assertTrue(r.ui.speakerOn)
        assertEquals(speaker, r.ui.current)
        assertEquals(listOf(earpiece, speaker), r.ui.available)
    }

    @Test
    fun `the watch taking over at call start is undone`() {
        // Measured sequence: headset first, then earpiece, then the watch joins and takes the call.
        r.update(listOf(speaker, earpiece, headset), headset, nowMs = 0)
        r.update(listOf(speaker, watch, earpiece, headset), earpiece, nowMs = 600)
        r.update(r.available, watch, nowMs = 1_500)
        assertEquals(headset, r.guard(nowMs = 2_300))
        r.update(r.available, headset, nowMs = 2_400)
        assertNull(r.guard(nowMs = 3_200))
    }

    @Test
    fun `the guard gives up after two restores and after the start window`() {
        r.update(listOf(earpiece, speaker, headset, watch), headset, nowMs = 0)
        r.update(r.available, watch, nowMs = 100)
        assertEquals(headset, r.guard(900))
        r.update(r.available, watch, nowMs = 1_000)
        assertEquals(headset, r.guard(1_800))
        r.update(r.available, watch, nowMs = 1_900)
        assertNull(r.guard(2_700))

        val late = AudioRouter()
        late.update(listOf(earpiece, speaker, headset, watch), headset, nowMs = 0)
        late.update(late.available, watch, nowMs = 9_000)
        assertNull(late.guard(AudioRouter.GUARD_MS + 1))
    }

    @Test
    fun `the guard never overrides the caller's own choice`() {
        r.update(listOf(earpiece, speaker, headset, watch), headset, nowMs = 0)
        assertEquals(watch, r.select(watch.id))
        r.update(r.available, watch, nowMs = 500)
        assertNull(r.guard(1_300))

        val sp = AudioRouter()
        sp.update(listOf(earpiece, speaker, headset), headset, nowMs = 0)
        sp.speaker(true)
        sp.update(sp.available, speaker, nowMs = 300)
        assertNull(sp.guard(1_100))
    }

    @Test
    fun `the guard does nothing when the initial route is gone`() {
        r.update(listOf(earpiece, speaker, headset), headset, nowMs = 0)
        r.update(listOf(earpiece, speaker), earpiece, nowMs = 500) // headset switched off
        assertNull(r.guard(1_300))
    }
}
