package dev.notifyalarm.sync

import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64

/** Pure, strict policy for the per-alert acknowledgement capability. */
internal object AckPolicy {
    private val tokenPattern = Regex("[A-Za-z0-9_-]{43,128}")
    private val prefixPattern = Regex("/(?:[A-Za-z0-9._~-]+/)*v1/alerts/")

    fun validId(id: String): Boolean = id.length in 1..200 && id.isNotBlank() &&
        id.none { it.isISOControl() || Character.isSurrogate(it) }

    fun validToken(token: String): Boolean {
        if (!tokenPattern.matches(token)) return false
        val decoded = try { Base64.getUrlDecoder().decode(token) } catch (_: IllegalArgumentException) {
            return false
        }
        return decoded.size >= 32 && Base64.getUrlEncoder().withoutPadding()
            .encodeToString(decoded) == token
    }

    fun encodedId(id: String): String {
        require(validId(id))
        return buildString {
            for (byte in id.toByteArray(StandardCharsets.UTF_8)) {
                val n = byte.toInt() and 0xff
                if (n in 65..90 || n in 97..122 || n in 48..57 || n == 45 || n == 46 ||
                    n == 95 || n == 126) append(n.toChar())
                else {
                    append('%')
                    append("0123456789ABCDEF"[n shr 4])
                    append("0123456789ABCDEF"[n and 15])
                }
            }
        }
    }

    fun validUrl(value: String, id: String): Boolean {
        if (!validId(id) || value.length !in 1..2048 || value.any { it.isISOControl() }) return false
        val uri = try { URI(value) } catch (_: Exception) { return false }
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.rawUserInfo != null ||
            uri.rawQuery != null || uri.rawFragment != null || uri.rawAuthority?.contains('\\') == true ||
            uri.port !in -1..65535 || uri.port == 0) return false
        val rawPath = uri.rawPath ?: return false
        val suffix = encodedId(id) + "/ack"
        if (!rawPath.endsWith(suffix)) return false
        val prefix = rawPath.dropLast(suffix.length)
        return prefixPattern.matches(prefix) && prefix.split('/').none { it == "." || it == ".." } &&
            uri.toASCIIString() == value
    }

    fun validConfirmation(requestId: String, returnedId: String, status: String, time: String): Boolean =
        returnedId == requestId && status == "acknowledged" &&
            try { Instant.parse(time); true } catch (_: Exception) { false }
}
