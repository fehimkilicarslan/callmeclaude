package dev.callmeclaude.calls

/**
 * Where call audio can go. Pure Kotlin: [CmcConnection] maps Telecom's CallEndpoint (API 34+) or
 * CallAudioState (API 29–33) into these and back; tests drive [AudioRouter] directly.
 *
 * [id] is opaque and only has to stay stable while the call lasts (CallEndpoint identifier on
 * API 34+, route + device address before that). It is never logged or shown.
 */
data class AudioRoute(val id: String, val kind: Kind, val name: String) {
    enum class Kind { EARPIECE, SPEAKER, WIRED, BLUETOOTH, STREAMING, OTHER }
}

/** What the call screen shows: every available route, the active one marked. */
data class AudioRoutesUi(val available: List<AudioRoute>, val current: AudioRoute?) {
    val speakerOn: Boolean get() = current?.kind == AudioRoute.Kind.SPEAKER

    companion object {
        val EMPTY = AudioRoutesUi(emptyList(), null)
    }
}

/**
 * Route choices during one call. Telecom stays the source of truth for what is available and
 * active ([update]); this class only decides what to ask for.
 *
 * The loudspeaker button is a shortcut: turning it off returns to the route that was active
 * before it was turned on (e.g. the headset), not to "the first Bluetooth device", which with a
 * headset and a watch connected used to pick the watch. If that route is gone, [fallback] picks.
 *
 * Telecom's own first pick is kept for the first seconds of the call ([guard]): with a headset
 * and a watch connected, Telecom starts on the headset, then the watch's hands-free link comes up
 * and takes the call over (measured on a Galaxy S25, One UI 9: headset → earpiece → watch within
 * 1.5 s). Unless the caller picked something, that switch is undone.
 */
class AudioRouter {
    var available: List<AudioRoute> = emptyList()
        private set
    var current: AudioRoute? = null
        private set

    /** The last route that wasn't the loudspeaker: where "speaker off" goes back to. */
    var lastNonSpeaker: AudioRoute? = null
        private set

    /** The route Telecom picked on its own when the call started (logged for diagnostics). */
    var initial: AudioRoute? = null
        private set

    val ui: AudioRoutesUi get() = AudioRoutesUi(available, current)

    private var initialAtMs = 0L
    private var userChose = false
    private var restores = 0

    /** Telecom reported the available routes and/or the active one, at [nowMs] (any monotonic clock). */
    fun update(available: List<AudioRoute>, current: AudioRoute?, nowMs: Long = 0) {
        this.available = available
        // The active route may be reported before the list (or not be in it, e.g. streaming).
        val cur = current?.let { c -> find(c) ?: c }
        this.current = cur
        if (cur != null && initial == null) {
            initial = cur
            initialAtMs = nowMs
        }
        if (cur != null && cur.kind != AudioRoute.Kind.SPEAKER) lastNonSpeaker = cur
    }

    /**
     * Call once routes have settled (a short while after the last [update]). Returns Telecom's
     * initial route when Telecom moved away from it on its own within [GUARD_MS] of the call
     * start, the caller hasn't picked anything, and it is still available. Null = leave it.
     */
    fun guard(nowMs: Long): AudioRoute? {
        val first = initial ?: return null
        if (userChose || restores >= MAX_RESTORES || nowMs - initialAtMs > GUARD_MS) return null
        if (same(first, current)) return null
        val target = find(first) ?: return null
        restores += 1
        return target
    }

    /**
     * The user picked a route from the list. Null = it is gone. Asked for even when Telecom says
     * it is already active: on One UI 9 a watch that opens its own hands-free audio leaves Telecom
     * reporting the headset while the sound stays on the watch, and tapping the headset is the
     * caller's way out.
     */
    fun select(id: String): AudioRoute? {
        val target = available.firstOrNull { it.id == id } ?: return null
        userChose = true
        return target
    }

    /** Loudspeaker button (or the remembered loudspeaker choice). Null = nothing to do. */
    fun speaker(on: Boolean): AudioRoute? {
        userChose = true
        val target = if (on) {
            available.firstOrNull { it.kind == AudioRoute.Kind.SPEAKER }
        } else {
            if (current?.kind != AudioRoute.Kind.SPEAKER) return null
            lastNonSpeaker?.let(::find) ?: fallback(available)
        }
        return target?.takeIf { !same(it, current) }
    }

    private fun find(r: AudioRoute): AudioRoute? =
        available.firstOrNull { it.id == r.id } ?: available.firstOrNull { it.kind == r.kind && it.name == r.name && r.kind != AudioRoute.Kind.BLUETOOTH }

    private fun same(a: AudioRoute?, b: AudioRoute?) = a != null && b != null && a.id == b.id

    companion object {
        /** How long after the call start Telecom's own route changes are undone. */
        const val GUARD_MS = 5_000L
        const val MAX_RESTORES = 2

        /**
         * The route to use when the one before the loudspeaker is gone: a wired headset (plugged
         * in on purpose), else the earpiece, else any Bluetooth device, else whatever is left that
         * isn't the loudspeaker.
         *
         * Bluetooth is not preferred over the earpiece because Telecom can't tell a headset from
         * a watch or a car kit (both are just "Bluetooth" endpoints), and audio ending up on a
         * watch is worse than audio at the ear; the picker is one tap away.
         */
        fun fallback(available: List<AudioRoute>): AudioRoute? {
            fun of(k: AudioRoute.Kind) = available.firstOrNull { it.kind == k }
            return of(AudioRoute.Kind.WIRED)
                ?: of(AudioRoute.Kind.EARPIECE)
                ?: of(AudioRoute.Kind.BLUETOOTH)
                ?: available.firstOrNull { it.kind != AudioRoute.Kind.SPEAKER }
        }
    }
}
