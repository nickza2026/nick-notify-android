package dev.notifyalarm.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.WorkManager
import dev.notifyalarm.core.AlarmStore
import java.util.concurrent.TimeUnit

/** No global API key is stored here: each alert has its own HTTPS acknowledgement capability. */
object AckSync {
    private const val PREFS = "ack_sync_v1"
    private const val UNIQUE_WORK = "ack_sync_drain_v1"
    private const val RECONCILE_WORK = "ack_sync_reconcile_v1"
    private const val ROUTE = "route:"
    private const val CONFIRMED = "confirmed:"
    private const val BLOCKED = "blocked:"
    private const val CURSOR = "cursor"
    private const val MAX_ROUTES = 1000
    internal val lock = Any()

    private fun prefs(context: Context) = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    internal data class Route(val url: String, val token: String)

    fun registerRoute(context: Context, id: String, url: String, token: String): Boolean {
        if (!AckPolicy.validUrl(url, id) || !AckPolicy.validToken(token)) return false
        // FCM calls this on its background thread. Persist independent recovery BEFORE a route
        // becomes usable, covering process death between the local Ack commit and one-shot enqueue.
        try { ensureReconciler(context, waitUntilPersisted = true) } catch (_: Exception) { return false }
        return synchronized(lock) {
            val store = prefs(context)
            val key = ROUTE + id
            if (store.getBoolean(CONFIRMED + id, false)) return@synchronized true
            val existing = store.getString(key, null)
            if (existing != null && existing != "$url\n$token") return@synchronized false
            if (!store.contains(key) && store.all.keys.count { it.startsWith(ROUTE) } >= MAX_ROUTES) {
                // PoC metadata is bounded rather than silently evicting a pending capability.
                return@synchronized false
            }
            store.edit().putString(key, "$url\n$token").remove(BLOCKED + id).commit()
        }
    }

    internal fun route(context: Context, id: String): Route? = synchronized(lock) {
        val value = prefs(context).getString(ROUTE + id, null) ?: return@synchronized null
        val split = value.lastIndexOf('\n')
        if (split < 0) return@synchronized null
        val url = value.substring(0, split)
        val token = value.substring(split + 1)
        if (!AckPolicy.validUrl(url, id) || !AckPolicy.validToken(token)) null else Route(url, token)
    }

    internal fun isConfirmed(context: Context, id: String): Boolean = synchronized(lock) {
        prefs(context).getBoolean(CONFIRMED + id, false)
    }

    internal fun confirm(context: Context, id: String): Boolean = synchronized(lock) {
        // Commit the receipt before removing AlarmStore's pending record. On restart the
        // worker reconciles this tombstone without sending a second request.
        prefs(context).edit().putBoolean(CONFIRMED + id, true)
            .remove(ROUTE + id).remove(BLOCKED + id).commit()
    }

    internal fun block(context: Context, id: String, reason: String): Boolean = synchronized(lock) {
        prefs(context).edit().putString(BLOCKED + id, reason).commit()
    }

    internal fun isBlocked(context: Context, id: String): Boolean = synchronized(lock) {
        prefs(context).contains(BLOCKED + id)
    }

    internal fun cursor(context: Context): Int = synchronized(lock) { prefs(context).getInt(CURSOR, 0) }

    internal fun setCursor(context: Context, next: Int): Boolean = synchronized(lock) {
        prefs(context).edit().putInt(CURSOR, next).commit()
    }

    /** Caller-triggered enqueue permits retrying prior permanent failures on resume/manual action. */
    fun enqueue(context: Context) {
        ensureReconciler(context, waitUntilPersisted = false)
        synchronized(lock) {
            val store = prefs(context)
            val editor = store.edit()
            store.all.keys.filter { it.startsWith(BLOCKED) }.forEach { editor.remove(it) }
            if (!editor.commit()) return
        }
        val pending = AlarmStore.pendingAcknowledgements(context)
        if (pending.any { isConfirmed(context, it) || route(context, it) != null }) schedule(context)
    }

    private fun ensureReconciler(context: Context, waitUntilPersisted: Boolean) {
        val request = PeriodicWorkRequestBuilder<AckReconcileWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        val operation = WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            RECONCILE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        if (waitUntilPersisted) operation.result.get(5, TimeUnit.SECONDS)
    }

    internal fun reconcile(context: Context) {
        val pending = AlarmStore.pendingAcknowledgements(context)
        if (pending.any { isConfirmed(context, it) || (!isBlocked(context, it) && route(context, it) != null) }) {
            schedule(context)
        }
    }

    internal fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<AckSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UNIQUE_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun pendingCount(context: Context): Int = try {
        AlarmStore.pendingAcknowledgements(context).count { route(context, it) != null && !isConfirmed(context, it) }
    } catch (_: Exception) { 0 }

    fun confirmedCount(context: Context): Int = synchronized(lock) {
        prefs(context).all.keys.count { it.startsWith(CONFIRMED) }
    }

    fun status(context: Context): String = try {
        val pending = AlarmStore.pendingAcknowledgements(context)
        val sendable = pending.count { route(context, it) != null && !isConfirmed(context, it) }
        val legacy = pending.count { route(context, it) == null && !isConfirmed(context, it) }
        val blocked = pending.count { isBlocked(context, it) && !isConfirmed(context, it) }
        "รอส่ง/รอ server ยืนยัน: $sendable\nserver ยืนยันแล้ว: ${confirmedCount(context)}\n" +
            "ไม่มีช่องทางส่ง (ทดสอบในเครื่อง/รุ่นเก่า): $legacy\nส่งติดขัด: $blocked\n" +
            "ส่งเมื่อมีเครือข่ายตามที่ Android อนุญาต หยุดเสียงในเครื่องไม่รอการส่ง"
    } catch (_: Exception) { "อ่านสถานะ Ack ไม่ได้ ยังไม่ยืนยันว่า server รับแล้ว" }
}
