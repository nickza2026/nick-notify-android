package dev.notifyalarm.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import dev.notifyalarm.sync.AckSync

/** Public entry point shared by the local test screen and the FCM receiver. */
object AlarmEngine {
    fun notificationsReady(context: Context, importance: AlertImportance = AlertImportance.CRITICAL): Boolean {
        AlarmNotifications.channel(context, importance)
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(when (importance) {
                AlertImportance.NORMAL -> AlarmNotifications.NORMAL_CHANNEL_ID
                AlertImportance.URGENT -> AlarmNotifications.URGENT_CHANNEL_ID
                AlertImportance.CRITICAL -> AlarmNotifications.CHANNEL_ID
            })?.importance != NotificationManager.IMPORTANCE_NONE
    }

    /**
     * True means an active incident was accepted, NOT that the service or sound has started.
     * expiresAtMillis is the latest permitted FIRST START time; it never auto-stops an already
     * accepted/ringing incident. This PoC follows the user's ring-until-Ack requirement.
     */
    @Synchronized
    fun trigger(context: Context, id: String, title: String, message: String,
                expiresAtMillis: Long? = null,
                importance: AlertImportance = AlertImportance.CRITICAL): Boolean {
        val app = context.applicationContext
        if (id.isBlank() || id.length > 200 || title.isBlank() || title.length > 120 ||
            message.length > 2000) {
            AlarmStore.setStatus(app, "ปฏิเสธข้อความปลุก: รูปแบบไม่ถูกต้อง")
            return false
        }
        try {
            if (AlarmStore.isTerminal(app, id)) return false
            val existing = AlarmStore.active(app).firstOrNull { it.id == id }
            val alreadyActive = existing != null
            if (importance != AlertImportance.CRITICAL && existing?.importance == AlertImportance.CRITICAL) {
                return true // A notice replay must not start or alter a critical alarm.
            }
            if (!alreadyActive && expiresAtMillis != null && System.currentTimeMillis() >= expiresAtMillis) {
                AlarmStore.setStatus(app, "ไม่เริ่มปลุก: เหตุการณ์หมดอายุการเริ่มแล้ว")
                return false
            }
            if (!alreadyActive) {
                AlarmStore.add(app, AlertRecord(id, title, message, System.currentTimeMillis(), importance), expiresAtMillis)
            }
            // An ID's original mode is immutable. In particular a normal replay cannot become a siren.
            val effective = existing?.importance ?: importance
            if (!notificationsReady(app, effective)) {
                AlarmStore.setStatus(app, "ยังไม่เริ่มเสียง: กรุณาอนุญาตการแจ้งเตือนแล้วลองอีกครั้ง")
                return false
            }
            if (effective != AlertImportance.CRITICAL) {
                return AlarmNotifications.showNotice(app, id)
            }
            // Preserve the incident even if this call is refused by Android's background rules.
            app.startForegroundService(Intent(app, AlarmService::class.java).setAction(AlarmService.ACTION_SYNC))
            return true
        } catch (_: Exception) {
            AlarmStore.setStatus(app, "เริ่ม service ไม่ได้ อาจถูก Android จำกัด กรุณาเปิดแอปแล้วทดสอบใหม่")
            if (importance == AlertImportance.CRITICAL && !AlarmRuntime.isPlaying) AlarmNotifications.showFailure(app)
            return false
        }
    }

    @Synchronized
    fun acknowledgeAll(context: Context) {
        val app = context.applicationContext
        try {
            val ids = AlarmStore.acknowledgeAll(app)
            ids.forEach { AlarmNotifications.cancelNotice(app, it) }
        } catch (_: Exception) {
            AlarmStore.setStatus(app, "หยุดเสียงแล้ว แต่บันทึก Ack ไม่สำเร็จ กรุณาตรวจพื้นที่จัดเก็บ")
        } finally {
            // The stop is entirely local and never waits for network or backend acknowledgement.
            app.stopService(Intent(app, AlarmService::class.java))
            AlarmNotifications.cancel(app)
        }
        // Sync is queued only after the local stop; never make stopping sound wait for network.
        try { AckSync.enqueue(app) } catch (_: Exception) { /* Durable pending IDs remain. */ }
    }

    @Synchronized
    internal fun remoteTerminal(context: Context, id: String, type: String) {
        // A server message is never a human Ack. Only dismiss a known normal notification;
        // unknown IDs could arrive before critical FCM data and must not become tombstones.
        if (AlarmStore.terminalNormal(context, id, type)) AlarmNotifications.cancelNotice(context, id)
    }
}

/** Explicit PendingIntent target. Manifest MUST declare exported=false. */
class AlarmActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_ACKNOWLEDGE_ALL) AlarmEngine.acknowledgeAll(context)
    }

    companion object {
        const val ACTION_ACKNOWLEDGE_ALL = "dev.notifyalarm.ACKNOWLEDGE_ALL"
    }
}

internal object AlarmNotifications {
    const val CHANNEL_ID = "alarm_playback_v1"
    const val NORMAL_CHANNEL_ID = "normal_alerts_v1"
    // v1 played a notification-stream sound, which a channel cannot drop after creation.
    const val URGENT_CHANNEL_ID = "urgent_notices_v2"
    private const val LEGACY_URGENT_CHANNEL_ID = "urgent_notices_v1"
    const val FOREGROUND_ID = 4101
    private const val FAILURE_ID = 4102
    private const val NORMAL_ID = 4103

    /** Replaced by tests; production plays one alarm-stream sound per urgent ID. */
    internal var playUrgent: (Context) -> Unit = UrgentSound::play

    fun channel(context: Context, importance: AlertImportance = AlertImportance.CRITICAL) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (importance == AlertImportance.URGENT) {
            manager.deleteNotificationChannel(LEGACY_URGENT_CHANNEL_ID)
            val urgent = NotificationChannel(URGENT_CHANNEL_ID, "แจ้งเตือนเร่งด่วน", NotificationManager.IMPORTANCE_HIGH)
            urgent.description = "เสียงดังครั้งเดียวผ่านเสียงปลุก แม้เครื่องอยู่โหมดเงียบหรือสั่น; ตั้งเครื่องนี้เป็นเงียบได้จากหน้าเว็บ"
            urgent.setSound(null, null)
            urgent.enableVibration(false)
            manager.createNotificationChannel(urgent)
            return
        }
        if (importance == AlertImportance.NORMAL) {
            val normal = NotificationChannel(NORMAL_CHANNEL_ID, "การแจ้งเตือนปกติ", NotificationManager.IMPORTANCE_LOW)
            normal.description = "แจ้งเตือนเงียบ ไม่เล่นเสียงปลุก"
            normal.setSound(null, null)
            normal.enableVibration(false)
            manager.createNotificationChannel(normal)
            return
        }
        val channel = NotificationChannel(CHANNEL_ID, "เสียงปลุกและเหตุการณ์ค้าง", NotificationManager.IMPORTANCE_HIGH)
        channel.description = "เสียงวนเล่นโดย service; ปุ่มรับทราบจะหยุดเสียงทุกเหตุการณ์บนเครื่อง"
        // MediaPlayer owns looping sound; avoid a second sound on every notification refresh.
        channel.setSound(null, null)
        channel.enableVibration(false)
        // Honored only for a not-yet-created channel and only in DND priority mode; it never unmutes Alarms.
        channel.setBypassDnd(true)
        manager.createNotificationChannel(channel)
    }

    fun build(context: Context, playing: Boolean, failure: Boolean = false): Notification {
        channel(context)
        val active = AlarmStore.criticalActive(context)
        val count = active.size
        val contentIntent = PendingIntent.getActivity(context, 1,
            Intent().setClassName(context.packageName, "dev.notifyalarm.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val acknowledge = PendingIntent.getBroadcast(context, 2,
            Intent(context, AlarmActionReceiver::class.java)
                .setAction(AlarmActionReceiver.ACTION_ACKNOWLEDGE_ALL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = when {
            failure -> "เสียงยังไม่ทำงาน — เปิดแอปเพื่อตรวจสอบ"
            playing -> "ตัวเล่นเสียงเริ่มแล้ว (DND/ระดับเสียงอาจปิดเสียง) — รับทราบเพื่อหยุด"
            else -> "มีเหตุการณ์ค้าง — กำลังเริ่มเสียงหรือเสียงถูกขัดจังหวะ"
        }
        val publicVersion = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Notify Alarm: $count เหตุการณ์")
            .setContentText(text).setContentIntent(contentIntent).build()
        return Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(active.firstOrNull()?.title ?: "Notify Alarm")
            .setContentText("$count เหตุการณ์ • $text")
            .setStyle(Notification.BigTextStyle().bigText(text + "\n" +
                active.take(5).joinToString("\n") { it.title }))
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(!failure)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,
                "รับทราบทั้งหมด / หยุดเสียง", acknowledge).build())
            .build()
    }

    fun showFailure(context: Context) {
        try {
            context.getSystemService(NotificationManager::class.java)
                .notify(FAILURE_ID, build(context, playing = false, failure = true))
        } catch (_: Exception) {
            // Permission/channel may be disabled; status remains visible when the app opens.
        }
    }

    fun clearFailure(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(FAILURE_ID)
    }

    internal fun showNotice(context: Context, id: String,
                            post: (NotificationManager, String, Int, Notification) -> Unit =
                                { manager, tag, number, notification -> manager.notify(tag, number, notification) }): Boolean {
        try {
            val record = AlarmStore.noticeForPresentation(context, id) ?: return false
            if (record.importance == AlertImportance.URGENT && AlarmStore.noticePresented(context, id)) return true
            if (!AlarmEngine.notificationsReady(context, record.importance)) return false
            channel(context, record.importance)
            val open = PendingIntent.getActivity(context, 3,
                Intent().setClassName(context.packageName, "dev.notifyalarm.MainActivity")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val urgent = record.importance == AlertImportance.URGENT
            // The reservation is durable before playback: a failed notify may retry the
            // notice, but a replay, reopen or retry can never sound again.
            if (urgent && AlarmStore.reserveUrgentSound(context, id)) {
                try { playUrgent(context) } catch (_: Exception) {
                    AlarmStore.setStatus(context, "เล่นเสียงแจ้งเตือนด่วนไม่ได้ ตรวจระดับเสียงปลุก")
                }
            }
            val notification = NotificationCompat.Builder(context, if (urgent) URGENT_CHANNEL_ID else NORMAL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(record.title).setContentText(record.message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(record.message))
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setSilent(true)
                .build()
            // A tag, not a hash-derived int: distinct arbitrary server IDs cannot collide.
            post(context.getSystemService(NotificationManager::class.java), id, NORMAL_ID, notification)
            AlarmStore.markNoticePresented(context, id)
            return true
        } catch (_: Exception) {
            AlarmStore.setStatus(context, "แสดงการแจ้งเตือนปกติไม่ได้ กรุณาตรวจสิทธิ์")
            return false
        }
    }

    fun cancelNotice(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java).cancel(id, NORMAL_ID)
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(FOREGROUND_ID)
        manager.cancel(FAILURE_ID)
    }
}

/** One non-looping sound on the alarm stream: audible in vibrate/silent ringer, still subject to DND Alarms. */
internal object UrgentSound {
    private const val MAX_PLAY_MS = 15_000L

    fun play(context: Context) {
        val app = context.applicationContext
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            player.setDataSource(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            player.isLooping = false
            player.setOnPreparedListener { it.start() }
            player.setOnCompletionListener { it.release() }
            player.setOnErrorListener { mp, _, _ -> mp.release(); true }
            player.prepareAsync()
            Handler(Looper.getMainLooper()).postDelayed({ player.release() }, MAX_PLAY_MS)
        } catch (error: Exception) {
            player.release()
            throw error
        }
    }
}

/** Read-only DND classification for status text; the app never changes the user's DND rules. */
internal object DndCheck {
    fun blocksAlarms(filter: Int, priorityCategories: Int?): Boolean = when (filter) {
        NotificationManager.INTERRUPTION_FILTER_NONE -> true
        NotificationManager.INTERRUPTION_FILTER_PRIORITY ->
            priorityCategories != null && (priorityCategories and PRIORITY_CATEGORY_ALARMS) == 0
        else -> false
    }

    fun blocksAlarms(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        // Before API 28 priority mode had no Alarms category and always allowed alarms.
        val categories = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) null
            else try { manager.notificationPolicy?.priorityCategories } catch (_: Exception) { null }
        return blocksAlarms(manager.currentInterruptionFilter, categories)
    }

    private const val PRIORITY_CATEGORY_ALARMS = 1 shl 5
}
