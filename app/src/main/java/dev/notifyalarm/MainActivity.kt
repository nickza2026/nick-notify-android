package dev.notifyalarm

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dev.notifyalarm.core.AlarmEngine
import dev.notifyalarm.core.AlarmStore
import dev.notifyalarm.core.AlarmSoundSettings
import dev.notifyalarm.sync.AckSync
import java.util.UUID

/** Local-first test screen. No server API key or Firebase credentials in source. */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var active: TextView
    private lateinit var remote: TextView
    private lateinit var sound: TextView
    private lateinit var ackStatus: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() { updateStatus(); handler.postDelayed(this, 1000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 40, 32, 40)
            setBackgroundColor(Color.rgb(247, 248, 250))
        }
        setContentView(ScrollView(this).apply {
            addView(layout)
            setOnApplyWindowInsetsListener { _, insets ->
                @Suppress("DEPRECATION")
                layout.setPadding(32, insets.systemWindowInsetTop + 24, 32, insets.systemWindowInsetBottom + 24)
                insets
            }
        })
        fun text(value: String, size: Float = 16f): TextView = TextView(this).apply {
            text = value; textSize = size; setTextColor(Color.rgb(25, 35, 50))
            setPadding(0, 12, 0, 12); layout.addView(this)
        }
        fun button(label: String, action: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; setOnClickListener { action() }
            layout.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 12 })
        }
        text("Notify Alarm", 30f)
        text("Pixel 6 Pro · Android alarm PoC", 16f)
        text("เมื่อเริ่มทดสอบ เสียงจะวนจนกดรับทราบทั้งหมด ระวังระดับเสียงก่อนเริ่ม ไม่ใช่ระบบที่รับประกันการปลุกทุกสถานะ")
        status = text("กำลังตรวจสิทธิ์…")
        active = text("", 18f)
        sound = text("เสียงที่ใช้: ${AlarmSoundSettings.label(this)}")
        button("เลือกเสียงปลุก") { chooseSound() }
        button("อนุญาตการแจ้งเตือน") { requestNotifications() }
        button("ตั้งค่าแบตเตอรี่ / การทำงานเบื้องหลัง") {
            openSettings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        button("ตั้งค่าระดับเสียงปลุก") { openSettings(Intent(Settings.ACTION_SOUND_SETTINGS)) }
        button("ตั้งค่าเสียง / Do Not Disturb") { openSettings(Intent(Settings.ACTION_SOUND_SETTINGS)) }
        button("ตั้งค่า channel การปลุก") {
            openSettings(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, "alarm_playback_v1"))
        }
        button("ทดสอบเสียงวนจนกดรับทราบ") {
            if (!notificationsEnabled()) {
                Toast.makeText(this, "กรุณาอนุญาตแจ้งเตือนก่อนเริ่มทดสอบ", Toast.LENGTH_LONG).show()
                requestNotifications()
            } else {
                AlertDialog.Builder(this)
                    .setTitle("เริ่มเสียงปลุกวน?")
                    .setMessage("เสียงจะไม่หยุดเอง กรุณาตรวจระดับเสียง และกดรับทราบเพื่อหยุด")
                    .setNegativeButton("ยกเลิก", null)
                    .setPositiveButton("เริ่มทดสอบ") { _, _ ->
                        val ok = AlarmEngine.trigger(this, "test-${UUID.randomUUID()}",
                            "ทดสอบแจ้งเตือนตู้ดับ", "นี่คือเหตุการณ์ทดสอบ ไม่ใช่ข้อมูลจากตู้จริง")
                        if (!ok) Toast.makeText(this, "เริ่มปลุกไม่ได้ ตรวจสถานะด้านล่าง", Toast.LENGTH_LONG).show()
                        updateStatus()
                    }.show()
            }
        }
        button("รับทราบทั้งหมด / หยุดเสียง") {
            AlarmEngine.acknowledgeAll(this)
            updateStatus()
        }.apply { setTextColor(Color.rgb(150, 0, 0)); minimumHeight = 130 }
        button("ลองเริ่มเสียงเหตุการณ์ค้างอีกครั้ง") {
            val pending = AlarmStore.criticalActive(this).firstOrNull()
            if (pending == null) {
                Toast.makeText(this, "ไม่มีเหตุการณ์เสียงปลุกค้าง", Toast.LENGTH_SHORT).show()
            } else {
                AlarmEngine.trigger(this, pending.id, pending.title, pending.message)
                updateStatus()
            }
        }
        text("Remote API / FCM", 22f)
        val firebaseConfigured = FirebaseApp.getApps(this).any { it.name == FirebaseApp.DEFAULT_APP_NAME }
        remote = text(if (firebaseConfigured)
            "มี Firebase config ใน APK แล้ว — กดปุ่มด้านล่างเพื่อขอ FCM token ยังไม่ได้ยืนยันการรับ push จริง"
            else "ยังไม่ได้ตั้งค่า Firebase — ทดสอบเสียงในเครื่องได้ แต่ยังไม่พร้อมรับเหตุการณ์จาก server")
        button("ตรวจการตั้งค่า Firebase / คัดลอก token") { inspectFirebase() }
        text("การรับทราบกลับ server", 22f)
        ackStatus = text("กำลังตรวจคิว Ack…")
        button("ลองส่ง Ack ที่ค้างอีกครั้ง") {
            try { AckSync.enqueue(this) } catch (_: Exception) {
                Toast.makeText(this, "ยังจัดคิวส่งไม่ได้ รายการรับทราบยังอยู่ในเครื่อง", Toast.LENGTH_LONG).show()
            }
            updateStatus()
        }
        text("รับทราบหยุดเสียงทันทีโดยไม่รอเน็ต สำหรับเหตุการณ์ใหม่ที่ server แนบ HTTPS Ack route แอปจะจัดคิวส่งเมื่อระบบอนุญาต และแสดงแยกเมื่อ server ยืนยันแล้ว เหตุการณ์รุ่นเก่า/ทดสอบในเครื่องอาจไม่มีช่องทางส่งกลับ ไม่มี full-screen alarm หรือเริ่มเสียงอัตโนมัติหลัง reboot")
    }

    override fun onResume() {
        super.onResume()
        try { AckSync.enqueue(this) } catch (_: Exception) { }
        handler.post(refresh)
    }
    override fun onPause() { handler.removeCallbacks(refresh); super.onPause() }

    private fun notificationsEnabled(): Boolean = AlarmEngine.notificationsReady(this)

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
        } else {
            openSettings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
    }

    private fun updateStatus() {
        val audio = getSystemService(AudioManager::class.java)
        val power = getSystemService(PowerManager::class.java)
        val manager = getSystemService(NotificationManager::class.java)
        status.text = "แจ้งเตือนและ channel: ${if (notificationsEnabled()) "อนุญาต" else "ยังไม่อนุญาต / channel ถูกปิด"}\n" +
            "ระดับเสียงปลุก: ${audio.getStreamVolume(AudioManager.STREAM_ALARM)}/${audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)}\n" +
            "DND filter: ${manager.currentInterruptionFilter} (ต้องทดสอบเสียงจริง)\n" +
            "ยกเว้น battery optimization: ${if (power.isIgnoringBatteryOptimizations(packageName)) "ใช่" else "ยังไม่ยืนยัน / ตรวจใน Settings"}\n" +
            "สถานะ engine: ${AlarmStore.status(this)}"
        val records = AlarmStore.active(this)
        active.text = if (records.isEmpty()) "ไม่มีเหตุการณ์ที่ยังไม่รับทราบ" else
            "ยังไม่รับทราบ ${records.size} เหตุการณ์\n" + records.joinToString("\n") {
                "• ${if (it.importance == dev.notifyalarm.core.AlertImportance.NORMAL) "ปกติ" else "สำคัญ"}: ${it.title}"
            }
        sound.text = "เสียงที่ใช้: ${AlarmSoundSettings.label(this)}\nเปลี่ยนแล้วมีผลเมื่อเริ่มเสียงครั้งถัดไป หากเล่นไม่ได้จะใช้เสียงสำรองของแอป"
        ackStatus.text = AckSync.status(this)
    }

    private fun chooseSound() {
        AlertDialog.Builder(this).setTitle("เลือกเสียงปลุก")
            .setItems(arrayOf("เลือกจากเสียงปลุกของ Android", "นำเข้าไฟล์เสียง (ไม่เกิน 20 MiB)",
                "ใช้เสียงปลุกเริ่มต้นของ Android", "ใช้เสียงสำรองของแอป")) { _, which ->
                try {
                    when (which) {
                        0 -> startActivityForResult(Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
                            .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                            .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, AlarmSoundSettings.resolve(this)), 201)
                        1 -> startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            type = "audio/*"; addCategory(Intent.CATEGORY_OPENABLE)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }, 202)
                        2 -> AlarmSoundSettings.useDefault(this)
                        3 -> AlarmSoundSettings.useBuiltin(this)
                    }
                    updateStatus()
                } catch (_: Exception) {
                    Toast.makeText(this, "เปิดตัวเลือกเสียงหรือบันทึกค่าไม่ได้", Toast.LENGTH_LONG).show()
                }
            }.setNegativeButton("ปิด", null).show()
    }

    @Deprecated("Legacy Activity callback used by this native PoC")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return
        if (requestCode == 201) {
            @Suppress("DEPRECATION")
            val uri = data.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI) ?: return
            try {
                val label = try { RingtoneManager.getRingtone(this, uri)?.getTitle(this) } catch (_: Exception) { null }
                AlarmSoundSettings.useSystem(this, uri, label ?: "เสียงปลุกที่เลือกจาก Android")
                updateStatus()
            } catch (_: Exception) { Toast.makeText(this, "บันทึกเสียงที่เลือกไม่ได้", Toast.LENGTH_LONG).show() }
        } else if (requestCode == 202) {
            val uri = data.data ?: return
            val app = applicationContext
            Toast.makeText(this, "กำลังคัดลอกไฟล์เสียง…", Toast.LENGTH_SHORT).show()
            Thread {
                val success = try {
                    AlarmSoundSettings.importAudio(app, uri, "ไฟล์เสียงส่วนตัว")
                    true
                } catch (_: Exception) { false }
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        Toast.makeText(this, if (success) "บันทึกเสียงแล้ว ใช้ในการปลุกครั้งถัดไป" else
                            "นำเข้าไม่ได้: ตรวจว่าเป็นไฟล์เสียงที่เล่นได้ ขนาดไม่เกิน 20 MiB และมีพื้นที่ว่าง", Toast.LENGTH_LONG).show()
                        updateStatus()
                    }
                }
            }.start()
        }
    }

    private fun inspectFirebase() {
        val app = FirebaseApp.getApps(this).firstOrNull() ?: FirebaseApp.initializeApp(this)
        if (app == null) {
            remote.text = "ยังไม่ได้ตั้งค่า Firebase: ไม่มี google_app_id / sender ID ของโครงการคุณ อ่าน docs/android-poc-th.md"
            return
        }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (isFinishing || isDestroyed) return@addOnCompleteListener
            if (!task.isSuccessful) {
                remote.text = "ขอ FCM token ไม่สำเร็จ ตรวจการตั้งค่า Firebase และอินเทอร์เน็ต"
            } else {
                val token = task.result
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("FCM device token", token))
                remote.text = "คัดลอก FCM device token แล้ว เก็บเป็นข้อมูลอ่อนไหว ไม่ใช่หลักฐานว่าทดสอบรับ push ผ่าน"
            }
        }
    }

    private fun openSettings(intent: Intent) {
        try { startActivity(intent) } catch (_: Exception) {
            Toast.makeText(this, "เปิด Settings อัตโนมัติไม่ได้ กรุณาเปิดจากระบบ", Toast.LENGTH_LONG).show()
        }
    }
}
