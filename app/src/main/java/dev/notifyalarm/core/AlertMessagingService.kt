package dev.notifyalarm.core

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.time.Instant
import dev.notifyalarm.sync.AckSync

/**
 * Compile-ready FCM data receiver. It is NOT configured until the app has real Firebase options
 * and its current registration token has been securely registered with the sender/backend.
 * Push does not authenticate user/device API requests and cannot substitute for backend scopes.
 */
class AlertMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val id = data["alert_id"]?.takeIf { it.isNotBlank() && it.length <= 200 } ?: return
        try {
            when (data["type"]) {
                "acknowledged", "cancelled" -> AlarmEngine.remoteTerminal(this, id, data.getValue("type"))
                "alert", "notice" -> {
                    val importance = wireImportance(data["type"], data["importance"])
                    if (importance == null) {
                        AlarmStore.setStatus(this, "ปฏิเสธ importance ที่ไม่รู้จัก")
                        return
                    }
                    val title = data["title"]?.takeIf { it.isNotBlank() && it.length <= 120 } ?: return
                    val body = data["message"]?.takeIf { it.length <= 2000 } ?: return
                    // Remote alerts MUST expire for first-start purposes to reject stale reconnects.
                    val expiresAt = data["expires_at"]?.let { Instant.parse(it).toEpochMilli() } ?: return
                    // An invalid/missing Ack route must never suppress an otherwise valid alert.
                    val ackUrl = data["ack_url"]
                    val ackToken = data["ack_token"]
                    if (ackUrl != null && ackToken != null) {
                        try {
                            if (AckSync.registerRoute(this, id, ackUrl, ackToken)) AckSync.enqueue(this)
                        } catch (_: Exception) { /* Still deliver; no network secrets in logs/status. */ }
                    }
                    if (importance == AlertImportance.NORMAL) {
                        AlarmEngine.trigger(this, id, title, body, expiresAt, importance)
                        return
                    }
                    if (AlarmStore.active(this).any { it.id == id && it.importance == AlertImportance.NORMAL }) {
                        AlarmNotifications.showNormal(this, id)
                        return
                    }
                    if (message.priority != RemoteMessage.PRIORITY_HIGH) {
                        // Normal/deprioritized background messages do not qualify for the FGS
                        // high-priority exception. Preserve the incident and show a fallback only.
                        if (!AlarmStore.isTerminal(this, id) &&
                            expiresAt > System.currentTimeMillis()) {
                            AlarmStore.add(this, AlertRecord(id, title, body, System.currentTimeMillis()), expiresAt)
                            if (!AlarmRuntime.isPlaying) {
                                AlarmStore.setStatus(this, "ได้รับข้อความ แต่ priority ไม่ใช่ high จึงยังไม่เริ่มเสียงเบื้องหลัง")
                                AlarmNotifications.showFailure(this)
                            }
                        }
                        return
                    }
                    AlarmEngine.trigger(this, id, title, body, expiresAt)
                }
                else -> return
            }
        } catch (_: Exception) {
            AlarmStore.setStatus(this, "ประมวลผลข้อความไม่สำเร็จ กรุณาเปิดแอปเพื่อตรวจสอบ")
        }
    }

    override fun onNewToken(token: String) {
        // Private app storage only; never log or put a registration token in a notification.
        getSharedPreferences(PUSH_PREFERENCES, Context.MODE_PRIVATE).edit()
            .putString(TOKEN_KEY, token).putBoolean("needs_registration", true).apply()
    }

    companion object {
        const val PUSH_PREFERENCES = "push_registration"
        const val TOKEN_KEY = "fcm_token"

        /** Notice is safe on legacy APKs (ignored), and cannot silently become a critical alert. */
        internal fun wireImportance(type: String?, value: String?): AlertImportance? = when (type) {
            "alert" -> AlertImportance.fromWire(value)
            "notice" -> if (value == "normal") AlertImportance.NORMAL else null
            else -> null
        }
    }
}
