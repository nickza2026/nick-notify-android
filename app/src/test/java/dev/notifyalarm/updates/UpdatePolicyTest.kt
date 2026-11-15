package dev.notifyalarm.updates

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
class UpdatePolicyTest {
    private val name = "0.8.1-in-app-updates"
    private val tag = "android-v$name"
    private fun url(asset: String) =
        "https://github.com/nickza2026/nick-notify-android/releases/download/$tag/$asset"
    private val descriptorUrl get() = url("notify-alarm-update.json")
    private val apkUrl get() = url("notify-alarm-$name-debug.apk")
    private fun release(descriptor: String = descriptorUrl, apk: String = apkUrl) = """
        {"draft":false,"prerelease":false,"tag_name":"$tag","assets":[
          {"name":"notify-alarm-update.json","browser_download_url":"$descriptor"},
          {"name":"notify-alarm-$name-debug.apk","browser_download_url":"$apk"}]}
    """.trimIndent()
    private fun manifest(code: Int = 9, hash: String = "a".repeat(64), size: Long = 100) = """
        {"schema_version":1,"application_id":"dev.notifyalarm","version_code":$code,
        "version_name":"$name","apk_asset":"notify-alarm-$name-debug.apk",
        "apk_sha256":"$hash","apk_size":$size,"signing_cert_sha256":"${UpdatePolicy.CERT}"}
    """.trimIndent()

    @Test fun validReleaseAndManifestParseIndependentOfInstalledVersion() {
        assertNotNull(UpdatePolicy.release(release()))
        assertEquals(9, UpdatePolicy.descriptor(manifest(), name, descriptorUrl, apkUrl)?.code)
        assertEquals(8, UpdatePolicy.descriptor(manifest(code = 8), name, descriptorUrl, apkUrl)?.code)
        assertEquals(7, UpdatePolicy.descriptor(manifest(code = 7), name, descriptorUrl, apkUrl)?.code)
    }

    @Test fun rejectsWrongOriginAndReleaseIdentity() {
        assertNull(UpdatePolicy.release(release(apk = "https://evil.example/apk")))
        assertNull(UpdatePolicy.release(release(apk = apkUrl + "?token=secret")))
        assertNull(UpdatePolicy.release(release().replace("\"draft\":false", "\"draft\":true")))
        assertNull(UpdatePolicy.release(release().replace("android-v$name", "ios-v$name")))
        assertFalse(UpdatePolicy.safeUrl("http://release-assets.githubusercontent.com/abc", true))
        assertFalse(UpdatePolicy.safeUrl("https://github.com@evil.example/path"))
        assertTrue(UpdatePolicy.safeUrl("https://release-assets.githubusercontent.com/abc?sig=x", true))
    }

    @Test fun rejectsTamperOversizeCertificateAndPackage() {
        assertNull(UpdatePolicy.descriptor(manifest(size = UpdatePolicy.MAX_APK + 1), name, descriptorUrl, apkUrl))
        assertNull(UpdatePolicy.descriptor(manifest(hash = "B".repeat(64)), name, descriptorUrl, apkUrl))
        assertNull(UpdatePolicy.descriptor(manifest().replace(UpdatePolicy.CERT, "0".repeat(64)), name, descriptorUrl, apkUrl))
        assertNull(UpdatePolicy.descriptor(manifest().replace("dev.notifyalarm", "other.app"), name, descriptorUrl, apkUrl))
        assertNull(UpdatePolicy.descriptor(manifest().replace("\"schema_version\":1", "\"schema_version\":2"), name, descriptorUrl, apkUrl))
        assertNull(UpdatePolicy.descriptor(manifest().replace("\"schema_version\":1", "\"extra\":true,\"schema_version\":1"), name, descriptorUrl, apkUrl))
    }

    @Test fun boundedStreamRejectsOversizeEvenWithoutContentLength() {
        val bytes = ByteArrayInputStream(ByteArray(33))
        try {
            LimitedInput(bytes, 32).readBytes()
            fail("unbounded input")
        } catch (_: IOException) { }
    }
}
