package dev.notifyalarm.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import dev.notifyalarm.sync.AckSync

/** Public entry point shared by the local test screen and the FCM receiver. */
object AlarmEngine {
    fun notificationsReady(context: Context, importance: AlertImportance = AlertImportance.CRITICAL): Boolean {
        AlarmNotifications.channel(context, importance)
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(if (importance == AlertImportance.NORMAL)
                AlarmNotifications.NORMAL_CHANNEL_ID else AlarmNotifications.CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
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
            if (importance == AlertImportance.NORMAL && existing?.importance == AlertImportance.CRITICAL) {
                return true // A normal replay cannot re-start or alter an existing critical alarm.
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
            if (effective == AlertImportance.NORMAL) {
                return AlarmNotifications.showNormal(app, id)
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
            ids.forEach { AlarmNotifications.cancelNormal(app, it) }
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
        if (AlarmStore.terminalNormal(context, id, type)) AlarmNotifications.cancelNormal(context, id)
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
    const val FOREGROUND_ID = 4101
    private const val FAILURE_ID = 4102
    private const val NORMAL_ID = 4103

    fun channel(context: Context, importance: AlertImportance = AlertImportance.CRITICAL) {
        val manager = context.getSystemService(NotificationManager::class.java)
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
            playing -> "เสียงปลุกกำลังดัง — รับทราบทั้งหมดเพื่อหยุด"
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

    fun showNormal(context: Context, id: String): Boolean {
        try {
            if (!AlarmEngine.notificationsReady(context, AlertImportance.NORMAL)) return false
            val record = AlarmStore.normalForPresentation(context, id) ?: return false
            channel(context, AlertImportance.NORMAL)
            val open = PendingIntent.getActivity(context, 3,
                Intent().setClassName(context.packageName, "dev.notifyalarm.MainActivity")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, NORMAL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(record.title).setContentText(record.message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(record.message))
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(open).setAutoCancel(true).setSilent(true).setSound(null)
                .build()
            // A tag, not a hash-derived int: distinct arbitrary server IDs cannot collide.
            context.getSystemService(NotificationManager::class.java).notify(id, NORMAL_ID, notification)
            AlarmStore.markNormalPresented(context, id)
            return true
        } catch (_: Exception) {
            AlarmStore.setStatus(context, "แสดงการแจ้งเตือนปกติไม่ได้ กรุณาตรวจสิทธิ์")
            return false
        }
    }

    fun cancelNormal(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java).cancel(id, NORMAL_ID)
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(FOREGROUND_ID)
        manager.cancel(FAILURE_ID)
    }
}
