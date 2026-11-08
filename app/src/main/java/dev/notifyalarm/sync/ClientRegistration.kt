package dev.notifyalarm.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Worker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import androidx.work.workDataOf
import dev.notifyalarm.core.AlertMessagingService
import java.time.Instant
import java.util.concurrent.TimeUnit

/** One serialized path for foreground and background writes; read newest FCM token at execution. */
object ClientRegistration {
    private const val ONCE = "client_registration_once"
    private const val FOLLOWUP = "client_registration_followup"
    private const val LOGOUT_FOLLOWUP = "client_logout_immediate"
    private const val PERIODIC = "client_registration_12h"
    private val networkLock = Any()
    internal fun <T> serializedNetwork(block: () -> T): T = synchronized(networkLock) { block() }
    internal fun <T> mutateIfCurrent(eligible: () -> Boolean, action: () -> T): T? =
        serializedNetwork { if (eligible()) action() else null }
    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun enqueue(context: Context, tokenChanged: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<ClientRegistrationWorker>()
            .setConstraints(constraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(ONCE,
            if (tokenChanged) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP, request)
    }

    private fun followup(context: Context, delayMillis: Long, fromFollowup: Boolean = false,
                         urgentLogout: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<ClientRegistrationWorker>()
            .setConstraints(constraints()).setInitialDelay(delayMillis.coerceAtLeast(1000L), TimeUnit.MILLISECONDS)
            .setInputData(workDataOf("followup" to true))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(if (urgentLogout) LOGOUT_FOLLOWUP else FOLLOWUP,
                if (fromFollowup) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP, request)
    }

    fun pendingLogout(context: Context) {
        // Separate unique chain: a KEEP enqueue can be dropped while a register request runs.
        followup(context, 1000L, fromFollowup = true, urgentLogout = true)
    }

    fun periodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<ClientRegistrationWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun run(context: Context, fromFollowup: Boolean = false): Boolean = serializedNetwork {
        val session = ClientAccount.session(context) ?: return@serializedNetwork false
        if (attemptAfterCooldown(context, session.generation, System.currentTimeMillis()) { true } == null) {
            followup(context, ClientAccount.retryDelay(context, session.generation), fromFollowup)
            return@serializedNetwork false
        }
        if (ClientAccount.pendingLogout(context)) {
            val reply = try { ClientApi.logout(session) } catch (_: Exception) { return@serializedNetwork true }
            if (ClientApi.logoutConfirmed(reply)) {
                ClientAccount.clearAfterLogout(context, session.generation)
                return@serializedNetwork false
            }
            if (reply.status == 401) {
                ClientAccount.requireLogoutAuthentication(context, session.generation)
                return@serializedNetwork false
            }
            if (shouldThrottle(reply)) return@serializedNetwork throttle(context, session, reply, fromFollowup)
            return@serializedNetwork ClientPolicy.shouldRetry(reply.status)
        }
        if (session.mustChange) return@serializedNetwork false
        val expiry = try { Instant.parse(session.expiresAt) } catch (_: Exception) { null }
        if (expiry == null || !expiry.isAfter(Instant.now())) {
            val check = try { ClientApi.call(session.base, "/v1/client/session", session.bearer) }
                catch (_: Exception) { return@serializedNetwork true }
            if (check.status == 401) ClientAccount.requireLogin(context, session.generation)
            if (shouldThrottle(check)) return@serializedNetwork throttle(context, session, check, fromFollowup)
            if (check.status != 200) return@serializedNetwork ClientPolicy.shouldRetry(check.status)
            val renewed = check.body.optString("expires_at")
            val instant = try { Instant.parse(renewed) } catch (_: Exception) { null }
            if (instant == null || !instant.isAfter(Instant.now()) ||
                !ClientAccount.refreshExpiry(context, session.generation, renewed)) return@serializedNetwork false
        }
        val token = context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
            .getString(AlertMessagingService.TOKEN_KEY, null) ?: return@serializedNetwork false
        if (!ClientPolicy.token(token)) return@serializedNetwork false
        val reply = try { ClientApi.register(session, token) } catch (_: Exception) { return@serializedNetwork true }
        if (reply.status == 401) {
            ClientAccount.requireLogin(context, session.generation)
            return@serializedNetwork false
        }
        if (reply.status == 403) return@serializedNetwork false
        if (shouldThrottle(reply)) return@serializedNetwork throttle(context, session, reply, fromFollowup)
        val latest = context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
            .getString(AlertMessagingService.TOKEN_KEY, null)
        val current = ClientAccount.session(context)
        if (ClientApi.registrationConfirmed(reply, session) && ClientPolicy.acceptRegistration(session.generation,
                current?.generation ?: -1, token, latest, ClientAccount.pendingLogout(context))) {
            synchronized(ClientAccount.lock) {
                val newestToken = context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
                    .getString(AlertMessagingService.TOKEN_KEY, null)
                if (ClientAccount.isCurrent(context, session) && newestToken == token) {
                    context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
                        .edit().putBoolean("needs_registration", false).commit()
                    context.getSharedPreferences("client_registration_status", Context.MODE_PRIVATE)
                        .edit().putLong("generation", session.generation).putString("device_id",
                            reply.body.optString("device_id")).commit()
                }
            }
            try {
                val check = ClientApi.call(session.base, "/v1/client/session", session.bearer)
                val renewed = check.body.optString("expires_at")
                if (check.status == 200 && Instant.parse(renewed).isAfter(Instant.now()))
                    ClientAccount.refreshExpiry(context, session.generation, renewed)
                else if (check.status == 401) ClientAccount.requireLogin(context, session.generation)
            } catch (_: Exception) { /* Next heartbeat can reconcile the idle expiry. */ }
        }
        if (latest != token && ClientAccount.isCurrent(context, session)) followup(context, 1000L, fromFollowup)
        ClientPolicy.shouldRetry(reply.status)
    }

    private fun throttle(context: Context, session: ClientAccount.Session, reply: ClientApi.Reply,
                         fromFollowup: Boolean): Boolean {
        if (ClientAccount.postpone(context, session.generation, reply.retryAfter))
            followup(context, ClientAccount.retryDelay(context, session.generation), fromFollowup)
        return false
    }

    internal fun shouldThrottle(reply: ClientApi.Reply): Boolean =
        reply.status == 429 || (ClientPolicy.shouldRetry(reply.status) && reply.retryAfter > 0)

    internal fun <T> attemptAfterCooldown(context: Context, generation: Long, now: Long,
                                          transport: () -> T): T? =
        if (ClientAccount.retryDelay(context, generation, now) > 0) null else transport()

    fun status(context: Context): String {
        val session = ClientAccount.session(context)
        if (ClientAccount.pendingLogout(context)) return if (ClientAccount.logoutAuthenticationRequired(context))
            "เซสชันเดิมใช้ไม่ได้: ใส่รหัสผ่านบัญชีเดิมเพื่อยืนยันออกจากระบบ หรือเพิกถอนเครื่องจาก Dashboard"
        else "รอ server ยืนยันออกจากระบบ — เครื่องยังอาจได้รับแจ้งเตือน"
        if (session == null) return "ยังไม่เข้าสู่ระบบ / เซสชันหมดอายุ"
        if (session.mustChange) return "ต้องเปลี่ยนรหัสผ่านก่อนลงทะเบียนเครื่อง"
        val hasToken = context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
            .contains(AlertMessagingService.TOKEN_KEY)
        if (!hasToken) return "ยังไม่มี FCM token — ทดสอบเสียงในเครื่องได้"
        val p = context.getSharedPreferences("client_registration_status", Context.MODE_PRIVATE)
        return if (p.getLong("generation", -1) == session.generation &&
            !context.getSharedPreferences(AlertMessagingService.PUSH_PREFERENCES, Context.MODE_PRIVATE)
                .getBoolean("needs_registration", true)) "ลงทะเบียนเครื่องแล้ว (ตรวจสอบครั้งล่าสุด)"
        else "รอลงทะเบียน / ตรวจเครือข่ายและบัญชี"
    }
}

class ClientRegistrationWorker(context: Context, parameters: WorkerParameters) :
    Worker(context, parameters) {
    override fun doWork(): Result =
        if (ClientRegistration.run(applicationContext, inputData.getBoolean("followup", false)) &&
            runAttemptCount < 8) Result.retry() else Result.success()
}
