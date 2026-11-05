package dev.callmeclaude

import org.junit.Assert.assertEquals
import org.junit.Test

class QuickCallTest {
    @Test fun unpairedOpensPairingWhateverElse() {
        for (live in listOf(true, false)) for (mic in listOf(true, false)) for (up in listOf(true, false)) {
            assertEquals(QuickCall.OPEN_PAIRING, decideQuickCall(paired = false, callLive = live, micGranted = mic, connected = up))
        }
    }

    @Test fun liveCallIsShownNotReplaced() {
        assertEquals(QuickCall.SHOW_CALL, decideQuickCall(paired = true, callLive = true, micGranted = true, connected = true))
        assertEquals(QuickCall.SHOW_CALL, decideQuickCall(paired = true, callLive = true, micGranted = false, connected = false))
    }

    @Test fun missingMicrophoneGoesThroughTheHomeScreen() {
        assertEquals(QuickCall.ASK_MICROPHONE, decideQuickCall(paired = true, callLive = false, micGranted = false, connected = true))
    }

    @Test fun normalPlacesTheCall() {
        assertEquals(QuickCall.PLACE_CALL, decideQuickCall(paired = true, callLive = false, micGranted = true, connected = true))
    }

    @Test fun offlineStillPlacesTheCallLikeTheButton() {
        // The call itself says "your computer can't be reached", as from the home screen.
        assertEquals(QuickCall.PLACE_CALL, decideQuickCall(paired = true, callLive = false, micGranted = true, connected = false))
    }
}
