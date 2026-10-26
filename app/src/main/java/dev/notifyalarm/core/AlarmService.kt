package dev.notifyalarm.core

import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.File
import java.io.FileInputStream

/**
 * One looping player covers all active incidents. No timer silently stops it, no boot receiver and
 * no sticky restart circumvent a user's stop/force-stop. OS/process/audio interruptions remain
 * possible and must be demonstrated on the actual Pixel rather than described as guaranteed.
 */
class AlarmService : Service(), SharedPreferences.OnSharedPreferenceChangeListener {
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var prepared = false
    private var destroyed = false
    private var foreground = false
    private var focusGranted = false
    private var failure = false
    private var focusRetryDelayMs = INITIAL_FOCUS_RETRY_MS
    private lateinit var audioManager: AudioManager
    private lateinit var focusRequest: AudioFocusRequest

    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private val retryFocus = object : Runnable {
        override fun run() {
            if (destroyed || failure || !foreground || !prepared || !AlarmStore.hasCritical(this@AlarmService)) return
            try {
                focusGranted = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                if (focusGranted) startPreparedPlayer() else scheduleFocusRetry()
            } catch (_: Exception) {
                AlarmStore.setStatus(this@AlarmService, "ยังขอ audio focus ไม่ได้ กรุณาเปิดแอปเพื่อตรวจสอบ")
                scheduleFocusRetry()
            }
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        main.post { onAudioFocusChanged(change) }
    }

    /** Retry only while this already-running foreground service owns an unacknowledged alarm. */
    private fun scheduleFocusRetry() {
        if (destroyed || failure || !foreground || !prepared || !AlarmStore.hasCritical(this)) return
        main.removeCallbacks(retryFocus)
        main.postDelayed(retryFocus, focusRetryDelayMs)
        focusRetryDelayMs = (focusRetryDelayMs * 2).coerceAtMost(MAX_FOCUS_RETRY_MS)
    }

    internal fun onAudioFocusChanged(change: Int) {
        if (destroyed) return
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                focusGranted = true
                main.removeCallbacks(retryFocus)
                if (prepared && !AlarmRuntime.isPlaying && AlarmStore.hasCritical(this)) startPreparedPlayer()
            }
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (!AlarmStore.hasCritical(this)) return
                focusGranted = false
                try { if (player?.isPlaying == true) player?.pause() } catch (_: Exception) { }
                AlarmRuntime.isPlaying = false
                AlarmStore.setStatus(this, "เสียงถูกระบบหรือแอปอื่นขัดจังหวะ กำลังรอให้เริ่มใหม่")
                refreshNotification()
                if (AlarmStore.hasCritical(this)) {
                    AlarmNotifications.showFailure(this)
                    scheduleFocusRetry()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(AudioManager::class.java)
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(focusListener, main)
            .build()
        AlarmStore.preferences(this).registerOnSharedPreferenceChangeListener(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            AlarmStore.discardExpiredBeforeStart(this)
        } catch (_: Exception) {
            fail("ตรวจข้อมูลเหตุการณ์ไม่ได้ กรุณาตรวจพื้นที่จัดเก็บ")
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_SYNC || !AlarmStore.hasCritical(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            if (!foreground) {
                val notification = AlarmNotifications.build(this, playing = false)
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(AlarmNotifications.FOREGROUND_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
                } else {
                    startForeground(AlarmNotifications.FOREGROUND_ID, notification)
                }
                foreground = true
            }
            refreshNotification()
            if (player == null) preparePlayer()
            else if (prepared && !AlarmRuntime.isPlaying) {
                focusGranted = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                if (focusGranted) startPreparedPlayer()
                else {
                    AlarmStore.setStatus(this, "ยังขอ audio focus ไม่ได้ กำลังรอให้เริ่มใหม่")
                    AlarmNotifications.showFailure(this)
                    scheduleFocusRetry()
                }
            } else if (AlarmRuntime.isPlaying) {
                AlarmStore.markPlaybackStarted(this)
            }
        } catch (_: Exception) {
            fail("เริ่มบริการเสียงปลุกไม่ได้ กรุณาตรวจสิทธิ์และข้อจำกัด Android")
        }
        return START_NOT_STICKY
    }

    private fun preparePlayer(forceFallback: Boolean = false) {
        val alarmUri = AlarmSoundSettings.resolve(this)
        val media = MediaPlayer()
        player = media
        prepared = false
        var usingFallback = forceFallback
        try {
            fun configure() {
                media.setAudioAttributes(attributes)
                // Acquired only during playback, released on pause/release.
                media.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                media.isLooping = true
            }
            fun fallback() {
                usingFallback = true
                val file = File(cacheDir, "alarm-fallback-v1.wav")
                if (!file.exists() || file.length() != (44L + AlarmTone.SAMPLE_COUNT * 2)) {
                    file.writeBytes(AlarmTone.wave())
                }
                FileInputStream(file).use { media.setDataSource(it.fd) }
            }
            configure()
            if (forceFallback || alarmUri == null) fallback()
            else {
                try { media.setDataSource(this, alarmUri) }
                catch (_: Exception) {
                    // A default URI can exist while its backing sound file has disappeared.
                    media.reset()
                    configure()
                    fallback()
                }
            }
            media.setOnPreparedListener {
                if (destroyed || player !== it) return@setOnPreparedListener
                prepared = true
                try {
                    AlarmStore.discardExpiredBeforeStart(this)
                    if (!AlarmStore.hasCritical(this)) { stopSelf(); return@setOnPreparedListener }
                    focusGranted = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                    if (focusGranted) startPreparedPlayer()
                    else {
                        AlarmStore.setStatus(this, "ยังขอ audio focus ไม่ได้ กำลังรอให้เริ่มใหม่")
                        AlarmNotifications.showFailure(this)
                        scheduleFocusRetry()
                    }
                } catch (_: Exception) {
                    AlarmStore.setStatus(this, "ขอ audio focus ไม่สำเร็จ กำลังรอให้เริ่มใหม่")
                    AlarmNotifications.showFailure(this)
                    scheduleFocusRetry()
                }
            }
            media.setOnErrorListener { failedPlayer, _, _ ->
                if (!destroyed && player === failedPlayer && !AlarmStore.hasCritical(this)) {
                    stopSelf()
                } else if (!destroyed && player === failedPlayer && !usingFallback) {
                    releasePlayer()
                    preparePlayer(forceFallback = true)
                } else if (!destroyed && player === failedPlayer) {
                    fail("เล่นเสียงปลุกและเสียงสำรองไม่ได้ กรุณาเปิดแอปเพื่อตรวจสอบ")
                }
                true
            }
            media.prepareAsync()
            AlarmStore.setStatus(this, "กำลังเตรียมเสียงปลุก ยังไม่ได้ยืนยันว่าเสียงเริ่มแล้ว")
        } catch (_: Exception) {
            fail("เปิดไฟล์เสียงปลุกไม่ได้ กรุณาตั้งค่าเสียงปลุกของ Android")
        }
    }

    private fun startPreparedPlayer() {
        if (destroyed || !prepared || !focusGranted || !AlarmStore.hasCritical(this)) return
        try {
            AlarmStore.discardExpiredBeforeStart(this)
            if (!AlarmStore.hasCritical(this)) { stopSelf(); return }
            player?.start()
            AlarmRuntime.isPlaying = player?.isPlaying == true
            if (!AlarmRuntime.isPlaying) { fail("เสียงปลุกยังไม่เริ่มทำงาน"); return }
            main.removeCallbacks(retryFocus)
            focusRetryDelayMs = INITIAL_FOCUS_RETRY_MS
            AlarmNotifications.clearFailure(this)
            AlarmStore.markPlaybackStarted(this)
            AlarmStore.setStatus(this, "กำลังส่งเสียงปลุก — กดรับทราบเพื่อหยุด")
            refreshNotification()
        } catch (_: Exception) {
            fail("เริ่มเล่นเสียงปลุกไม่ได้ กรุณาเปิดแอปแล้วลองใหม่")
        }
    }

    private fun refreshNotification() {
        if (!foreground || destroyed) return
        getSystemService(android.app.NotificationManager::class.java)
            .notify(AlarmNotifications.FOREGROUND_ID,
                AlarmNotifications.build(this, playing = AlarmRuntime.isPlaying))
    }

    private fun fail(message: String) {
        if (destroyed || failure) return
        failure = true
        AlarmRuntime.isPlaying = false
        AlarmStore.setStatus(this, message)
        releasePlayer()
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            foreground = false
        }
        AlarmNotifications.showFailure(this)
        stopSelf()
    }

    override fun onSharedPreferenceChanged(sharedPreferences: SharedPreferences?, key: String?) {
        if (key != AlarmStore.STATE_KEY) return
        main.post {
            if (destroyed) return@post
            if (!AlarmStore.hasCritical(this)) {
                releasePlayer()
                stopSelf()
            } else {
                try {
                    AlarmStore.discardExpiredBeforeStart(this)
                    if (!AlarmStore.hasCritical(this)) { releasePlayer(); stopSelf(); return@post }
                    if (AlarmRuntime.isPlaying) AlarmStore.markPlaybackStarted(this)
                    refreshNotification()
                } catch (_: Exception) {
                    fail("บันทึกสถานะเสียงปลุกไม่ได้ กรุณาตรวจพื้นที่จัดเก็บ")
                }
            }
        }
    }

    private fun releasePlayer() {
        main.removeCallbacks(retryFocus)
        AlarmRuntime.isPlaying = false
        prepared = false
        try { player?.release() } catch (_: Exception) { }
        player = null
        try { audioManager.abandonAudioFocusRequest(focusRequest) } catch (_: Exception) { }
        focusGranted = false
    }

    override fun onDestroy() {
        destroyed = true
        main.removeCallbacksAndMessages(null)
        AlarmStore.preferences(this).unregisterOnSharedPreferenceChangeListener(this)
        releasePlayer()
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        if (!failure && AlarmStore.hasCritical(this)) {
            AlarmStore.setStatus(this, "service หยุดแล้ว แต่ยังมีเหตุการณ์ค้าง เปิดแอปเพื่อตรวจสอบ")
            AlarmNotifications.showFailure(this)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_SYNC = "dev.notifyalarm.SYNC_ALARMS"
        private const val INITIAL_FOCUS_RETRY_MS = 5_000L
        private const val MAX_FOCUS_RETRY_MS = 30_000L
    }
}
