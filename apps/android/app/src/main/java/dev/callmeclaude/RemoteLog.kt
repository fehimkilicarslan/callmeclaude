package dev.callmeclaude

/**
 * App diagnostics forwarded to the hub as `{type:"log", lines:[…]}` (packages/protocol, AppToHub),
 * which appends them to ~/.callmeclaude/logs/app-YYYY-MM-DD.log, so problems on a phone nobody is
 * watching can be read on the computer. Port of iOS Log.d + HubClient.remoteLog, with two additions:
 *
 *  - Redaction. Lines are written for humans and may name a host, the computer or this phone. Before
 *    a line is queued, every registered secret (token, device name, computer name, pairing hosts) is
 *    replaced, and anything that looks like a URL or an IP address is masked. Transcripts are never
 *    logged in the first place.
 *  - A rate limit. iOS forwards every line; here a token bucket ([burst] lines, then one per
 *    [refillMs]) keeps a reconnect loop on a dead network from writing thousands of lines a day. Dropped
 *    lines are counted and reported in one line once the bucket refills.
 *
 * Only [Level.INFO] and [Level.WARN] are forwarded; [Level.DEBUG] stays in logcat.
 * Pure Kotlin and not thread-safe: [HubClient] calls it on its hub thread.
 */
class RemoteLog(
    private val now: () -> Long,
    private val maxBuffered: Int = 400,
    private val burst: Int = 30,
    private val refillMs: Long = 2_000,
) {
    enum class Level(val letter: Char) { DEBUG('D'), INFO('I'), WARN('W') }

    private val buffer = ArrayDeque<String>()
    private var tokens = burst.toDouble()
    private var lastRefill = now()
    private var dropped = 0
    private var secrets: List<Pair<String, String>> = emptyList()

    /** Lines waiting for a connection. */
    val pending: Int get() = buffer.size

    /** Lines refused by the rate limit and not yet reported. */
    val droppedSinceReport: Int get() = dropped

    /** Replace these strings (longest first) with their labels before anything is queued. */
    fun setSecrets(values: Map<String, String>) {
        secrets = values.filterKeys { it.length >= 3 }.toList().sortedByDescending { it.first.length }
    }

    /**
     * Queue [message] if its level is forwarded and the rate limit allows it. [time] is the line's
     * wall-clock prefix (HH:mm:ss.SSS), formatted by the caller. Returns whether it was queued.
     */
    fun add(level: Level, tag: String, message: String, time: String): Boolean {
        if (level == Level.DEBUG) return false
        refill()
        if (tokens < 1) {
            dropped++
            return false
        }
        if (dropped > 0 && tokens >= 2) {
            tokens -= 1
            push("$time W/cmc.log: $dropped log lines dropped by the rate limit")
            dropped = 0
        }
        tokens -= 1
        push("$time ${level.letter}/$tag: ${redact(message)}".take(MAX_LINE))
        return true
    }

    /** Everything queued, oldest first; empties the buffer. */
    fun drain(): List<String> {
        val out = buffer.toList()
        buffer.clear()
        return out
    }

    fun redact(text: String): String {
        var s = text
        for ((value, label) in secrets) s = s.replace(value, label, ignoreCase = true)
        s = URL.replace(s, "<url>")
        s = IPV4.replace(s, "<ip>")
        s = IPV6.replace(s, "<ip>")
        return s
    }

    private fun push(line: String) {
        buffer.addLast(line)
        while (buffer.size > maxBuffered) buffer.removeFirst()
    }

    private fun refill() {
        val t = now()
        val earned = (t - lastRefill).toDouble() / refillMs
        if (earned > 0) {
            tokens = minOf(burst.toDouble(), tokens + earned)
            lastRefill = t
        }
    }

    companion object {
        /** The hub truncates lines at 2000 characters; stay well under that. */
        const val MAX_LINE = 500

        private val URL = Regex("""\b(?:wss?|https?)://\S+""", RegexOption.IGNORE_CASE)
        private val IPV4 = Regex("""\b(?:\d{1,3}\.){3}\d{1,3}\b""")
        // Full form needs at least four groups, so a time like 12:34:56 is left alone; or a "::" form.
        private val IPV6 = Regex(
            """\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:)*[0-9a-f]{1,4}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?""",
            RegexOption.IGNORE_CASE,
        )

        /** Labels for [setSecrets]: what each pairing value is replaced with. */
        fun secretsOf(p: PairingInfo?, deviceName: String): Map<String, String> = buildMap {
            put(deviceName, "<device>")
            if (p != null) {
                put(p.token, "<token>")
                put(p.name, "<computer>")
                p.urls.mapNotNull(::hostOf).forEach { put(it, "<host>") }
            }
        }

        fun hostOf(url: String): String? =
            Regex("""^wss?://(\[[^\]]+]|[^/:]+)""", RegexOption.IGNORE_CASE).find(url)?.groupValues?.get(1)
    }
}
