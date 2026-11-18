package dev.notifyalarm.core

import android.content.Context
import android.media.AudioManager
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Robolectric

@RunWith(RobolectricTestRunner::class)
class AlarmVolumeTest {
    private lateinit var context: Context
    private class FakeStream(var level: Int = 2, override val maximum: Int = 10,
                             override val fixed: Boolean = false) : AlarmVolume.Stream {
        var writes = 0
        var denied = false
        override val current get() = level
        override fun set(level: Int) {
            writes++
            if (denied) throw SecurityException("denied")
            this.level = level
        }
    }

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("critical_volume_v1", Context.MODE_PRIVATE).edit().clear().commit()
        AlarmRuntime.serviceAlive = false
    }

    @Test fun defaultOnRaisesToEightyPercentAndUserCanTurnItOff() {
        assertTrue(AlarmVolume.enabled(context))
        assertEquals(80, AlarmVolume.minimum(context))
        val stream = FakeStream()
        AlarmVolume.beginWith(context, stream)
        assertEquals(8, stream.level)
        AlarmVolume.restoreWith(context, stream)
        assertEquals(2, stream.level)

        AlarmVolume.configure(context, false, 80)
        val off = FakeStream()
        AlarmVolume.beginWith(context, off)
        AlarmVolume.restoreWith(context, off)
        assertEquals(0, off.writes)
        try { AlarmVolume.configure(context, true, 0); fail("invalid") } catch (_: IllegalArgumentException) { }
        try { AlarmVolume.configure(context, true, 101); fail("invalid") } catch (_: IllegalArgumentException) { }
    }

    @Test fun raisesOnceForOverlappingCriticalAndFocusRetryThenRestoresOnce() {
        val stream = FakeStream()
        AlarmVolume.configure(context, true, 60)
        AlarmVolume.beginWith(context, stream)
        assertEquals(6, stream.level)
        AlarmVolume.beginWith(context, stream) // additional incident and focus retry
        assertEquals(1, stream.writes)
        AlarmVolume.observeWith(context, stream)
        AlarmVolume.restoreWith(context, stream) // last Ack/service teardown
        assertEquals(2, stream.level)
        assertEquals(2, stream.writes)
        AlarmVolume.restoreWith(context, stream)
        assertEquals(2, stream.writes)
    }

    @Test fun skipsFixedVolumeAndAlreadySufficientVolume() {
        AlarmVolume.configure(context, true, 60)
        val fixed = FakeStream(fixed = true)
        AlarmVolume.beginWith(context, fixed)
        assertEquals(0, fixed.writes)
        val loud = FakeStream(level = 8)
        AlarmVolume.beginWith(context, loud)
        assertEquals(0, loud.writes)
    }

    @Test fun manualChangeOrDeniedRestoreNeverOverridesUserLevel() {
        AlarmVolume.configure(context, true, 60)
        val stream = FakeStream()
        AlarmVolume.beginWith(context, stream)
        stream.level = 7 // user changed it while the service was watching
        AlarmVolume.observeWith(context, stream)
        stream.level = 6
        AlarmVolume.restoreWith(context, stream)
        assertEquals(6, stream.level) // even if it returns to the app-applied value
        assertEquals(1, stream.writes)
        AlarmVolume.beginWith(context, stream)
        assertEquals(1, stream.writes)
        stream.level = 1
        stream.denied = true
        try { AlarmVolume.beginWith(context, stream); fail("denied") } catch (_: SecurityException) { }
        assertEquals(1, stream.level)
        stream.denied = false
        AlarmVolume.restoreWith(context, stream)
        assertEquals(1, stream.level)
    }

    @Test fun staleSnapshotRecoveryOnlyWhenServiceAbsentAndValueStillOwned() {
        AlarmVolume.configure(context, true, 60)
        val stream = FakeStream()
        AlarmVolume.beginWith(context, stream)
        assertEquals(6, stream.level)
        // Simulates process death: new instance reads durable ownership.
        AlarmVolume.restoreWith(context, stream)
        assertEquals(2, stream.level)
        AlarmVolume.beginWith(context, stream)
        stream.level = 5 // manually changed before app reopened
        AlarmVolume.restoreWith(context, stream)
        assertEquals(5, stream.level)
    }

    @Test fun serviceTeardownAfterLastLocalAckRestoresOwnedAlarmStream() {
        val audio = context.getSystemService(AudioManager::class.java)
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        assertTrue(max >= 2)
        audio.setStreamVolume(AudioManager.STREAM_ALARM, 1, 0)
        AlarmVolume.configure(context, true, 100)
        AlarmStore.preferences(context).edit().clear().commit()
        AlarmStore.add(context, AlertRecord("critical-volume", "Alarm", "body", 1))
        val service = Robolectric.buildService(AlarmService::class.java).create().get()
        // Simulates the service's already-foreground, focus-granted playback entry.
        AlarmVolume.begin(context)
        assertEquals(max, audio.getStreamVolume(AudioManager.STREAM_ALARM))
        AlarmEngine.acknowledgeAll(context)
        service.onDestroy()
        assertEquals(1, audio.getStreamVolume(AudioManager.STREAM_ALARM))
        assertFalse(AlarmStore.hasCritical(context))
    }
}
