package dev.callmeclaude.calls

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackQueueTest {
    private fun chunk(ms: Int, fill: Int) = ByteArray(PLAY_RATE * 2 * ms / 1000) { fill.toByte() }

    @Test fun `plays chunks in order`() {
        val q = PlaybackQueue()
        q.offer(chunk(20, 1))
        q.offer(chunk(20, 2))
        assertEquals(1.toByte(), q.take(0)!!.first[0])
        assertEquals(2.toByte(), q.take(0)!!.first[0])
        assertNull(q.take(0))
    }

    @Test fun `more than 15 s queued drops the oldest audio`() {
        val q = PlaybackQueue()
        repeat(16) { q.offer(chunk(1000, it)) } // 16 s
        assertEquals(PLAY_RATE * 2 * 15, q.bytes)
        assertEquals((PLAY_RATE * 2).toLong(), q.dropped)
        assertEquals(1.toByte(), q.take(0)!!.first[0]) // second 0 is gone
    }

    @Test fun `exactly 15 s is kept`() {
        val q = PlaybackQueue()
        repeat(15) { q.offer(chunk(1000, it)) }
        assertEquals(0L, q.dropped)
    }

    @Test fun `flush empties the queue and invalidates the chunk being played`() {
        val q = PlaybackQueue()
        q.offer(chunk(500, 1))
        q.offer(chunk(500, 2))
        val (_, gen) = q.take(0)!!
        q.flush()
        assertTrue(q.isEmpty)
        assertEquals(0, q.bytes)
        assertNotEquals(gen, q.generation) // the player stops writing the rest of it
        q.offer(chunk(20, 3))
        val (next, nextGen) = q.take(0)!!
        assertEquals(3.toByte(), next[0])
        assertEquals(q.generation, nextGen)
    }

    @Test fun `take waits for audio`() {
        val q = PlaybackQueue()
        val t = Thread { Thread.sleep(50); q.offer(chunk(20, 7)) }.apply { start() }
        assertEquals(7.toByte(), q.take(2_000)!!.first[0])
        t.join()
    }
}

class MicPumpTest {
    private val sent = mutableListOf<ByteArray>()
    private var muted = false
    private val sleeps = mutableListOf<Long>()
    private val voice: (ByteArray) -> Int = { b -> b.fill(42); b.size }

    private fun pump(read: (ByteArray) -> Int) = MicPump(read, { sent += it }, { muted }, { sleeps += it })

    @Test fun `frames are 20 ms of 16 kHz PCM16`() {
        assertEquals(640, MIC_FRAME_BYTES)
        pump(voice).pumpOnce()
        assertEquals(640, sent.single().size)
        assertTrue(sent.single().all { it == 42.toByte() })
    }

    @Test fun `muted sends silence frames at the same rate instead of nothing`() {
        val p = pump(voice)
        p.pumpOnce()
        muted = true
        repeat(3) { p.pumpOnce() }
        muted = false
        p.pumpOnce()
        assertEquals(5, sent.size)
        sent.subList(1, 4).forEach { f ->
            assertEquals(640, f.size)
            assertArrayEquals(ByteArray(640), f)
        }
        assertTrue(sent.last().all { it == 42.toByte() })
        assertTrue(sleeps.isEmpty()) // the mic read still paces the frames
        assertEquals(5L * 640, p.sentBytes)
    }

    @Test fun `no microphone still streams paced silence`() {
        val p = pump { -1 }
        repeat(4) { p.pumpOnce() }
        assertEquals(4, sent.size)
        sent.forEach { assertArrayEquals(ByteArray(640), it) }
        assertEquals(listOf(20L, 20L, 20L, 20L), sleeps)
    }

    @Test fun `sent frames are copies, not the reused buffer`() {
        var n = 0
        val p = pump { b -> b.fill((++n).toByte()); b.size }
        p.pumpOnce()
        p.pumpOnce()
        assertEquals(1.toByte(), sent[0][0])
        assertEquals(2.toByte(), sent[1][0])
    }
}
