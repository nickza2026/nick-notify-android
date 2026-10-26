package dev.notifyalarm.core

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class AlertImportance {
    NORMAL, CRITICAL;

    companion object {
        /** Missing is a legacy critical alert; an unknown explicit value is never promoted. */
        fun fromWire(value: String?): AlertImportance? = when (value) {
            null -> CRITICAL
            "normal" -> NORMAL
            "critical" -> CRITICAL
            else -> null
        }
    }
}

data class AlertRecord(val id: String, val title: String, val message: String, val createdAt: Long,
                       val importance: AlertImportance = AlertImportance.CRITICAL)

/**
 * Device-local incident state. Acknowledgements are committed before stopping sound, including when
 * offline. Tombstones deliberately are not pruned in this PoC: replay of a previously acknowledged
 * incident must not start sound again. A production implementation should move this to a database
 * with an explicit retention/expiry policy, rather than silently dropping old acknowledgement IDs.
 */
object AlarmStore {
    internal const val PREFERENCES = "native_alarm_state"
    internal const val STATE_KEY = "incidents_v1"
    private const val STATUS_KEY = "last_status"
    private val lock = Any()

    internal fun preferences(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun read(context: Context): JSONObject {
        val raw = preferences(context).getString(STATE_KEY, null)
        if (raw == null) return JSONObject().put("active", JSONArray())
            .put("terminal", JSONObject()).put("pending_ack", JSONArray())
        // Do not overwrite a corrupt record with an empty record, losing durable deduplication.
        return JSONObject(raw).also {
            require(it.optJSONArray("active") != null && it.optJSONObject("terminal") != null &&
                it.optJSONArray("pending_ack") != null) { "Invalid incident state" }
        }
    }

    private fun write(context: Context, state: JSONObject) {
        check(preferences(context).edit().putString(STATE_KEY, state.toString()).commit()) {
            "Cannot persist incident state"
        }
    }

    private fun records(state: JSONObject): List<AlertRecord> {
        val array = state.getJSONArray("active")
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            AlertRecord(item.getString("id"), item.getString("title"),
                item.getString("message"), item.getLong("created_at"),
                AlertImportance.fromWire(item.optString("importance", "critical"))
                    ?: error("Invalid saved alert importance"))
        }
    }

    fun active(context: Context): List<AlertRecord> = synchronized(lock) {
        try {
            records(read(context))
        } catch (_: Exception) {
            setStatus(context, "อ่านข้อมูลเหตุการณ์ไม่ได้ กรุณาตรวจพื้นที่จัดเก็บ")
            emptyList()
        }
    }

    fun criticalActive(context: Context): List<AlertRecord> =
        active(context).filter { it.importance == AlertImportance.CRITICAL }

    fun hasCritical(context: Context): Boolean = criticalActive(context).isNotEmpty()

    fun isAcknowledged(context: Context, id: String): Boolean = synchronized(lock) {
        // Cancelled incidents also suppress replay, but are not reported as a human acknowledgement.
        read(context).getJSONObject("terminal").optJSONObject(id)?.optString("type") == "acknowledged"
    }

    internal fun isTerminal(context: Context, id: String): Boolean = synchronized(lock) {
        read(context).getJSONObject("terminal").has(id)
    }

    /** false means the ID already exists or is terminal; never removes other active incidents. */
    internal fun add(context: Context, alert: AlertRecord, expiresAtMillis: Long? = null): Boolean = synchronized(lock) {
        val state = read(context)
        if (state.getJSONObject("terminal").has(alert.id) || records(state).any { it.id == alert.id }) {
            return@synchronized false
        }
        state.getJSONArray("active").put(JSONObject()
            .put("id", alert.id).put("title", alert.title).put("message", alert.message)
            .put("created_at", alert.createdAt).put("importance", alert.importance.name.lowercase())
            .put("started", false)
            .put("expires_at", expiresAtMillis ?: JSONObject.NULL))
        write(context, state)
        true
    }

    /** Expiry gates first playback/presentation only; delivered incidents remain until Ack. */
    internal fun discardExpiredBeforeStart(context: Context) = synchronized(lock) {
        val state = read(context)
        val array = state.getJSONArray("active")
        val kept = JSONArray()
        var changed = false
        val now = System.currentTimeMillis()
        for (i in 0 until array.length()) {
            val item = array.getJSONObject(i)
            val isNormal = item.optString("importance", "critical") == "normal"
            if (!(if (isNormal) item.optBoolean("normal_presented") else item.optBoolean("started")) &&
                !item.isNull("expires_at") &&
                item.optLong("expires_at", Long.MAX_VALUE) <= now) {
                state.getJSONObject("terminal").put(item.getString("id"), JSONObject()
                    .put("type", "expired").put("at", now))
                changed = true
            } else kept.put(item)
        }
        if (changed) {
            state.put("active", kept)
            write(context, state)
        }
    }

    /** Replays use the original expiry and mode, never the new push's claimed TTL or importance. */
    internal fun normalForPresentation(context: Context, id: String): AlertRecord? = synchronized(lock) {
        val state = read(context)
        val array = state.getJSONArray("active")
        for (i in 0 until array.length()) {
            val item = array.getJSONObject(i)
            if (item.getString("id") != id || item.optString("importance", "critical") != "normal") continue
            if (!item.optBoolean("normal_presented") && !item.isNull("expires_at") &&
                item.optLong("expires_at", Long.MAX_VALUE) <= System.currentTimeMillis()) {
                val kept = JSONArray()
                for (j in 0 until array.length()) if (j != i) kept.put(array.getJSONObject(j))
                state.put("active", kept)
                state.getJSONObject("terminal").put(id, JSONObject()
                    .put("type", "expired").put("at", System.currentTimeMillis()))
                write(context, state)
                return@synchronized null
            }
            return@synchronized AlertRecord(id, item.getString("title"), item.getString("message"),
                item.getLong("created_at"), AlertImportance.NORMAL)
        }
        null
    }

    /** Record only after NotificationManager accepted the normal notification. */
    internal fun markNormalPresented(context: Context, id: String) = synchronized(lock) {
        val state = read(context)
        val array = state.getJSONArray("active")
        for (i in 0 until array.length()) {
            val item = array.getJSONObject(i)
            if (item.getString("id") == id && item.optString("importance", "critical") == "normal" &&
                !item.optBoolean("normal_presented")) {
                item.put("normal_presented", true)
                write(context, state)
                break
            }
        }
    }

    internal fun markPlaybackStarted(context: Context) = synchronized(lock) {
        val state = read(context)
        val array = state.getJSONArray("active")
        var changed = false
        for (i in 0 until array.length()) {
            val item = array.getJSONObject(i)
            if (item.optString("importance", "critical") == "critical" && !item.optBoolean("started")) {
                item.put("started", true)
                changed = true
            }
        }
        if (changed) write(context, state)
    }

    /** Explicit local acknowledgement of all currently active incidents, not a server receipt. */
    fun acknowledgeAll(context: Context): List<String> = synchronized(lock) {
        val state = read(context)
        val ids = records(state).map { it.id }
        val terminal = state.getJSONObject("terminal")
        val pending = state.getJSONArray("pending_ack")
        val existing = (0 until pending.length()).map { pending.getString(it) }.toSet()
        val now = System.currentTimeMillis()
        val actionId = UUID.randomUUID().toString()
        ids.forEach { id ->
            if (!terminal.has(id)) terminal.put(id, JSONObject()
                .put("type", "acknowledged").put("at", now).put("client_action_id", actionId))
            if (id !in existing) pending.put(id)
        }
        state.put("active", JSONArray())
        write(context, state)
        setStatus(context, "รับทราบแล้ว หยุดเสียงบนเครื่องแล้ว")
        ids
    }

    /**
     * Remote terminal messages carry only an ID, not a trusted importance. They may dismiss an
     * already active normal notice, but must never preempt an unknown future critical ID or remove
     * an active critical alarm. Only the local human Ack path may clear a critical incident.
     */
    internal fun terminalNormal(context: Context, id: String, type: String): Boolean = synchronized(lock) {
        require(type == "acknowledged" || type == "cancelled")
        val state = read(context)
        val terminal = state.getJSONObject("terminal")
        val active = state.getJSONArray("active")
        // Reject conflicting/corrupt IDs too: a normal entry must never tombstone a critical one.
        if (terminal.has(id) || (0 until active.length()).any { i ->
                val item = active.getJSONObject(i)
                item.getString("id") == id && item.optString("importance", "critical") != "normal"
            }) return@synchronized false
        val remaining = JSONArray()
        var dismissed = false
        for (i in 0 until active.length()) {
            val item = active.getJSONObject(i)
            if (item.getString("id") == id && item.optString("importance", "critical") == "normal") {
                dismissed = true
            } else remaining.put(item)
        }
        if (!dismissed) return@synchronized false
        terminal.put(id, JSONObject().put("type", type).put("at", System.currentTimeMillis()))
        state.put("active", remaining)
        write(context, state)
        true
    }

    fun pendingAcknowledgements(context: Context): List<String> = synchronized(lock) {
        val array = read(context).getJSONArray("pending_ack")
        (0 until array.length()).map { array.getString(it) }
    }

    /** Local action time is telemetry, never the server's authoritative receipt time. */
    fun acknowledgedAt(context: Context, id: String): Long? = synchronized(lock) {
        val record = read(context).getJSONObject("terminal").optJSONObject(id)
        if (record?.optString("type") == "acknowledged") {
            record.optLong("at").takeIf { it > 0 }
        } else null
    }

    /** One human Ack-all tap shares an action ID across its alerts; retries reuse that ID. */
    fun acknowledgementActionId(context: Context, id: String): String? = synchronized(lock) {
        val record = read(context).getJSONObject("terminal").optJSONObject(id)
        if (record == null || record.optString("type") != "acknowledged" || record.optLong("at") <= 0) {
            return@synchronized null
        }
        val saved = record.optString("client_action_id")
        if (saved.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))) saved
        else UUID.nameUUIDFromBytes("legacy-ack:$id:${record.optLong("at")}".toByteArray(Charsets.UTF_8)).toString()
    }

    /** Call only after the backend durably confirms those acknowledgements. */
    fun confirmAcknowledgements(context: Context, confirmedIds: Set<String>) = synchronized(lock) {
        val state = read(context)
        val pending = state.getJSONArray("pending_ack")
        val remaining = JSONArray()
        for (i in 0 until pending.length()) {
            val id = pending.getString(i)
            if (id !in confirmedIds) remaining.put(id)
        }
        state.put("pending_ack", remaining)
        write(context, state)
    }

    internal fun setStatus(context: Context, value: String) {
        preferences(context).edit().putString(STATUS_KEY, value).apply()
    }

    /** In-memory playback truth never survives process death as a false "currently ringing" claim. */
    fun status(context: Context): String {
        if (AlarmRuntime.isPlaying) return "กำลังส่งเสียงปลุก — กดรับทราบเพื่อหยุด"
        val last = preferences(context).getString(STATUS_KEY, "พร้อมทดสอบเสียงปลุก")!!
        return if (hasCritical(context)) {
            val detail = if (last.startsWith("กำลังส่งเสียง") || last.startsWith("กำลังเตรียมเสียง")) {
                "สถานะเดิมไม่ยืนยันว่าเสียงยังทำงานอยู่ เปิดแอปและทดสอบใหม่"
            } else last
            "มีเหตุการณ์ค้าง แต่เสียงยังไม่ทำงานหรือถูกขัดจังหวะ\n$detail"
        } else if (active(context).isNotEmpty()) "มีการแจ้งเตือนปกติค้างรอรับทราบ\n$last"
        else last
    }
}

internal object AlarmRuntime {
    @Volatile var isPlaying: Boolean = false
}
