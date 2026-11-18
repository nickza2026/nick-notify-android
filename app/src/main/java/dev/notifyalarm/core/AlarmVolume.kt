package dev.notifyalarm.core

import android.content.Context
import android.media.AudioManager
import org.json.JSONObject

/** Default-on (80%), user-disableable, best-effort alarm-stream floor. No DND policy or ringer-mode changes. */
object AlarmVolume {
    private const val PREFS = "critical_volume_v1"
    private const val ENABLED = "enabled"
    private const val MINIMUM = "minimum_percent"
    private const val OWNERSHIP = "ownership"
    private val lock = Any()

    internal interface Stream {
        val fixed: Boolean
        val current: Int
        val maximum: Int
        fun set(level: Int)
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, true)
    fun minimum(context: Context): Int = prefs(context).getInt(MINIMUM, 80).coerceIn(1, 100)

    fun configure(context: Context, enabled: Boolean, percent: Int) {
        require(percent in 1..100)
        check(prefs(context).edit().putBoolean(ENABLED, enabled).putInt(MINIMUM, percent).commit())
    }

    private fun stream(context: Context): Stream {
        val audio = context.getSystemService(AudioManager::class.java)
        return object : Stream {
            override val fixed get() = audio.isVolumeFixed
            override val current get() = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            override val maximum get() = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            override fun set(level: Int) = audio.setStreamVolume(AudioManager.STREAM_ALARM, level, 0)
        }
    }

    /** Called only after foreground promotion and granted focus, immediately before actual playback. */
    fun begin(context: Context) = synchronized(lock) {
        try { beginWith(context, stream(context)) } catch (_: Exception) {
            AlarmStore.setStatus(context, "ปรับระดับเสียงปลุกไม่ได้ ตรวจระดับเสียงด้วยตนเอง")
        }
    }

    internal fun beginWith(context: Context, stream: Stream) {
        val p = prefs(context)
        if (!enabled(context) || p.contains(OWNERSHIP) || stream.fixed) return
        val maximum = stream.maximum
        if (maximum <= 0) return
        val before = stream.current
        val target = ((maximum * minimum(context) + 99) / 100).coerceIn(1, maximum)
        if (before >= target) return
        // Persist before touching the device. A crash between these operations restores only
        // if the observed stream equals our chosen value, never an unrelated user setting.
        check(p.edit().putString(OWNERSHIP, JSONObject().put("before", before)
            .put("applied", target).put("changed", false).toString()).commit())
        try { stream.set(target) } catch (error: Exception) {
            restoreWith(context, stream)
            throw error
        }
    }

    /** Poll while the service is alive; once a user changes volume, never fight or restore it. */
    fun observe(context: Context) = synchronized(lock) {
        try { observeWith(context, stream(context)) } catch (_: Exception) { }
    }

    internal fun observeWith(context: Context, stream: Stream) {
        val p = prefs(context)
        val raw = p.getString(OWNERSHIP, null) ?: return
        val record = JSONObject(raw)
        if (!record.optBoolean("changed") && stream.current != record.getInt("applied")) {
            check(p.edit().putString(OWNERSHIP, record.put("changed", true).toString()).commit())
        }
    }

    fun restore(context: Context) = synchronized(lock) {
        try { restoreWith(context, stream(context)) } catch (_: Exception) { }
    }

    internal fun restoreWith(context: Context, stream: Stream) {
        val p = prefs(context)
        val raw = p.getString(OWNERSHIP, null) ?: return
        val record = JSONObject(raw)
        // Preserve the snapshot if access fails, so the next app open may recover it.
        if (!record.optBoolean("changed") && !stream.fixed &&
            stream.current == record.getInt("applied") &&
            record.getInt("before") in 0..stream.maximum) {
            stream.set(record.getInt("before"))
        }
        check(p.edit().remove(OWNERSHIP).commit())
    }

    /** Opening Settings or returning from it never starts an alarm. */
    fun recoverOnOpen(context: Context) {
        if (!AlarmRuntime.serviceAlive) restore(context)
    }
}
