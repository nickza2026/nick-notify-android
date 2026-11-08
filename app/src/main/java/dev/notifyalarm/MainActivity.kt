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
import android.widget.EditText
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
import dev.notifyalarm.sync.ClientAccount
import dev.notifyalarm.sync.ClientApi
import dev.notifyalarm.sync.ClientPolicy
import dev.notifyalarm.sync.ClientRegistration
import java.util.UUID

/** Local-first test screen. No server API key or Firebase credentials in source. */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var active: TextView
    private lateinit var remote: TextView
    private lateinit var sound: TextView
    private lateinit var ackStatus: TextView
    private lateinit var accountStatus: TextView
    private lateinit var accountMessage: TextView
    private lateinit var serverInput: EditText
    private lateinit var userInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var deviceInput: EditText
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
        text("บัญชีและเครื่องที่รับแจ้งเตือน", 22f)
        fun input(hint: String, secret: Boolean = false) = EditText(this).apply {
            this.hint = hint
            if (secret) inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            layout.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
        serverInput = input("HTTPS server URL เช่น https://example.com")
        userInput = input("ชื่อผู้ใช้ (บัญชีเดียวกันทั้งสองเครื่อง)")
        passwordInput = input("รหัสผ่าน", true)
        deviceInput = input("ชื่อเครื่อง เช่น โทรศัพท์ของฉัน")
        accountStatus = text(ClientRegistration.status(this))
        accountMessage = text("")
        button("เข้าสู่ระบบและลงทะเบียนเครื่อง") { login() }
        button("ตรวจสอบ / ส่งลงทะเบียนอีกครั้ง") {
            requestFirebaseRegistration()
            accountTask { session ->
                val result = ClientApi.call(session.base, "/v1/client/session", session.bearer)
                if (result.status == 401) ClientAccount.requireLogin(this, session.generation)
                if (result.status == 200) ClientRegistration.enqueue(this)
                if (result.status == 200) "ตรวจสอบเซสชันแล้ว กำลังลงทะเบียน" else "ตรวจสอบไม่ได้ กรุณาดูสถานะบัญชี"
            }
        }
        button("ดูคีย์ที่อนุญาตและเครื่องที่ลงทะเบียน") {
            accountTask { session ->
                if (session.mustChange) "ต้องเปลี่ยนรหัสผ่านก่อน" else {
                    val keys = ClientApi.call(session.base, "/v1/client/keys", session.bearer)
                    val devices = ClientApi.call(session.base, "/v1/client/devices", session.bearer)
                    if (keys.status != 200 || devices.status != 200) "อ่านรายการเครื่องไม่ได้ กรุณาตรวจเซสชัน" else {
                        val items = devices.body.optJSONArray("items")
                        val names = (0 until (items?.length() ?: 0)).mapNotNull { i ->
                            items?.optJSONObject(i)?.let { device ->
                                val label = device.optString("device_name").take(80)
                                "$label: ${if (device.optBoolean("active")) "ใช้งาน" else "ไม่ใช้งาน"}"
                            }
                        }
                        "คีย์ที่อนุญาต: ${keys.body.optJSONArray("items")?.length() ?: 0} · เครื่อง: ${names.size}\n" +
                            names.take(20).joinToString("\n")
                    }
                }
            }
        }
        button("เปลี่ยนรหัสผ่าน") { changePassword() }
        button("ยืนยันออกจากระบบที่ค้างด้วยรหัสผ่านบัญชีเดิม") { recoverLogout() }
        button("ออกจากระบบ (ไม่หยุดเสียงปลุกที่กำลังเล่น)") {
            if (ClientAccount.session(this) == null) {
                ClientAccount.cancelLogin(this)
                accountMessage.text = "ยกเลิกการเข้าสู่ระบบที่ยังไม่เสร็จ"
                return@button
            }
            if (ClientAccount.markLogout(this)) ClientRegistration.pendingLogout(this)
            accountStatus.text = ClientRegistration.status(this)
        }
        text("เครื่องอื่นที่ใช้บัญชีเดียวกันลงทะเบียนแยกกัน การออกจากระบบมีผลกับ push ครั้งถัดไป ไม่ลบรายการรับทราบและไม่หยุดเสียงที่กำลังเล่น")
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
        try {
            ClientRegistration.periodic(this)
            if (ClientAccount.session(this) != null || ClientAccount.pendingLogout(this)) {
                if (!ClientAccount.pendingLogout(this)) requestFirebaseRegistration()
                ClientRegistration.enqueue(this)
            }
        } catch (_: Exception) { }
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
        accountStatus.text = ClientRegistration.status(this)
    }

    private fun requestFirebaseRegistration() {
        if (FirebaseApp.getApps(this).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (!ClientPolicy.token(token)) return@addOnSuccessListener
            val changed = synchronized(ClientAccount.lock) {
                val prefs = getSharedPreferences(dev.notifyalarm.core.AlertMessagingService.PUSH_PREFERENCES, MODE_PRIVATE)
                val changed = prefs.getString(dev.notifyalarm.core.AlertMessagingService.TOKEN_KEY, null) != token
                prefs
                    .edit().putString(dev.notifyalarm.core.AlertMessagingService.TOKEN_KEY, token)
                    .putBoolean("needs_registration", changed || prefs.getBoolean("needs_registration", true)).commit()
                changed
            }
            ClientRegistration.enqueue(this, tokenChanged = changed)
        }
    }

    private fun login() {
        val base = ClientPolicy.baseUrl(serverInput.text.toString())
        val username = userInput.text.toString().trim()
        val password = passwordInput.text.toString()
        val name = deviceInput.text.toString().trim()
        passwordInput.text.clear()
        if (base == null || username.isBlank() || password.isBlank() || !ClientPolicy.deviceName(name)) {
            accountMessage.text = "กรุณากรอก HTTPS URL ชื่อผู้ใช้ รหัสผ่าน และชื่อเครื่อง (1–80 ตัวอักษร)"
            return
        }
        if (ClientAccount.pendingLogout(this)) {
            accountMessage.text = "รอ server ยืนยันออกจากระบบก่อนเข้าสู่ระบบใหม่"
            return
        }
        if (ClientAccount.session(this) != null) {
            accountMessage.text = "กรุณาออกจากระบบเดิมก่อนเข้าสู่ระบบใหม่"
            return
        }
        val ticket = ClientAccount.loginTicket(this) ?: run {
            accountMessage.text = "สถานะบัญชีเปลี่ยนแล้ว กรุณาลองใหม่"; return
        }
        accountMessage.text = "กำลังเข้าสู่ระบบ…"
        Thread {
            val message = try {
                ClientRegistration.mutateIfCurrent({ ClientAccount.ticketCurrent(this, ticket) }) {
                    val response = ClientApi.login(base, username, password, ticket.installation)
                    val login = ClientApi.extractLogin(response, username)
                    if (login != null && ClientAccount.saveLogin(this, ticket, base, login.first, name,
                            username, login.third, login.second)) {
                        if (!login.third) { requestFirebaseRegistration(); ClientRegistration.enqueue(this) }
                        if (login.third) "เข้าสู่ระบบแล้ว ต้องเปลี่ยนรหัสผ่านก่อนลงทะเบียน" else
                            "เข้าสู่ระบบแล้ว กำลังลงทะเบียนเครื่อง"
                    } else if (response.status == 401) "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" else {
                        "เข้าสู่ระบบไม่สำเร็จ หรือสถานะบัญชีเปลี่ยนแล้ว"
                    }
                } ?: "สถานะบัญชีเปลี่ยนแล้ว ไม่ส่งคำขอเข้าสู่ระบบซ้ำ"
            } catch (_: Exception) { "เชื่อมต่อไม่ได้ / เก็บเซสชันอย่างปลอดภัยไม่ได้" }
            runOnUiThread { if (!isDestroyed) accountMessage.text = message }
        }.start()
    }

    private fun changePassword() {
        val session = ClientAccount.session(this) ?: run {
            accountMessage.text = "กรุณาเข้าสู่ระบบก่อน"; return
        }
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun field(hint: String) = EditText(this).apply {
            this.hint = hint
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            container.addView(this)
        }
        val current = field("รหัสผ่านเดิม")
        val replacement = field("รหัสผ่านใหม่ (อย่างน้อย 15 ตัวอักษร)")
        val confirm = field("ยืนยันรหัสผ่านใหม่")
        AlertDialog.Builder(this).setTitle("เปลี่ยนรหัสผ่าน").setView(container)
            .setNegativeButton("ยกเลิก", null).setPositiveButton("เปลี่ยน") { _, _ ->
                val old = current.text.toString()
                val fresh = replacement.text.toString()
                if (!ClientPolicy.password(fresh) || fresh != confirm.text.toString()) {
                    accountMessage.text = "รหัสผ่านใหม่ต้องยาวอย่างน้อย 15 ตัวอักษร ไม่เกิน 128 ไบต์ และตรงกัน"
                } else Thread {
                    val result = try {
                        ClientRegistration.mutateIfCurrent({ ClientAccount.isCurrent(this, session) }) {
                            val response = ClientApi.changePassword(session, old, fresh)
                            val rotated = ClientApi.extractLogin(response, session.username)
                            if (rotated != null && ClientAccount.rotate(this, session, rotated.first,
                                    rotated.third, rotated.second)) {
                                ClientRegistration.enqueue(this)
                                "เปลี่ยนรหัสผ่านแล้ว กำลังลงทะเบียนเครื่อง"
                            } else "เปลี่ยนรหัสผ่านไม่สำเร็จ หรือเซสชันเปลี่ยนแล้ว"
                        } ?: "เซสชันเปลี่ยนแล้ว ไม่ส่งคำขอเปลี่ยนรหัสผ่านซ้ำ"
                    } catch (_: Exception) { "เชื่อมต่อไม่ได้ กรุณาลองใหม่" }
                    runOnUiThread { if (!isDestroyed) accountMessage.text = result }
                }.start()
            }.show()
    }

    private fun recoverLogout() {
        val old = ClientAccount.session(this)
        if (old == null || !ClientAccount.pendingLogout(this) ||
            !ClientAccount.logoutAuthenticationRequired(this)) {
            accountMessage.text = "ไม่มีรายการออกจากระบบที่ต้องยืนยันรหัสผ่าน"; return
        }
        val password = passwordInput.text.toString()
        passwordInput.text.clear()
        if (password.isBlank()) { accountMessage.text = "ใส่รหัสผ่านบัญชีเดิมก่อน"; return }
        accountMessage.text = "กำลังยืนยันเพื่อออกจากระบบ…"
        Thread {
            val message = try {
                ClientRegistration.mutateIfCurrent({
                    ClientAccount.pendingLogout(this) && ClientAccount.logoutAuthenticationRequired(this) &&
                        ClientAccount.session(this)?.let { current ->
                            current.generation == old.generation && current.bearer == old.bearer &&
                                current.base == old.base && current.installation == old.installation &&
                                current.username == old.username
                        } == true
                }) {
                    val reply = ClientApi.login(old.base, old.username, password, old.installation)
                    val rotated = ClientApi.extractLogin(reply, old.username)
                    if (rotated != null && ClientAccount.replacePendingBearer(this, old, rotated.first,
                            rotated.second)) {
                        ClientRegistration.pendingLogout(this)
                        "กำลังส่งคำขอออกจากระบบอีกครั้ง เครื่องยังอาจได้รับแจ้งเตือน"
                    } else "ยืนยันไม่ได้ กรุณาตรวจรหัสผ่านบัญชีเดิม หรือเพิกถอนเครื่องจาก Dashboard"
                } ?: "รายการออกจากระบบเปลี่ยนแล้ว ไม่ส่งคำขอยืนยันซ้ำ"
            } catch (_: Exception) { "เชื่อมต่อไม่ได้ รายการออกจากระบบยังค้างอยู่" }
            runOnUiThread { if (!isDestroyed) accountMessage.text = message }
        }.start()
    }

    private fun accountTask(action: (ClientAccount.Session) -> String) {
        val session = ClientAccount.session(this) ?: run { accountMessage.text = "กรุณาเข้าสู่ระบบก่อน"; return }
        Thread {
            val result = try { action(session) } catch (_: Exception) { "เชื่อมต่อไม่ได้ กรุณาลองใหม่" }
            runOnUiThread { if (!isDestroyed) accountMessage.text = result }
        }.start()
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
