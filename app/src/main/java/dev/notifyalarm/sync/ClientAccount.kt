package dev.notifyalarm.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** Bearer is encrypted at rest; never fall back to plaintext after Keystore failure. */
object ClientAccount {
    private const val PREF = "client_account_v1"
    private const val ALIAS = "notify_client_bearer_v1"
    internal val lock = Any()

    data class Session(val base: String, val bearer: String, val installation: String,
                       val name: String, val username: String, val mustChange: Boolean,
                       val expiresAt: String, val generation: Long)
    data class LoginTicket(val generation: Long, val installation: String)

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun installation(context: Context): String = synchronized(lock) {
        val p = prefs(context)
        p.getString("installation", null)?.let { return@synchronized it }
        val id = UUID.randomUUID().toString()
        check(p.edit().putString("installation", id).commit())
        id
    }

    private fun key() = (KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        .getKey(ALIAS, null) as? javax.crypto.SecretKey) ?: KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
        init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or
            KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        generateKey()
    }

    private fun seal(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.getEncoder().encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
    }

    private fun open(value: String): String {
        val data = Base64.getDecoder().decode(value)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        return String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
    }

    fun session(context: Context): Session? = synchronized(lock) {
        val p = prefs(context)
        val encrypted = p.getString("bearer", null) ?: return@synchronized null
        try {
            Session(p.getString("base", null) ?: return@synchronized null, open(encrypted),
                installation(context), p.getString("name", "Android") ?: "Android",
                p.getString("username", "") ?: "", p.getBoolean("must_change", false),
                p.getString("expires", "") ?: "", p.getLong("generation", 0))
        } catch (_: Exception) { null }
    }

    fun pendingLogout(context: Context): Boolean = synchronized(lock) { prefs(context).getBoolean("logout_pending", false) }

    fun loginTicket(context: Context): LoginTicket? = synchronized(lock) {
        if (pendingLogout(context) || session(context) != null) null else
            LoginTicket(prefs(context).getLong("generation", 0), installation(context))
    }

    fun cancelLogin(context: Context): Boolean = synchronized(lock) {
        val p = prefs(context)
        if (p.contains("bearer") || pendingLogout(context)) false else
            p.edit().remove("retry_not_before")
                .putLong("generation", p.getLong("generation", 0) + 1).commit()
    }

    internal fun ticketCurrent(context: Context, ticket: LoginTicket): Boolean = synchronized(lock) {
        prefs(context).getLong("generation", 0) == ticket.generation &&
            installation(context) == ticket.installation && !pendingLogout(context) &&
            !prefs(context).contains("bearer")
    }

    fun save(context: Context, base: String, bearer: String, name: String, username: String,
             mustChange: Boolean, expiresAt: String): Boolean = synchronized(lock) {
        if (pendingLogout(context)) return@synchronized false
        val p = prefs(context)
        p.edit().putString("bearer", seal(bearer)).putString("base", base)
            .putString("name", name).putString("username", username)
            .putBoolean("must_change", mustChange).putString("expires", expiresAt)
            .remove("retry_not_before").putLong("generation", p.getLong("generation", 0) + 1).commit()
    }

    fun saveLogin(context: Context, ticket: LoginTicket, base: String, bearer: String,
                  name: String, username: String, mustChange: Boolean, expiresAt: String): Boolean =
        synchronized(lock) {
            if (!ticketCurrent(context, ticket)) false
            else save(context, base, bearer, name, username, mustChange, expiresAt)
        }

    fun rotate(context: Context, expected: Session, bearer: String, mustChange: Boolean,
               expiresAt: String): Boolean = synchronized(lock) {
        if (!isCurrent(context, expected)) false else
            save(context, expected.base, bearer, expected.name, expected.username, mustChange, expiresAt)
    }

    fun markLogout(context: Context): Boolean = synchronized(lock) {
        val p = prefs(context)
        if (!p.contains("bearer") || p.getBoolean("logout_pending", false)) false else
            p.edit().putBoolean("logout_pending", true)
            .putBoolean("logout_auth_required", false)
            .remove("retry_not_before")
            .putLong("generation", p.getLong("generation", 0) + 1).commit()
    }

    fun requireLogoutAuthentication(context: Context, generation: Long): Boolean = synchronized(lock) {
        val p = prefs(context)
        if (!p.getBoolean("logout_pending", false) || p.getLong("generation", 0) != generation) false
        else p.edit().putBoolean("logout_auth_required", true).commit()
    }

    fun logoutAuthenticationRequired(context: Context): Boolean = synchronized(lock) {
        prefs(context).getBoolean("logout_auth_required", false)
    }

    fun replacePendingBearer(context: Context, expected: Session, bearer: String,
                             expiresAt: String): Boolean = synchronized(lock) {
        val p = prefs(context)
        if (!p.getBoolean("logout_pending", false) || p.getLong("generation", 0) != expected.generation ||
            p.getString("base", null) != expected.base || installation(context) != expected.installation) false
        else p.edit().putString("bearer", seal(bearer)).putString("expires", expiresAt)
            .putBoolean("logout_auth_required", false)
            .remove("retry_not_before")
            .putLong("generation", expected.generation + 1).commit()
    }

    fun clearAfterLogout(context: Context, generation: Long) = synchronized(lock) {
        val p = prefs(context)
        if (p.getLong("generation", 0) == generation) {
            p.edit().remove("bearer").remove("logout_pending").remove("logout_auth_required")
                .remove("expires").remove("retry_not_before")
                .putLong("generation", generation + 1).commit()
        } else false
    }

    fun requireLogin(context: Context, generation: Long) = synchronized(lock) {
        val p = prefs(context)
        if (p.getLong("generation", 0) == generation && !p.getBoolean("logout_pending", false)) {
            p.edit().remove("bearer").remove("retry_not_before")
                .putLong("generation", generation + 1).commit()
        } else false
    }

    fun refreshExpiry(context: Context, generation: Long, expiresAt: String): Boolean = synchronized(lock) {
        val p = prefs(context)
        if (p.getLong("generation", 0) != generation || !p.contains("bearer")) false
        else p.edit().putString("expires", expiresAt).commit()
    }

    fun retryDelay(context: Context, generation: Long, now: Long = System.currentTimeMillis()): Long =
        synchronized(lock) {
            val p = prefs(context)
            if (p.getLong("generation", 0) != generation) 0L else
                (p.getLong("retry_not_before", 0) - now).coerceAtLeast(0)
        }

    fun postpone(context: Context, generation: Long, seconds: Int, now: Long = System.currentTimeMillis()): Boolean =
        synchronized(lock) {
            val p = prefs(context)
            if (p.getLong("generation", 0) != generation) false else
                p.edit().putLong("retry_not_before", now + seconds.coerceIn(30, 3600) * 1000L).commit()
        }

    fun isCurrent(context: Context, session: Session): Boolean = synchronized(lock) {
        val current = session(context)
        current?.generation == session.generation && current.bearer == session.bearer &&
            !pendingLogout(context)
    }
}
