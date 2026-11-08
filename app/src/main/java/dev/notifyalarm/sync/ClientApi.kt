package dev.notifyalarm.sync

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.InputStream
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

/** No redirects: bearer and password must never be forwarded to another origin. */
object ClientApi {
    data class Reply(val status: Int, val body: JSONObject, val retryAfter: Int = 0) {
        val error: String get() = body.optJSONObject("error")?.optString("code") ?: ""
    }

    fun call(base: String, path: String, bearer: String? = null, payload: JSONObject? = null): Reply {
        require(ClientPolicy.baseUrl(base) == base)
        require(path in setOf("/v1/client/login", "/v1/client/change-password", "/v1/client/session",
            "/v1/client/logout", "/v1/client/keys", "/v1/client/devices/register", "/v1/client/devices"))
        val connection = (URL(base + path).openConnection() as HttpURLConnection)
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.requestMethod = if (payload == null) "GET" else "POST"
            connection.setRequestProperty("Accept", "application/json")
            if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            return decodeResponse(status, input, connection.getHeaderField("Retry-After"))
        } finally { connection.disconnect() }
    }

    internal fun decodeResponse(status: Int, input: InputStream?, retryAfter: String?): Reply {
        val raw: String? = if (input == null) "" else input.use { readBounded(it) }
        val body = if (raw == null) JSONObject() else try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
        return Reply(status, body, retryAfter?.toIntOrNull()?.coerceIn(0, 3600) ?: 0)
    }

    /** Read no more than the cap plus one overflow byte, including chunked/error bodies. */
    internal fun readBounded(input: InputStream): String? {
        val buffer = ByteArray(4096)
        val bytes = java.io.ByteArrayOutputStream()
        while (true) {
            val count = input.read(buffer, 0, minOf(buffer.size, 32769 - bytes.size()))
            if (count == -1) break
            if (count == 0) continue
            bytes.write(buffer, 0, count)
            if (bytes.size() > 32768) return null
        }
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (_: Exception) { null }
    }

    fun login(base: String, username: String, password: String, installation: String): Reply =
        call(base, "/v1/client/login", payload = loginBody(username, password, installation))

    fun loginBody(username: String, password: String, installation: String): JSONObject =
        JSONObject().put("username", username).put("password", password).put("installation_id", installation)

    fun register(session: ClientAccount.Session, token: String): Reply =
        call(session.base, "/v1/client/devices/register", session.bearer,
            registrationBody(session.name, token))

    fun registrationBody(name: String, token: String): JSONObject =
        JSONObject().put("key_id", "primary").put("device_name", name).put("fcm_token", token)

    fun logout(session: ClientAccount.Session): Reply =
        call(session.base, "/v1/client/logout", session.bearer, JSONObject())

    fun changePassword(session: ClientAccount.Session, current: String, new: String): Reply =
        call(session.base, "/v1/client/change-password", session.bearer,
            JSONObject().put("current_password", current).put("new_password", new))

    private fun text(body: JSONObject, key: String): String? =
        (body.opt(key) as? String)?.takeIf { it.isNotBlank() }

    private fun futureUtc(value: String?): Boolean = value != null &&
        Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$").matches(value) &&
        try { Instant.from(DateTimeFormatter.ISO_INSTANT.parse(value)).isAfter(Instant.now()) }
        catch (_: Exception) { false }

    private fun canonicalUuid(value: String?): Boolean = value != null &&
        Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(value) &&
        try { UUID.fromString(value).toString() == value } catch (_: Exception) { false }

    fun extractLogin(reply: Reply, expectedUsername: String): Triple<String, String, Boolean>? {
        if (reply.status != 200) return null
        val bearer = text(reply.body, "access_token") ?: return null
        val expires = text(reply.body, "expires_at") ?: return null
        val user = reply.body.optJSONObject("user") ?: return null
        val username = text(user, "username") ?: return null
        val change = user.opt("must_change_password") as? Boolean ?: return null
        if (!Regex("^[A-Za-z0-9_-]{43}$").matches(bearer) || !futureUtc(expires) ||
            username != expectedUsername || username.length > 128) return null
        return Triple(bearer, expires, change)
    }

    fun logoutConfirmed(reply: Reply): Boolean = reply.status == 200 &&
        reply.body.opt("logged_out") == true

    fun registrationConfirmed(reply: Reply, session: ClientAccount.Session): Boolean {
        return reply.status == 200 && reply.body.opt("registered") == true &&
            text(reply.body, "installation_id") == session.installation &&
            text(reply.body, "key_id") == "primary" &&
            text(reply.body, "device_name") == session.name &&
            canonicalUuid(text(reply.body, "device_id")) &&
            validTimestamp(text(reply.body, "updated_at"))
    }

    private fun validTimestamp(value: String?): Boolean = value != null &&
        Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$").matches(value) &&
        try { Instant.parse(value); true } catch (_: Exception) { false }
}
