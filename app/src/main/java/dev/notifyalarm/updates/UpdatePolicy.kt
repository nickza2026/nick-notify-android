package dev.notifyalarm.updates

import org.json.JSONObject
import java.net.URI

internal data class UpdateOffer(
    val code: Int,
    val name: String,
    val size: Long,
    val hash: String,
    val descriptorUrl: String,
    val apkUrl: String,
)

internal object UpdatePolicy {
    const val FEED = "https://api.github.com/repos/nickza2026/nick-notify-android/releases/latest"
    const val CERT = "79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4"
    const val MAX_APK = 128L * 1024 * 1024
    private val version = Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?")
    private val digest = Regex("[a-f0-9]{64}")

    fun safeUrl(url: String, cdn: Boolean = false): Boolean = try {
        val uri = URI(url)
        uri.scheme == "https" && uri.rawUserInfo == null && uri.port == -1 &&
            uri.rawFragment == null && uri.host?.lowercase() ==
            (if (cdn) "release-assets.githubusercontent.com" else "github.com") &&
            (if (cdn) uri.rawPath.startsWith("/") else uri.rawQuery == null &&
                uri.rawPath.startsWith("/nickza2026/nick-notify-android/releases/download/"))
    } catch (_: Exception) { false }

    fun assetUrl(url: String, tag: String, name: String): Boolean =
        safeUrl(url) && URI(url).rawPath ==
            "/nickza2026/nick-notify-android/releases/download/$tag/$name"

    fun release(raw: String): Triple<String, String, String>? {
        val json = JSONObject(raw)
        if (json.optBoolean("draft", true) || json.optBoolean("prerelease", true)) return null
        val tag = json.getString("tag_name")
        if (!tag.startsWith("android-v") || !version.matches(tag.removePrefix("android-v"))) return null
        val name = tag.removePrefix("android-v")
        val assets = json.getJSONArray("assets")
        fun asset(filename: String): String? {
            val matches = (0 until assets.length()).map { assets.getJSONObject(it) }
                .filter { it.optString("name") == filename }
            if (matches.size != 1) return null
            return matches.single().getString("browser_download_url").takeIf { assetUrl(it, tag, filename) }
        }
        val descriptor = asset("notify-alarm-update.json") ?: return null
        val apk = asset("notify-alarm-$name-debug.apk") ?: return null
        return Triple(name, descriptor, apk)
    }

    fun descriptor(raw: String, releaseName: String, descriptorUrl: String, apkUrl: String): UpdateOffer? {
        if (!assetUrl(descriptorUrl, "android-v$releaseName", "notify-alarm-update.json") ||
            !assetUrl(apkUrl, "android-v$releaseName", "notify-alarm-$releaseName-debug.apk")) return null
        val json = JSONObject(raw)
        if (json.keys().asSequence().toSet() != setOf("schema_version", "application_id", "version_code", "version_name",
                "apk_asset", "apk_sha256", "apk_size", "signing_cert_sha256")) return null
        val code = json.get("version_code") as? Number ?: return null
        val size = json.get("apk_size") as? Number ?: return null
        if (code !is Int && code !is Long || size !is Int && size !is Long) return null
        if (json.get("schema_version") != 1 || json.getString("application_id") != "dev.notifyalarm" ||
            !version.matches(releaseName) || json.getString("version_name") != releaseName ||
            code.toLong() !in 1..Int.MAX_VALUE.toLong() || code.toDouble() != code.toLong().toDouble() ||
            size.toLong() !in 1..MAX_APK ||
            size.toDouble() != size.toLong().toDouble() ||
            json.getString("apk_asset") != "notify-alarm-$releaseName-debug.apk" ||
            json.getString("signing_cert_sha256") != CERT ||
            !digest.matches(json.getString("apk_sha256"))) return null
        return UpdateOffer(code.toInt(), releaseName, size.toLong(), json.getString("apk_sha256"),
            descriptorUrl, apkUrl)
    }
}
