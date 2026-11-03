package dev.callmeclaude

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingInfoTest {
    private fun ok(text: String) = (PairingInfo.parse(text) as PairingResult.Ok).info
    private fun invalid(text: String) = PairingInfo.parse(text) as PairingResult.Invalid

    @Test fun parsesTheFormatPrintedByCmcPair() {
        val p = ok(
            """
            {"v":1,"name":"MacBook-Pro","urls":["ws://mac.tailnet.ts.net:47801","ws://100.64.0.1:47801","ws://192.168.1.20:47801"],"token":"abc_DEF-123"}
            """
        )
        assertEquals(1, p.v)
        assertEquals("MacBook-Pro", p.name)
        assertEquals(3, p.urls.size)
        assertEquals("ws://100.64.0.1:47801", p.urls[1])
        assertEquals("abc_DEF-123", p.token)
    }

    @Test fun roundTripsThroughStorageJson() {
        val p = PairingInfo(1, "box", listOf("ws://127.0.0.1:47801", "wss://h:1"), "t")
        assertEquals(p, ok(p.toJson()))
    }

    @Test fun ignoresUnknownFields() {
        assertEquals("x", ok("""{"v":1,"name":"x","urls":["ws://a:1"],"token":"t","extra":true}""").name)
    }

    @Test fun rejectsAnotherProtocolVersionWithAClearMessage() {
        val e = invalid("""{"v":2,"name":"x","urls":["ws://a:1"],"token":"t"}""")
        assertTrue(e.message, e.message.contains("v2"))
        assertTrue(e.message, e.message.contains("v1"))
    }

    @Test fun rejectsMalformedCodes() {
        listOf(
            "",
            "not json",
            "[1,2]",
            """{"name":"x","urls":["ws://a:1"],"token":"t"}""",
            """{"v":"1","name":"x","urls":["ws://a:1"],"token":"t"}""",
            """{"v":1,"urls":["ws://a:1"],"token":"t"}""",
            """{"v":1,"name":"x","urls":[],"token":"t"}""",
            """{"v":1,"name":"x","urls":"ws://a:1","token":"t"}""",
            """{"v":1,"name":"x","urls":[42],"token":"t"}""",
            """{"v":1,"name":"x","urls":["http://a:1"],"token":"t"}""",
            """{"v":1,"name":"x","urls":["ws://a:1"],"token":""}""",
            """{"v":1,"name":"x","urls":["ws://a:1"]}""",
        ).forEach { assertEquals(it, PairingInfo.INVALID, invalid(it).message) }
    }
}
