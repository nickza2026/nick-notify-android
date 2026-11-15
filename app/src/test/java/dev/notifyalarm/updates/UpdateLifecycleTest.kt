package dev.notifyalarm.updates

import org.junit.Assert.*
import org.junit.Test

class UpdateLifecycleTest {
    @Test fun oldInstallerCallbackCannotHandoffAfterSettingsRoundTrip() {
        val lifecycle = UpdateLifecycle()
        lifecycle.resume()
        val ticket = lifecycle.ticket()
        assertTrue(lifecycle.accepts(ticket))
        lifecycle.pause()
        assertFalse(lifecycle.accepts(ticket))
        lifecycle.resume()
        assertFalse(lifecycle.accepts(ticket))
        assertTrue(lifecycle.accepts(lifecycle.ticket()))
    }
}
