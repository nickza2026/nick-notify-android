package dev.notifyalarm

import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import dev.notifyalarm.core.AlarmEngine
import dev.notifyalarm.core.AlarmStore
import dev.notifyalarm.core.AlarmSoundSettings
import dev.notifyalarm.sync.AckSync
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Test-only instrumentation. Not exported or included in the main APK. */
class AlarmInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        var activity: Activity? = null
        var resultCode = Activity.RESULT_CANCELED
        var originalAlarmUri: String? = null
        try {
            check(Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish")) {
                "Automatic alarm smoke test is restricted to an Android emulator"
            }
            val context = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            activity = context
            runOnMainSync { AlarmEngine.acknowledgeAll(context) }
            AlarmSoundSettings.useSystem(context, Uri.parse("content://media/internal/audio/media/999999999"), "เสียงทดสอบ")
            check(AlarmSoundSettings.label(context.applicationContext) == "เสียงทดสอบ") { "Selected sound label did not persist" }
            check(AlarmSoundSettings.resolve(context).toString().endsWith("999999999")) { "Selected sound URI did not persist" }
            AlarmSoundSettings.useBuiltin(context)
            check(AlarmSoundSettings.resolve(context) == null) { "Builtin sound choice was not applied" }
            AlarmSoundSettings.useDefault(context)
            // Owned emulator only: prove that an unavailable system ringtone cannot silence us.
            originalAlarmUri = shell("settings get system alarm_alert").trim()
            shell("settings put system alarm_alert content://media/internal/audio/media/999999999")
            val prefix = "instrumentation-${System.currentTimeMillis()}"
            // Synthetic route only: loopback port 1 is intentionally unreachable, never a real server.
            val ackUrl = "https://127.0.0.1:1/v1/alerts/$prefix-a/ack"
            val syntheticCapability = "A".repeat(43)
            check(AckSync.registerRoute(context, "$prefix-a", ackUrl, syntheticCapability)) { "Ack route not persisted" }
            check(WorkManager.getInstance(context).getWorkInfosForUniqueWork("ack_sync_reconcile_v1")
                .get(5, TimeUnit.SECONDS).any { !it.state.isFinished }) {
                "Independent durable Ack recovery was not installed before accepting a route"
            }
            check(!AckSync.registerRoute(context, "$prefix-a", ackUrl, "B".repeat(42) + "A")) {
                "An existing capability must not rotate on replay"
            }
            val latestStart = System.currentTimeMillis() + 12000
            var started = false
            runOnMainSync {
                val expired = AlarmEngine.trigger(context, "$prefix-expired", "expired", "must not ring", System.currentTimeMillis() - 5000)
                check(!expired) { "Expired alert must not be accepted" }
                started = AlarmEngine.trigger(context, "$prefix-a", "ทดสอบ A", "instrumentation only", latestStart)
            }
            check(started) { "Foreground test alarm could not start" }
            val playbackDeadline = System.currentTimeMillis() + 8000
            while (!AlarmStore.status(context).startsWith("กำลังส่งเสียงปลุก") && System.currentTimeMillis() < playbackDeadline) Thread.sleep(100)
            check(AlarmStore.active(context).any { it.id == "$prefix-a" }) { "Active alert missing" }
            check(AlarmStore.status(context).startsWith("กำลังส่งเสียงปลุก")) { "MediaPlayer did not confirm actual playback: ${AlarmStore.status(context)}" }
            shell("input keyevent 223")
            val power = context.getSystemService(PowerManager::class.java)
            val screenDeadline = System.currentTimeMillis() + 4000
            while (power.isInteractive && System.currentTimeMillis() < screenDeadline) Thread.sleep(100)
            check(!power.isInteractive) { "Screen did not actually sleep" }
            while (System.currentTimeMillis() <= latestStart + 500) Thread.sleep(100)
            check(AlarmStore.status(context).startsWith("กำลังส่งเสียงปลุก")) { "Playback stopped when screen slept" }
            check(AlarmStore.active(context).any { it.id == "$prefix-a" }) { "Delivery expiry incorrectly stopped an already-started alarm" }
            shell("input keyevent 224")
            shell("wm dismiss-keyguard")
            runOnMainSync {
                AlarmEngine.trigger(context, "$prefix-a", "duplicate", "must not duplicate")
                AlarmEngine.trigger(context, "$prefix-b", "ทดสอบ B", "second incident")
            }
            Thread.sleep(750)
            check(AlarmStore.active(context).count { it.id == "$prefix-a" } == 1) { "Duplicate alert created" }
            check(AlarmStore.active(context).any { it.id == "$prefix-b" }) { "Second incident lost" }
            val alarmNotification = context.getSystemService(NotificationManager::class.java)
                .activeNotifications.firstOrNull { it.id == 4101 }?.notification
                ?: error("Foreground alarm notification missing")
            check(!alarmNotification.actions.isNullOrEmpty()) { "Notification Ack action missing" }
            alarmNotification.actions[0].actionIntent.send()
            Thread.sleep(750)
            check(AlarmStore.active(context).isEmpty()) { "Ack did not clear active records" }
            check(!AlarmStore.status(context).startsWith("กำลังส่งเสียงปลุก")) { "Playback state remained active after Ack" }
            check(AlarmStore.isAcknowledged(context, "$prefix-a")) { "Ack tombstone missing" }
            check(AlarmStore.pendingAcknowledgements(context).contains("$prefix-a")) { "Offline ack not queued" }
            check(AlarmStore.acknowledgedAt(context, "$prefix-a") != null) { "Local Ack timestamp missing" }
            val actionId = AlarmStore.acknowledgementActionId(context, "$prefix-a")
            check(actionId != null && actionId == AlarmStore.acknowledgementActionId(context, "$prefix-b")) {
                "A single Ack-all tap did not share a stable action ID across both alerts"
            }
            check(AckSync.pendingCount(context) >= 1) { "Unreachable endpoint incorrectly confirmed/removed Ack" }
            runOnMainSync { AlarmEngine.trigger(context, "$prefix-a", "replay", "must not reopen") }
            Thread.sleep(500)
            check(AlarmStore.active(context).isEmpty()) { "Acknowledged replay reopened alarm" }
            result.putString("stream", "PASS: sound selection persistence/default/builtin, expired rejection, fallback tone, actual MediaPlayer start, confirmed screen-off playback beyond expiry, dedupe, multiple incidents, notification Ack stops locally, durable remote Ack queue on unreachable endpoint, replay suppression\n")
            resultCode = Activity.RESULT_OK
        } catch (e: Throwable) {
            result.putString("stream", "FAIL: ${e.javaClass.simpleName}: ${e.message}\n")
        } finally {
            originalAlarmUri?.let {
                if (it == "null" || it.isBlank()) shell("settings delete system alarm_alert")
                else shell("settings put system alarm_alert '${it.replace("'", "'\\''")}'")
            }
            activity?.let { testActivity ->
                runOnMainSync {
                    AlarmEngine.acknowledgeAll(testActivity)
                    testActivity.finish()
                }
            }
        }
        finish(resultCode, result)
    }

    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(uiAutomation.executeShellCommand(command)).use {
            it.bufferedReader().readText()
        }
}
