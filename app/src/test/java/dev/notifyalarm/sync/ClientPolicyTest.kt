package dev.notifyalarm.sync

import org.junit.Assert.*
import org.junit.Test

class ClientPolicyTest {
    @Test fun urlRejectsCredentialLeakAndInsecureOrigins() {
        assertEquals("https://example.org", ClientPolicy.baseUrl("https://example.org/"))
        for (url in listOf("http://example.org", "https://user:pass@example.org",
            "https://example.org/?token=x", "https://example.org/#private", "https://example.org/path",
            "https://example.org:70000", "https://example.org/ other")) {
            assertNull(url, ClientPolicy.baseUrl(url))
        }
        assertNull(ClientPolicy.baseUrl("http://127.0.0.1:8080"))
        assertEquals("http://127.0.0.1:8080", ClientPolicy.baseUrl("http://127.0.0.1:8080", true))
        assertNull(ClientPolicy.baseUrl("http://192.168.1.1:8080", true))
    }

    @Test fun passwordAndDeviceValidationUseCodepointsAndBytes() {
        assertTrue(ClientPolicy.password("😀".repeat(15)))
        assertFalse(ClientPolicy.password("😀".repeat(33)))
        assertFalse(ClientPolicy.password("a".repeat(14)))
        assertTrue(ClientPolicy.deviceName("📱".repeat(80)))
        assertFalse(ClientPolicy.deviceName("📱".repeat(81)))
        assertFalse(ClientPolicy.token("a".repeat(20) + " "))
    }

    @Test fun authorizationAndRetryDoNotBlindlyRetryAuthFailures() {
        assertFalse(ClientPolicy.mayRegister(true, true, false))
        assertFalse(ClientPolicy.mayRegister(true, false, true))
        assertTrue(ClientPolicy.mayRegister(true, false, false))
        assertTrue(ClientPolicy.requiresLogin(401))
        assertFalse(ClientPolicy.shouldRetry(401))
        assertFalse(ClientPolicy.shouldRetry(403))
        assertTrue(ClientPolicy.shouldRetry(429))
        assertTrue(ClientPolicy.shouldRetry(503))
    }

    @Test fun oldTokenResponseCannotConfirmNewTokenOrNewSessionAndLogoutBlocksWrites() {
        assertTrue(ClientPolicy.acceptRegistration(4, 4, "token-A", "token-A", false))
        assertFalse(ClientPolicy.acceptRegistration(4, 4, "token-A", "token-B", false))
        assertFalse(ClientPolicy.acceptRegistration(4, 5, "token-A", "token-A", false))
        assertFalse(ClientPolicy.acceptRegistration(4, 4, "token-A", "token-A", true))
    }
}
