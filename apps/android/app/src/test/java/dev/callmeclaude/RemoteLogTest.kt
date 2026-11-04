package dev.callmeclaude

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteLogTest {
    private var t = 0L
    private val log = RemoteLog(now = { t }, maxBuffered = 5, burst = 3, refillMs = 1_000)

    private fun info(msg: String) = log.add(RemoteLog.Level.INFO, "cmc.hub", msg, "12:00:00.000")

    @Test
    fun `debug stays local, info and warn are forwarded with level and tag`() {
        assertFalse(log.add(RemoteLog.Level.DEBUG, "cmc.hub", "link: retry", "12:00:00.000"))
        assertTrue(info("connecting: racing 3 addresses"))
        assertTrue(log.add(RemoteLog.Level.WARN, "cmc.call", "AudioTrack failed", "12:00:00.001"))
        assertEquals(
            listOf("12:00:00.000 I/cmc.hub: connecting: racing 3 addresses", "12:00:00.001 W/cmc.call: AudioTrack failed"),
            log.drain(),
        )
        assertEquals(0, log.pending)
    }

    @Test
    fun `pairing secrets, urls and addresses are redacted`() {
        val p = PairingInfo(1, "studio-laptop", listOf("ws://192.168.1.20:7777", "ws://mac.tail1234.ts.net:7777", "ws://[fd7a:115c::1]:7777"), "s3cr3t-token-value")
        log.setSecrets(RemoteLog.secretsOf(p, "Test Phone"))
        assertEquals("connected via #1 <host>", log.redact("connected via #1 mac.tail1234.ts.net"))
        assertEquals("connected via #0 <host>", log.redact("connected via #0 192.168.1.20"))
        assertEquals("auth <token> from <device> to <computer>", log.redact("auth s3cr3t-token-value from Test Phone to studio-laptop"))
        assertEquals("failed: <url>", log.redact("failed: ws://10.0.0.5:7777/x"))
        assertEquals("peer <ip> gone", log.redact("peer 172.16.4.2 gone"))
        assertEquals("peer <ip> gone", log.redact("peer fe80::1c2b:3aff:fe4d gone"))
        assertEquals("peer <ip> gone", log.redact("peer 2001:db8:85a3:0:0:8a2e:370:7334 gone"))
    }

    @Test
    fun `ordinary log text survives redaction`() {
        val s = "audio 5s: mic→hub 31KB at 12:34:56, foreground types=0x40000000, Network 104, call c_ab12"
        assertEquals(s, log.redact(s))
    }

    @Test
    fun `rate limit drops a burst and reports how many were dropped`() {
        repeat(3) { assertTrue(info("line $it")) }
        assertFalse(info("line 3"))
        assertFalse(info("line 4"))
        assertEquals(2, log.droppedSinceReport)
        t += 1_000 // one token back: not enough for the report plus a line
        assertTrue(info("line 5"))
        assertEquals(2, log.droppedSinceReport)
        t += 2_000 // two tokens: the report goes first, then the line
        assertTrue(info("line 6"))
        assertEquals(0, log.droppedSinceReport)
        val lines = log.drain()
        assertEquals("12:00:00.000 W/cmc.log: 2 log lines dropped by the rate limit", lines[lines.size - 2])
        assertEquals("12:00:00.000 I/cmc.hub: line 6", lines.last())
    }

    @Test
    fun `tokens refill up to the burst only`() {
        t += 60_000
        repeat(3) { assertTrue(info("x$it")) }
        assertFalse(info("x3"))
    }

    @Test
    fun `offline buffer keeps the newest lines`() {
        val big = RemoteLog(now = { t }, maxBuffered = 3, burst = 10, refillMs = 1_000)
        repeat(5) { big.add(RemoteLog.Level.INFO, "t", "m$it", "T") }
        assertEquals(listOf("T I/t: m2", "T I/t: m3", "T I/t: m4"), big.drain())
    }

    @Test
    fun `long lines are cut`() {
        info("y".repeat(2_000))
        assertEquals(RemoteLog.MAX_LINE, log.drain().single().length)
    }

    @Test
    fun `host is taken from pairing urls`() {
        assertEquals("192.168.1.20", RemoteLog.hostOf("ws://192.168.1.20:7777"))
        assertEquals("mac.tail1234.ts.net", RemoteLog.hostOf("wss://mac.tail1234.ts.net/app"))
        assertEquals("[fd7a:115c::1]", RemoteLog.hostOf("ws://[fd7a:115c::1]:7777"))
    }
}
