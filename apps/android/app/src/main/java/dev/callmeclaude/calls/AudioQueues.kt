package dev.callmeclaude.calls

import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Hub → phone: PCM16 LE mono 24 kHz. */
const val PLAY_RATE = 24_000
/** Phone → hub: PCM16 LE mono 16 kHz, 20 ms frames. */
const val MIC_RATE = 16_000
const val MIC_FRAME_BYTES = MIC_RATE * 2 / 50 // 640
const val MIC_FRAME_MS = 20L

/**
 * Assistant audio waiting to be played. Bounded to [maxBytes] (15 s at 24 kHz): when it overflows,
 * the oldest audio is dropped. [flush] (barge-in) empties it and bumps [generation], so the player
 * also drops the rest of the chunk it is in the middle of writing.
 */
class PlaybackQueue(private val maxBytes: Int = PLAY_RATE * 2 * 15) {
    private val lock = ReentrantLock()
    private val notEmpty = lock.newCondition()
    private val chunks = ArrayDeque<ByteArray>()

    var bytes = 0
        private set
    @Volatile var generation = 0
        private set
    var dropped = 0L
        private set

    fun offer(chunk: ByteArray) = lock.withLock {
        if (chunk.isEmpty()) return
        chunks.addLast(chunk)
        bytes += chunk.size
        while (bytes > maxBytes && chunks.isNotEmpty()) {
            val old = chunks.removeFirst()
            bytes -= old.size
            dropped += old.size
        }
        notEmpty.signal()
    }

    /** Next chunk and the generation it belongs to, or null after [timeoutMs]. */
    fun take(timeoutMs: Long): Pair<ByteArray, Int>? = lock.withLock {
        var left = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (chunks.isEmpty()) {
            if (left <= 0) return null
            left = notEmpty.awaitNanos(left)
        }
        val c = chunks.removeFirst()
        bytes -= c.size
        c to generation
    }

    fun flush() = lock.withLock {
        chunks.clear()
        bytes = 0
        generation++
    }

    val isEmpty: Boolean get() = lock.withLock { chunks.isEmpty() }
}

/**
 * Phone → hub: one 20 ms frame per [pumpOnce]. The hub ends a call after 20 s without microphone
 * audio ("phone-lost"), so frames keep flowing for the whole call: muted → zeros instead of the
 * microphone; no microphone (permission, device error) → zeros paced by [sleep].
 */
class MicPump(
    /** Fills the buffer (blocking, real time) and returns the bytes read, or < 0 if the mic is unavailable. */
    private val read: (ByteArray) -> Int,
    private val send: (ByteArray) -> Unit,
    private val muted: () -> Boolean,
    private val sleep: (Long) -> Unit = Thread::sleep,
) {
    private val buf = ByteArray(MIC_FRAME_BYTES)
    var sentBytes = 0L
        private set

    fun pumpOnce() {
        val n = read(buf)
        val frame = when {
            n <= 0 -> {
                sleep(MIC_FRAME_MS)
                ByteArray(MIC_FRAME_BYTES)
            }
            // Keep reading the mic while muted so the pacing stays real time.
            muted() -> ByteArray(n)
            else -> buf.copyOf(n)
        }
        sentBytes += frame.size
        send(frame)
    }
}
