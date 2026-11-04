package dev.callmeclaude

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HubErrorsTest {
    private var now = 0L
    private val e = HubErrors({ now })

    @Test fun `the same error twice in a row is shown once`() {
        assertTrue(e.accept("No Gemini API key."))
        now += 5
        assertFalse(e.accept("No Gemini API key."))
    }

    @Test fun `the same error after the window is shown again`() {
        assertTrue(e.accept("a"))
        now += HubErrors.WINDOW_MS
        assertTrue(e.accept("a"))
    }

    @Test fun `repeats do not stretch the window`() {
        assertTrue(e.accept("a"))
        now += 2_000
        assertFalse(e.accept("a"))
        now += 1_500
        assertTrue(e.accept("a"))
    }

    @Test fun `a different error is always shown`() {
        assertTrue(e.accept("a"))
        assertTrue(e.accept("b"))
        assertTrue(e.accept("a"))
    }

    @Test fun `a new call attempt shows the same error again`() {
        assertTrue(e.accept("a"))
        e.reset()
        assertTrue(e.accept("a"))
    }
}
