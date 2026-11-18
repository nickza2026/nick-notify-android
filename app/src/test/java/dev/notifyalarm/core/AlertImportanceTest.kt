package dev.notifyalarm.core

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import dev.notifyalarm.MainActivity
import dev.notifyalarm.sync.ClientApi
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.RuntimeEnvironment
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.json.JSONObject
import java.util.concurrent.Executor

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class AlertImportanceTest {
    private lateinit var context: Context
    private val defaultUrgentPlayer = AlarmNotifications.playUrgent
    private var urgentSounds = 0

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        AlarmStore.preferences(context).edit().clear().commit()
        AlarmRuntime.isPlaying = false
        urgentSounds = 0
        AlarmNotifications.playUrgent = { urgentSounds++ }
        MainActivity.authLookup = { ClientApi.AuthConfig("password", null) }
        MainActivity.authExecutor = Executor { it.run() }
    }

    @After fun cleanupAuthDiscovery() {
        AlarmNotifications.playUrgent = defaultUrgentPlayer
        MainActivity.resetAuthDiscovery()
    }

    @Test fun wireImportanceIsFailClosedButLegacyRemainsCritical() {
        assertEquals(AlertImportance.CRITICAL, AlertImportance.fromWire(null))
        assertEquals(AlertImportance.CRITICAL, AlertImportance.fromWire("critical"))
        assertEquals(AlertImportance.NORMAL, AlertImportance.fromWire("normal"))
        assertEquals(AlertImportance.URGENT, AlertImportance.fromWire("urgent"))
        assertNull(AlertImportance.fromWire("unexpected"))
        assertNull(AlertImportance.fromWire(""))
        assertEquals(AlertImportance.CRITICAL, AlertMessagingService.wireImportance("alert", null))
        assertEquals(AlertImportance.NORMAL, AlertMessagingService.wireImportance("alert", "normal"))
        assertEquals(AlertImportance.NORMAL, AlertMessagingService.wireImportance("notice", "normal"))
        assertEquals(AlertImportance.URGENT, AlertMessagingService.wireImportance("notice", "urgent"))
        assertEquals(AlertImportance.URGENT, AlertMessagingService.wireImportance("alert", "urgent"))
        assertNull(AlertMessagingService.wireImportance("notice", null))
        assertNull(AlertMessagingService.wireImportance("notice", "critical"))
        assertNull(AlertMessagingService.wireImportance("notice", "unknown"))
        assertNull(AlertMessagingService.wireImportance("unknown", "normal"))
    }

    @Test fun criticalChannelRequestsDndBypassAndDndAlarmBlockingIsReported() {
        AlarmNotifications.channel(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        assertTrue(manager.getNotificationChannel(AlarmNotifications.CHANNEL_ID).canBypassDnd())
        val alarms = NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS
        assertTrue(DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_NONE, null))
        assertTrue(DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_PRIORITY, 0))
        assertFalse(DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_PRIORITY, alarms))
        assertFalse("unknown policy is not reported as blocked", DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_PRIORITY, null))
        assertFalse(DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_ALARMS, 0))
        assertFalse(DndCheck.blocksAlarms(NotificationManager.INTERRUPTION_FILTER_ALL, 0))
    }

    @Test fun urgentPlaysOneAlarmStreamSoundThroughSilentNotificationAndNeverStartsForegroundService() {
        val manager = context.getSystemService(NotificationManager::class.java)
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = AudioManager.RINGER_MODE_VIBRATE
        assertTrue(AlarmEngine.trigger(context, "urgent", "Urgent", "one-shot", importance = AlertImportance.URGENT))
        assertEquals(1, urgentSounds)
        val channel = manager.getNotificationChannel(AlarmNotifications.URGENT_CHANNEL_ID)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        assertNull(channel.sound)
        assertFalse(channel.shouldVibrate())
        assertNull(manager.getNotificationChannel("urgent_notices_v1"))
        val posted = shadowOf(manager).allNotifications.single()
        assertNull(posted.sound)
        assertNull(posted.fullScreenIntent)
        assertNull(shadowOf(context as android.app.Application).nextStartedService)
        assertTrue(AlarmStore.noticePresented(context, "urgent"))
        manager.cancel("urgent", 4103)
        assertTrue(AlarmEngine.trigger(context, "urgent", "Changed", "again", importance = AlertImportance.CRITICAL))
        assertTrue(AlarmEngine.trigger(context, "urgent", "Replay", "again", importance = AlertImportance.URGENT))
        assertEquals("replay, reopen or critical-typed duplicate must not sound again", 1, urgentSounds)
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
        assertEquals(AlertImportance.URGENT, AlarmStore.active(context).single().importance)
        assertFalse(AlarmStore.hasCritical(context))
    }

    @Test fun failedUrgentNotifyRetriesSilentlyWithoutLosingPresentationOrReplayingAfterSuccess() {
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = AudioManager.RINGER_MODE_SILENT
        assertTrue(AlarmStore.add(context, AlertRecord("retry-urgent", "Urgent", "body", 1, AlertImportance.URGENT),
            System.currentTimeMillis() + 60_000))
        assertFalse(AlarmNotifications.showNotice(context, "retry-urgent") { _, _, _, _ ->
            throw IllegalStateException("simulated notification failure")
        })
        assertFalse(AlarmStore.noticePresented(context, "retry-urgent"))
        assertEquals("silent ringer does not suppress urgent's alarm-stream sound", 1, urgentSounds)
        audio.ringerMode = AudioManager.RINGER_MODE_NORMAL
        var retries = 0
        assertTrue(AlarmNotifications.showNotice(context, "retry-urgent") { manager, tag, number, notification ->
            retries++
            assertNull(notification.sound)
            assertEquals(0, notification.defaults)
            manager.notify(tag, number, notification)
        })
        assertEquals(1, retries)
        assertEquals(1, urgentSounds)
        assertTrue(AlarmStore.noticePresented(context, "retry-urgent"))
        assertTrue(AlarmNotifications.showNotice(context, "retry-urgent") { _, _, _, _ ->
            fail("duplicate cannot repost")
        })
    }

    @Test fun urgentSilentRingerAndExpiryDoNotReplayOrStopOtherCritical() {
        val manager = context.getSystemService(NotificationManager::class.java)
        val audio = context.getSystemService(AudioManager::class.java)
        audio.ringerMode = AudioManager.RINGER_MODE_SILENT
        AlarmStore.add(context, AlertRecord("critical", "Alarm", "keep", 1))
        AlarmRuntime.isPlaying = true
        assertTrue(AlarmEngine.trigger(context, "silent", "Urgent", "body", importance = AlertImportance.URGENT))
        assertNull(shadowOf(manager).allNotifications.single().sound)
        assertEquals(1, urgentSounds)
        assertTrue(AlarmRuntime.isPlaying)
        AlarmEngine.remoteTerminal(context, "silent", "cancelled")
        assertTrue(AlarmStore.hasCritical(context))
        assertTrue(AlarmRuntime.isPlaying)
        assertTrue(AlarmStore.isTerminal(context, "silent"))
        assertFalse(AlarmEngine.trigger(context, "expired", "Urgent", "body",
            System.currentTimeMillis() - 1, AlertImportance.URGENT))
        assertTrue(AlarmStore.active(context).none { it.id == "expired" })
    }

    @Test fun unpresentedUrgentExpiresWithoutReplayOrAffectingCritical() {
        val manager = context.getSystemService(NotificationManager::class.java)
        shadowOf(manager).setNotificationsEnabled(false)
        assertFalse(AlarmEngine.trigger(context, "blocked-urgent", "Urgent", "body",
            System.currentTimeMillis() + 1000, AlertImportance.URGENT))
        AlarmStore.add(context, AlertRecord("critical", "Alarm", "keep", 1))
        val state = JSONObject(AlarmStore.preferences(context).getString(AlarmStore.STATE_KEY, "")!!)
        state.getJSONArray("active").getJSONObject(0).put("expires_at", System.currentTimeMillis() - 1)
        AlarmStore.preferences(context).edit().putString(AlarmStore.STATE_KEY, state.toString()).commit()
        shadowOf(manager).setNotificationsEnabled(true)
        AlarmStore.discardExpiredBeforeStart(context)
        assertTrue(AlarmStore.isTerminal(context, "blocked-urgent"))
        assertTrue(AlarmStore.hasCritical(context))
        assertFalse(AlarmNotifications.showNotice(context, "blocked-urgent"))
    }

    @Test fun returningFromSettingsDoesNotAutostartPendingCriticalOrUrgent() {
        AlarmStore.add(context, AlertRecord("pending-critical", "Alarm", "body", 1))
        AlarmStore.add(context, AlertRecord("pending-urgent", "Urgent", "body", 2, AlertImportance.URGENT))
        val activity = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        activity.pause().resume() // Settings round trip
        assertFalse(AlarmRuntime.isPlaying)
        assertFalse(AlarmStore.noticePresented(context, "pending-urgent"))
        assertNull(shadowOf(context as android.app.Application).nextStartedService)
        activity.pause().stop().destroy()
    }

    @Test fun systemDndInstructionsAndVolumeButtonReflectRealSettingsOnReturn() {
        MainActivity.authLookup = { ClientApi.AuthConfig("password", null) }
        MainActivity.authExecutor = Executor { it.run() }
        try {
            AlarmVolume.configure(context, true, 65)
            val activity = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
            fun findButtons(root: View): List<Button> = when (root) {
                is Button -> listOf(root)
                is ViewGroup -> (0 until root.childCount).flatMap { findButtons(root.getChildAt(it)) }
                else -> emptyList()
            }
            var buttons = findButtons(activity.get().window.decorView)
            assertTrue(buttons.any { it.text.toString().contains("เปิด 65%") })
            buttons.single { it.text.toString().contains("ระดับเสียงขั้นต่ำ") }.performClick()
            val consent = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()
            assertTrue(consent.findViewById<android.widget.TextView>(android.R.id.message).text.toString().contains("ทั้งเครื่อง"))
            consent.dismiss()
            val dnd = buttons.single { it.text.toString().contains("ค้นหา Do Not Disturb") }
            dnd.performClick()
            assertEquals(Settings.ACTION_SETTINGS, shadowOf(activity.get()).nextStartedActivity.action)
            buttons.single { it.text.toString().contains("อนุญาตสิทธิ์ Do Not Disturb") }.performClick()
            assertEquals(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS, shadowOf(activity.get()).nextStartedActivity.action)
            AlarmVolume.configure(context, false, 65)
            activity.pause().resume()
            buttons = findButtons(activity.get().window.decorView)
            assertTrue(buttons.any { it.text.toString().contains("ระดับเสียงขั้นต่ำ") && it.text.toString().contains("ปิด") })
            assertFalse(AlarmRuntime.isPlaying)
            assertNull(shadowOf(context as android.app.Application).nextStartedService)
            activity.pause().stop().destroy()
        } finally {
            MainActivity.resetAuthDiscovery()
        }
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
        assertFalse(AlarmNotifications.showNotice(context, "blocked"))
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
