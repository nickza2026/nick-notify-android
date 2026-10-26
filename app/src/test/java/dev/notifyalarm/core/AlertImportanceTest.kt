package dev.notifyalarm.core

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.RuntimeEnvironment
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class AlertImportanceTest {
    private lateinit var context: Context

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        AlarmStore.preferences(context).edit().clear().commit()
        AlarmRuntime.isPlaying = false
    }

    @Test fun wireImportanceIsFailClosedButLegacyRemainsCritical() {
        assertEquals(AlertImportance.CRITICAL, AlertImportance.fromWire(null))
        assertEquals(AlertImportance.CRITICAL, AlertImportance.fromWire("critical"))
        assertEquals(AlertImportance.NORMAL, AlertImportance.fromWire("normal"))
        assertNull(AlertImportance.fromWire("unexpected"))
        assertNull(AlertImportance.fromWire(""))
        assertEquals(AlertImportance.CRITICAL, AlertMessagingService.wireImportance("alert", null))
        assertEquals(AlertImportance.NORMAL, AlertMessagingService.wireImportance("alert", "normal"))
        assertEquals(AlertImportance.NORMAL, AlertMessagingService.wireImportance("notice", "normal"))
        assertNull(AlertMessagingService.wireImportance("notice", null))
        assertNull(AlertMessagingService.wireImportance("notice", "critical"))
        assertNull(AlertMessagingService.wireImportance("notice", "unknown"))
        assertNull(AlertMessagingService.wireImportance("unknown", "normal"))
    }

    @Test fun normalArrivalNeverStartsServiceAndOpeningDoesNotAcknowledge() {
        assertTrue(AlarmEngine.trigger(context, "normal-one", "Normal", "quiet", importance = AlertImportance.NORMAL))
        assertFalse(AlarmStore.hasCritical(context))
        assertFalse(AlarmRuntime.isPlaying)
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = manager.getNotificationChannel(AlarmNotifications.NORMAL_CHANNEL_ID)
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
        assertFalse(channel.shouldVibrate())
        assertNull(channel.sound)
        val posted = shadowOf(manager).allNotifications.single()
        assertNull(posted.fullScreenIntent)
        assertNull(posted.sound)
        assertNotNull(posted.contentIntent)
        posted.contentIntent.send()
        assertEquals(1, AlarmStore.active(context).size)
        assertTrue(AlarmStore.pendingAcknowledgements(context).isEmpty())
        assertTrue(shadowOf(context as android.app.Application).nextStartedService == null)
    }

    @Test fun legacyRecordsRemainCriticalAndNormalCannotEscalateOrStopCritical() {
        val raw = """{"active":[{"id":"old","title":"Alarm","message":"legacy","created_at":1,"started":false,"expires_at":null}],"terminal":{},"pending_ack":[]}"""
        AlarmStore.preferences(context).edit().putString(AlarmStore.STATE_KEY, raw).commit()
        assertEquals(AlertImportance.CRITICAL, AlarmStore.criticalActive(context).single().importance)
        AlarmStore.add(context, AlertRecord("normal", "Quiet", "body", 2, AlertImportance.NORMAL))
        AlarmStore.markPlaybackStarted(context)
        val records = JSONObject(AlarmStore.preferences(context).getString(AlarmStore.STATE_KEY, "")!!)
            .getJSONArray("active")
        assertFalse(records.getJSONObject(1).getBoolean("started"))
        assertTrue(AlarmEngine.trigger(context, "normal", "replay", "body", importance = AlertImportance.CRITICAL))
        assertEquals(AlertImportance.NORMAL, AlarmStore.active(context).first { it.id == "normal" }.importance)
        AlarmEngine.remoteTerminal(context, "normal", "cancelled")
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmStore.isTerminal(context, "old"))
    }

    @Test fun remoteTerminalCannotStopActiveCriticalWithoutHumanAck() {
        AlarmStore.add(context, AlertRecord("critical-active", "Alarm", "body", 1))
        AlarmEngine.remoteTerminal(context, "critical-active", "cancelled")
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmStore.isTerminal(context, "critical-active"))
        AlarmEngine.remoteTerminal(context, "critical-active", "acknowledged")
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmStore.isTerminal(context, "critical-active"))
        assertTrue(AlarmStore.pendingAcknowledgements(context).isEmpty())
        AlarmEngine.acknowledgeAll(context)
        assertFalse(AlarmStore.hasCritical(context))
        assertTrue(AlarmStore.isAcknowledged(context, "critical-active"))
    }

    @Test fun remoteTerminalCannotPreemptCriticalThatArrivesOutOfOrder() {
        AlarmEngine.remoteTerminal(context, "critical-later", "cancelled")
        assertFalse(AlarmStore.isTerminal(context, "critical-later"))
        AlarmEngine.remoteTerminal(context, "critical-later", "acknowledged")
        assertFalse(AlarmStore.isTerminal(context, "critical-later"))
        assertTrue(AlarmStore.add(context, AlertRecord("critical-later", "Alarm", "body", 1)))
        assertTrue(AlarmStore.hasCritical(context))
    }

    @Test fun audioFocusLossPreservesCriticalAndReportsSilentPlayback() {
        AlarmStore.add(context, AlertRecord("interrupted", "Alarm", "body", 1))
        val service = Robolectric.buildService(AlarmService::class.java).create().get()
        service.onAudioFocusChanged(AudioManager.AUDIOFOCUS_LOSS)
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmRuntime.isPlaying)
        assertTrue(AlarmStore.status(context).contains("กำลังรอให้เริ่มใหม่"))
        val manager = context.getSystemService(NotificationManager::class.java)
        assertTrue(shadowOf(manager).allNotifications.any {
            it.extras.getCharSequence(Notification.EXTRA_TEXT)?.contains("เสียงยังไม่ทำงาน") == true
        })
        service.onDestroy()
    }

    @Test fun unexpectedServiceStopKeepsCriticalAndShowsFailureWithoutAck() {
        AlarmStore.add(context, AlertRecord("service-stopped", "Alarm", "body", 1))
        val service = Robolectric.buildService(AlarmService::class.java).create().get()
        service.onDestroy()
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmStore.isAcknowledged(context, "service-stopped"))
        val manager = context.getSystemService(NotificationManager::class.java)
        assertTrue(shadowOf(manager).allNotifications.any {
            it.extras.getCharSequence(Notification.EXTRA_TEXT)?.contains("เสียงยังไม่ทำงาน") == true
        })
    }

    @Test fun ackAllCoversBothModesWithOneDurableActionId() {
        AlarmStore.add(context, AlertRecord("critical", "A", "", 1))
        AlarmStore.add(context, AlertRecord("normal", "B", "", 2, AlertImportance.NORMAL))
        AlarmEngine.acknowledgeAll(context)
        assertTrue(AlarmStore.active(context).isEmpty())
        assertEquals(setOf("critical", "normal"), AlarmStore.pendingAcknowledgements(context).toSet())
        assertEquals(AlarmStore.acknowledgementActionId(context, "critical"),
            AlarmStore.acknowledgementActionId(context, "normal"))
    }

    @Test fun expiredUnpresentedNormalNeverDisplaysAfterPermissionRecoveryOrCriticalReplay() {
        val manager = context.getSystemService(NotificationManager::class.java)
        shadowOf(manager).setNotificationsEnabled(false)
        assertFalse(AlarmEngine.trigger(context, "blocked", "Normal", "body",
            System.currentTimeMillis() + 1000, AlertImportance.NORMAL))
        assertEquals(1, AlarmStore.active(context).size)
        val state = JSONObject(AlarmStore.preferences(context).getString(AlarmStore.STATE_KEY, "")!!)
        state.getJSONArray("active").getJSONObject(0).put("expires_at", System.currentTimeMillis() - 1)
        AlarmStore.preferences(context).edit().putString(AlarmStore.STATE_KEY, state.toString()).commit()
        shadowOf(manager).setNotificationsEnabled(true)
        assertFalse(AlarmEngine.trigger(context, "blocked", "Replay", "body", importance = AlertImportance.CRITICAL))
        assertFalse(AlarmNotifications.showNormal(context, "blocked"))
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
        assertTrue(AlarmStore.active(context).isEmpty())
        assertTrue(AlarmStore.isTerminal(context, "blocked"))
        assertTrue(AlarmStore.pendingAcknowledgements(context).isEmpty())
        assertNull(shadowOf(context as android.app.Application).nextStartedService)
    }

    @Test fun presentedNormalOutlivesExpiryAndNormalOnlyServiceCannotStartPlayback() {
        val manager = context.getSystemService(NotificationManager::class.java)
        assertTrue(AlarmEngine.trigger(context, "shown", "Normal", "body",
            System.currentTimeMillis() + 1000, AlertImportance.NORMAL))
        val state = JSONObject(AlarmStore.preferences(context).getString(AlarmStore.STATE_KEY, "")!!)
        val item = state.getJSONArray("active").getJSONObject(0)
        assertTrue(item.getBoolean("normal_presented"))
        assertFalse(item.getBoolean("started"))
        item.put("expires_at", System.currentTimeMillis() - 1)
        AlarmStore.preferences(context).edit().putString(AlarmStore.STATE_KEY, state.toString()).commit()
        AlarmStore.discardExpiredBeforeStart(context)
        assertEquals(1, AlarmStore.active(context).size)
        val service = Robolectric.buildService(AlarmService::class.java).create().get()
        service.onStartCommand(Intent(context, AlarmService::class.java).setAction(AlarmService.ACTION_SYNC), 0, 1)
        assertFalse(AlarmRuntime.isPlaying)
        assertEquals(1, shadowOf(manager).allNotifications.size)
        assertNull(shadowOf(context as android.app.Application).nextStartedService)
        service.onDestroy()
    }
}
