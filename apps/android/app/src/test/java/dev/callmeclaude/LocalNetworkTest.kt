package dev.callmeclaude

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalNetworkTest {
    @Test fun olderAndroidNeverNeedsThePermission() {
        assertEquals(LocalNetworkAccess.NOT_REQUIRED, localNetworkAccess(29, granted = false, blockedAfterRequest = false))
        assertEquals(LocalNetworkAccess.NOT_REQUIRED, localNetworkAccess(36, granted = false, blockedAfterRequest = true))
    }

    @Test fun android17FollowsThePermission() {
        assertEquals(LocalNetworkAccess.GRANTED, localNetworkAccess(37, granted = true, blockedAfterRequest = false))
        // Granted later from the settings: the stale "blocked" flag must not matter.
        assertEquals(LocalNetworkAccess.GRANTED, localNetworkAccess(37, granted = true, blockedAfterRequest = true))
        assertEquals(LocalNetworkAccess.DENIED, localNetworkAccess(37, granted = false, blockedAfterRequest = false))
        assertEquals(LocalNetworkAccess.BLOCKED, localNetworkAccess(38, granted = false, blockedAfterRequest = true))
    }

    @Test fun connectedAlwaysWins() {
        for (a in LocalNetworkAccess.entries) {
            assertEquals(ConnectionView.Connected("mac"), connectionView(true, "Connected to mac", "mac", a))
        }
        assertEquals(ConnectionView.Connected("computer"), connectionView(true, "x", null, LocalNetworkAccess.GRANTED))
    }

    @Test fun missingPermissionReplacesTheGenericStatus() {
        assertEquals(
            ConnectionView.NeedsLocalNetwork(canAsk = true),
            connectionView(false, "Can't reach your computer", "mac", LocalNetworkAccess.DENIED),
        )
        assertEquals(
            ConnectionView.NeedsLocalNetwork(canAsk = true),
            connectionView(false, "Connecting…", "mac", LocalNetworkAccess.DENIED),
        )
        assertEquals(
            ConnectionView.NeedsLocalNetwork(canAsk = false),
            connectionView(false, "Can't reach your computer", "mac", LocalNetworkAccess.BLOCKED),
        )
    }

    @Test fun withThePermissionTheHubStatusIsShown() {
        assertEquals(
            ConnectionView.Offline("Can't reach your computer"),
            connectionView(false, "Can't reach your computer", "mac", LocalNetworkAccess.GRANTED),
        )
        assertEquals(
            ConnectionView.Offline("Connecting…"),
            connectionView(false, "Connecting…", "mac", LocalNetworkAccess.NOT_REQUIRED),
        )
    }
}
