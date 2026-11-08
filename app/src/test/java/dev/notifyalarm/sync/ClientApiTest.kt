package dev.notifyalarm.sync

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
class ClientApiTest {
    private fun future() = Instant.now().plusSeconds(86400).toString()
    private fun loginResponse() = JSONObject().put("access_token", "x".repeat(43))
        .put("expires_at", future())
        .put("user", JSONObject().put("username", "owner").put("must_change_password", true))

    @Test fun loginBodyMatchesContractAndRegistrationNeverContainsInstallationOrMasterKey() {
        val login = ClientApi.loginBody("owner", "private-password", "12345678-1234-1234-1234-123456789012")
        assertEquals(setOf("username", "password", "installation_id"), login.keys().asSequence().toSet())
        val registration = ClientApi.registrationBody("เครื่องแฟน", "x".repeat(32))
        assertEquals(setOf("key_id", "device_name", "fcm_token"), registration.keys().asSequence().toSet())
        assertEquals("primary", registration.getString("key_id"))
        assertFalse(registration.has("installation_id"))
    }

    @Test fun responseProjectsOnlyBearerExpiryAndForcedChange() {
        val reply = ClientApi.Reply(200, loginResponse())
        assertTrue(ClientApi.extractLogin(reply, "owner")!!.third)
        assertNull(ClientApi.extractLogin(ClientApi.Reply(401, JSONObject().put("error",
            JSONObject().put("code", "invalid_credentials"))), "owner"))
    }

    @Test fun forgedLoginSuccessRejected() {
        val body = loginResponse()
        for ((key, value) in listOf("access_token" to "!".repeat(43),
            "expires_at" to "1970-01-01T00:00:00Z", "expires_at" to "invalid",
            "expires_at" to "2999-01-01T00:00:00+01:00")) {
            val copy = JSONObject(body.toString()).put(key, value)
            assertNull(ClientApi.extractLogin(ClientApi.Reply(200, copy), "owner"))
        }
        assertNull(ClientApi.extractLogin(ClientApi.Reply(200, body), "other"))
        body.getJSONObject("user").remove("must_change_password")
        assertNull(ClientApi.extractLogin(ClientApi.Reply(200, body), "owner"))
        body.getJSONObject("user").put("must_change_password", "false")
        assertNull(ClientApi.extractLogin(ClientApi.Reply(200, body), "owner"))
    }

    @Test fun registrationRequiresMatchingInstallationAndKey() {
        val session = ClientAccount.Session("https://example.org", "x".repeat(43),
            "12345678-1234-1234-1234-123456789012", "เครื่องแฟน", "owner", false,
            "2026-12-01T00:00:00Z", 1)
        val body = JSONObject().put("registered", true).put("installation_id", session.installation)
            .put("key_id", "primary").put("device_name", session.name)
            .put("device_id", "12345678-1234-1234-1234-123456789012")
            .put("updated_at", Instant.now().toString())
        assertTrue(ClientApi.registrationConfirmed(ClientApi.Reply(200, body), session))
        body.put("installation_id", "another-installation")
        assertFalse(ClientApi.registrationConfirmed(ClientApi.Reply(200, body), session))
        body.put("installation_id", session.installation).put("device_id", "1-1-1-1-1")
        assertFalse(ClientApi.registrationConfirmed(ClientApi.Reply(200, body), session))
        body.put("device_id", session.installation).remove("updated_at")
        assertFalse(ClientApi.registrationConfirmed(ClientApi.Reply(200, body), session))
    }

    @Test fun logoutOnlyTrue200ConfirmsServerRevocation() {
        assertFalse(ClientApi.logoutConfirmed(ClientApi.Reply(401, JSONObject().put("logged_out", true))))
        assertFalse(ClientApi.logoutConfirmed(ClientApi.Reply(200, JSONObject())))
        assertFalse(ClientApi.logoutConfirmed(ClientApi.Reply(200, JSONObject().put("logged_out", "true"))))
        assertTrue(ClientApi.logoutConfirmed(ClientApi.Reply(200, JSONObject().put("logged_out", true))))
    }

    @Test fun responseStreamBoundedBeforeParsingAndClosesOnOverflowOrMalformedUtf8() {
        val bytes = ("{" + "x".repeat(40000) + "PRIVATE").toByteArray()
        var read = 0
        var closed = false
        val stream = object : InputStream() {
            override fun read(): Int = if (read < bytes.size) bytes[read++].toInt() and 255 else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                val n = minOf(len, bytes.size - read)
                if (n == 0) return -1
                bytes.copyInto(b, off, read, read + n); read += n; return n
            }
            override fun close() { closed = true }
        }
        val result = ClientApi.decodeResponse(503, stream, "4000")
        assertEquals(32769, read)
        assertTrue(closed)
        assertEquals(0, result.body.length())
        assertFalse(result.body.toString().contains("PRIVATE"))
        assertEquals(3600, result.retryAfter)
        assertEquals(0, ClientApi.decodeResponse(200,
            ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 0x28)), null).body.length())
    }
}
