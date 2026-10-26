package dev.notifyalarm.core

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AlarmToneTest {
    @Test fun fallbackIsValidNonSilentLoopablePcmWave() {
        val wave = AlarmTone.wave()
        val bytes = ByteBuffer.wrap(wave).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wave, 0, 4, Charsets.US_ASCII))
        assertEquals("WAVE", String(wave, 8, 4, Charsets.US_ASCII))
        assertEquals(wave.size - 8, bytes.getInt(4))
        assertEquals(1, bytes.getShort(20).toInt())
        assertEquals(1, bytes.getShort(22).toInt())
        assertEquals(AlarmTone.SAMPLE_RATE, bytes.getInt(24))
        assertEquals(16, bytes.getShort(34).toInt())
        assertEquals(AlarmTone.SAMPLE_COUNT * 2, bytes.getInt(40))
        assertEquals(44 + AlarmTone.SAMPLE_COUNT * 2, wave.size)
        assertTrue((44 until wave.size step 2).any { bytes.getShort(it).toInt() != 0 })
        assertArrayEquals(wave, AlarmTone.wave())
    }
}
