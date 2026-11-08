package dev.notifyalarm.sync

import java.net.URI
import java.nio.charset.StandardCharsets

/** Public URL and wire-contract validation; no account or push secret belongs in a status. */
object ClientPolicy {
    fun baseUrl(value: String, debug: Boolean = false): String? {
        val uri = try { URI(value.trim()) } catch (_: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
            uri.rawPath !in listOf("", "/") || host.isBlank() || uri.port !in -1..65535 ||
            value.any { it.isWhitespace() }) return null
        if (scheme != "https" && !(debug && scheme == "http" &&
                host in setOf("localhost", "127.0.0.1", "[::1]", "::1"))) return null
        return "${scheme}://${uri.rawAuthority}"
    }

    fun password(value: String): Boolean = value.codePointCount(0, value.length) >= 15 &&
        value.toByteArray(StandardCharsets.UTF_8).size <= 128

    fun deviceName(value: String): Boolean = value.codePointCount(0, value.length) in 1..80 &&
        value.isNotBlank()

    fun token(value: String): Boolean = value.length in 20..4096 && value.none { it.isWhitespace() }

    fun shouldRetry(status: Int): Boolean = status == 429 || status == 503 || status in 500..599
    fun requiresLogin(status: Int): Boolean = status == 401
    fun mayRegister(hasSession: Boolean, changeRequired: Boolean, logoutPending: Boolean): Boolean =
        hasSession && !changeRequired && !logoutPending

    /** Reject a response produced before a token rotation, logout, or login replacement. */
    fun acceptRegistration(startGeneration: Long, currentGeneration: Long,
                           submittedToken: String, latestToken: String?, logoutPending: Boolean): Boolean =
        !logoutPending && startGeneration == currentGeneration && submittedToken == latestToken
}
