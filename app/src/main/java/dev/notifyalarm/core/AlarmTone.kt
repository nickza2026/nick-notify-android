package dev.notifyalarm.core

import java.io.ByteArrayOutputStream
import kotlin.math.PI
import kotlin.math.sin

/** App-owned PCM fallback: no media permission, network or system ringtone dependency. */
internal object AlarmTone {
    const val SAMPLE_RATE = 16000
    const val SAMPLE_COUNT = SAMPLE_RATE * 2

    fun wave(): ByteArray {
        val out = ByteArrayOutputStream(44 + SAMPLE_COUNT * 2)
        fun ascii(value: String) { out.write(value.toByteArray(Charsets.US_ASCII)) }
        fun little(value: Int, bytes: Int) {
            repeat(bytes) { index -> out.write((value ushr (index * 8)) and 0xff) }
        }
        ascii("RIFF"); little(36 + SAMPLE_COUNT * 2, 4); ascii("WAVE")
        ascii("fmt "); little(16, 4); little(1, 2); little(1, 2)
        little(SAMPLE_RATE, 4); little(SAMPLE_RATE * 2, 4); little(2, 2); little(16, 2)
        ascii("data"); little(SAMPLE_COUNT * 2, 4)
        repeat(SAMPLE_COUNT) { sample ->
            val time = sample.toDouble() / SAMPLE_RATE
            val phase = time % 1.0
            val frequency = if (phase < 0.45) 880.0 else 660.0
            val envelope = when {
                phase < 0.02 -> phase / 0.02
                phase < 0.8 -> 1.0
                phase < 0.85 -> (0.85 - phase) / 0.05
                else -> 0.0
            }
            little((sin(2 * PI * frequency * time) * 21000 * envelope).toInt(), 2)
        }
        return out.toByteArray()
    }
}
