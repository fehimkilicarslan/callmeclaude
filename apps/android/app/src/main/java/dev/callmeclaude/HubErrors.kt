package dev.callmeclaude

/**
 * De-duplicates the hub's `error` messages: the same text again within [windowMs] of the time it
 * was shown is dropped. A failed voice start reaches the phone twice, a few milliseconds apart
 * (apps/mac-agent: VoiceManager.start and AppServer's message handler both report it).
 *
 * The window is short and [reset] runs on every new call attempt, so retrying a call that fails
 * the same way shows the error again.
 */
class HubErrors(private val clock: () -> Long, private val windowMs: Long = WINDOW_MS) {
    private var last: String? = null
    private var shownAt = 0L

    /** True if [message] should be shown; false for a repeat inside the window. */
    fun accept(message: String): Boolean {
        val now = clock()
        if (message == last && now - shownAt < windowMs) return false
        last = message
        shownAt = now
        return true
    }

    fun reset() {
        last = null
    }

    companion object {
        const val WINDOW_MS = 3_000L
    }
}
