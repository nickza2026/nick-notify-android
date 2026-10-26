package dev.notifyalarm.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AckPolicyTest {
    private val token = "A".repeat(43)

    @Test fun requiresExactEncodedAlertPath() {
        val id = "notice /é?"
        val path = AckPolicy.encodedId(id)
        assertTrue(AckPolicy.validUrl("https://api.example.org/base/v1/alerts/$path/ack", id))
        assertFalse(AckPolicy.validUrl("https://api.example.org/v1/alerts/$id/ack", id))
        assertFalse(AckPolicy.validUrl("https://api.example.org/v1/alerts/$path/ack/extra", id))
        assertFalse(AckPolicy.validUrl("https://api.example.org/v1/alerts/wrong/ack", id))
        assertFalse(AckPolicy.validUrl("https://api.example.org/v1/alerts/$path/ack?secret=x", id))
    }

    @Test fun neverAcceptsInsecureOrRedirectTargetRoutes() {
        val path = "/v1/alerts/abc/ack"
        assertFalse(AckPolicy.validUrl("http://api.example.org$path", "abc"))
        assertFalse(AckPolicy.validUrl("https://user:pass@api.example.org$path", "abc"))
        assertFalse(AckPolicy.validUrl("https://api.example.org$path#fragment", "abc"))
        assertFalse(AckPolicy.validUrl("https://api.example.org/v1/alerts/%61bc/ack", "abc"))
        assertFalse(AckPolicy.validUrl("https://api.example.org$path\r\nX:evil", "abc"))
        assertFalse(AckPolicy.validUrl("https://api.example.org/base/../v1/alerts/abc/ack", "abc"))
        assertFalse(AckPolicy.validUrl("https://api.example.org/./v1/alerts/abc/ack", "abc"))
        assertFalse(AckPolicy.validToken("Bearer $token"))
        assertFalse(AckPolicy.validToken("$token\r\nX:evil"))
        assertTrue(AckPolicy.validToken(token))
    }

    @Test fun requiresMatchingConfirmedReceiptAndTimestamp() {
        assertTrue(AckPolicy.validConfirmation("abc", "abc", "acknowledged", "2026-10-19T10:00:00Z"))
        assertFalse(AckPolicy.validConfirmation("abc", "other", "acknowledged", "2026-10-19T10:00:00Z"))
        assertFalse(AckPolicy.validConfirmation("abc", "abc", "pending", "2026-10-19T10:00:00Z"))
        assertFalse(AckPolicy.validConfirmation("abc", "abc", "acknowledged", "tomorrow"))
    }
}
