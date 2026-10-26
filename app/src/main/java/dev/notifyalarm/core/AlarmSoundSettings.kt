package dev.notifyalarm.core

import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.RingtoneManager
import android.net.Uri
import java.io.File
import java.util.UUID

/** Sound is a device-local preference. A change applies to the next player, not a running alarm. */
object AlarmSoundSettings {
    private const val PREFS = "alarm_sound_preferences"
    const val MAX_IMPORT_BYTES = 20 * 1024 * 1024

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun label(context: Context): String = when (prefs(context).getString("mode", "default")) {
        "builtin" -> "เสียงสำรองของแอป"
        "custom", "system" -> prefs(context).getString("label", "เสียงที่เลือก") ?: "เสียงที่เลือก"
        else -> "เสียงปลุกเริ่มต้นของ Android"
    }

    fun resolve(context: Context): Uri? {
        val preferences = prefs(context)
        return when (preferences.getString("mode", "default")) {
            "builtin" -> null
            "system" -> preferences.getString("uri", null)?.let(Uri::parse)
            "custom" -> preferences.getString("file", null)?.takeIf { it.matches(Regex("[a-f0-9-]+\\.audio")) }
                ?.let { Uri.fromFile(File(File(context.filesDir, "alarm-sounds"), it)) }
            else -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        }
    }

    fun useDefault(context: Context) {
        check(prefs(context).edit().clear().putString("mode", "default").commit())
    }

    fun useBuiltin(context: Context) {
        check(prefs(context).edit().clear().putString("mode", "builtin").commit())
    }

    fun useSystem(context: Context, uri: Uri, label: String) {
        require(uri.scheme == "content" || uri.scheme == "android.resource") { "Unsupported sound URI" }
        check(prefs(context).edit().clear().putString("mode", "system")
            .putString("uri", uri.toString()).putString("label", label.take(120)).commit())
    }

    /** Copy selected audio into app-private storage: no broad media permission or cloud dependency. */
    @Synchronized
    fun importAudio(context: Context, uri: Uri, label: String) {
        require(uri.scheme == "content") { "Select an audio document" }
        val app = context.applicationContext
        val directory = File(app.filesDir, "alarm-sounds")
        check(directory.isDirectory || directory.mkdirs()) { "Cannot create sound directory" }
        val destination = File(directory, "${UUID.randomUUID()}.audio")
        try {
            app.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "Cannot read audio" }
                destination.outputStream().use { output ->
                    val buffer = ByteArray(16 * 1024)
                    var total = 0
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_IMPORT_BYTES) { "Audio exceeds 20 MiB" }
                        output.write(buffer, 0, count)
                    }
                    require(total > 0) { "Empty audio" }
                    output.fd.sync()
                }
            }
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(destination.absolutePath)
                require((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0) > 0) {
                    "Unsupported audio format"
                }
                require(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes") {
                    "Document has no audio track"
                }
            } finally { retriever.release() }
            check(prefs(app).edit().clear().putString("mode", "custom")
                .putString("file", destination.name).putString("label", label.take(120)).commit())
        } catch (error: Exception) {
            destination.delete()
            throw error
        }
        // Linux keeps a currently playing file descriptor valid even after unlinking an old sound.
        directory.listFiles()?.filter { it != destination && it.name.matches(Regex("[a-f0-9-]+\\.audio")) }
            ?.forEach { it.delete() }
    }
}
