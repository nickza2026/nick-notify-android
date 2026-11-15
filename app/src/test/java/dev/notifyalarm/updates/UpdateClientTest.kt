package dev.notifyalarm.updates

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
class UpdateClientTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val name = "0.8.1-in-app-updates"
    private val tag = "android-v$name"
    private val descriptorUrl = "https://github.com/nickza2026/nick-notify-android/releases/download/$tag/notify-alarm-update.json"
    private val apkUrl = "https://github.com/nickza2026/nick-notify-android/releases/download/$tag/notify-alarm-$name-debug.apk"
    private val apk = "synthetic apk bytes".toByteArray()

    private fun release() = """{"draft":false,"prerelease":false,"tag_name":"$tag","assets":[
        {"name":"notify-alarm-update.json","browser_download_url":"$descriptorUrl"},
        {"name":"notify-alarm-$name-debug.apk","browser_download_url":"$apkUrl"}]}"""
    private fun manifest(code: Int = 9, size: Long = apk.size.toLong(), hash: String = sha256(apk)) =
        """{"schema_version":1,"application_id":"dev.notifyalarm","version_code":$code,
        "version_name":"$name","apk_asset":"notify-alarm-$name-debug.apk","apk_sha256":"$hash",
        "apk_size":$size,"signing_cert_sha256":"${UpdatePolicy.CERT}"}"""

    private class StubVerifier(
        var installed: Int = 8,
        var cert: String = UpdatePolicy.CERT,
        var archivePackage: String = "dev.notifyalarm",
        var archiveCode: Int = 9,
        var archiveCert: String = UpdatePolicy.CERT,
    ) : UpdateVerifier {
        override fun installedCode() = installed
        override fun installedCert() = cert
        override fun verifyArchive(file: File, offer: UpdateOffer) {
            if (!file.isFile || archivePackage != "dev.notifyalarm" || archiveCode != offer.code ||
                archiveCode <= installed || archiveCert != UpdatePolicy.CERT) throw IOException("archive mismatch")
        }
    }

    private class FakeTransport(private val response: (String) -> Pair<Int, ByteArray>) : UpdateTransport {
        val requested = mutableListOf<String>()
        override fun get(url: String, limit: Long, asset: Boolean, sink: (InputStream) -> Unit): Int {
            requested += url
            val (status, bytes) = response(url)
            if (status == 200) sink(bytes.inputStream())
            return status
        }
    }

    private fun transport(manifest: String = manifest(), payload: ByteArray = apk): FakeTransport =
        FakeTransport { url -> when (url) {
            UpdatePolicy.FEED -> 200 to release().toByteArray()
            descriptorUrl -> 200 to manifest.toByteArray()
            apkUrl -> 200 to payload
            else -> error("unexpected URL $url")
        } }

    private fun alarmState(active: JSONArray) = JSONObject().put("active", active)
        .put("terminal", JSONObject()).put("pending_ack", JSONArray()).toString()
    private fun saveState(value: String?) {
        context.getSharedPreferences("native_alarm_state", Context.MODE_PRIVATE).edit()
            .putString("incidents_v1", value).commit()
    }

    @Test fun upToDateAndOlderAreFriendlyNotInvalidAndDoNotDownload() {
        saveState(null)
        for (code in listOf(7, 8)) {
            val network = transport(manifest(code))
            val client = UpdateClient(context, network, verifier = StubVerifier())
            assertTrue(client.check().contains("รุ่นล่าสุด"))
            assertEquals(listOf(UpdatePolicy.FEED, descriptorUrl), network.requested)
            assertFails { client.download() }
            client.dispose()
        }
    }

    @Test fun downloadVerifiesHashSizeArchiveAndDoesNotReuseStaleCandidate() {
        saveState(null)
        val verifier = StubVerifier()
        val network = transport()
        val client = UpdateClient(context, network, verifier = verifier)
        client.check()
        client.download()
        val file = client.installable()
        assertTrue(file.isFile)
        file.writeText("tampered")
        assertFails { client.installable() }
        assertFalse(file.exists())
        assertFails { client.installable() }
        client.check()
        verifier.archivePackage = "foreign.app"
        assertFails { client.download() }
        assertFails { client.installable() }
        verifier.archivePackage = "dev.notifyalarm"
        client.check()
        client.download()
        verifier.archiveCert = "0".repeat(64)
        assertFails { client.installable() }
        client.dispose()

        val mismatch = StubVerifier(cert = "0".repeat(64))
        val foreignInstalled = UpdateClient(context, transport(), verifier = mismatch)
        assertFails { foreignInstalled.check() }
        foreignInstalled.dispose()

        val bad = UpdateClient(context, transport(payload = "wrong bytes".toByteArray()), verifier = StubVerifier())
        bad.check()
        assertFails { bad.download() }
        assertFails { bad.installable() }
        bad.dispose()
        val big = UpdateClient(context, transport(payload = apk + byteArrayOf(1)), verifier = StubVerifier())
        big.check()
        assertFails { big.download() }
        assertFails { big.installable() }
        big.dispose()
    }

    @Test fun corruptAlarmRecordsFailClosedAndCriticalBlocksEveryStageWithoutChangingState() {
        val state = alarmState(JSONArray().put(JSONObject().put("id", "x").put("title", "t")
            .put("message", "m").put("created_at", 1).put("importance", "critical")))
        val network = transport()
        val client = UpdateClient(context, network, verifier = StubVerifier())
        for (broken in listOf("not-json", "{}", alarmState(JSONArray().put(JSONObject().put("id", "x"))),
            alarmState(JSONArray().put(JSONObject().put("id", "x").put("title", "t")
                .put("message", "m").put("created_at", 1).put("importance", "unknown"))))) {
            saveState(broken)
            assertFails { client.check() }
            assertEquals(broken, context.getSharedPreferences("native_alarm_state", 0).getString("incidents_v1", null))
        }
        saveState(null)
        client.check()
        saveState(state)
        assertFails { client.download() }
        assertFails { client.installable() }
        assertFails { client.check() }
        assertEquals(state, context.getSharedPreferences("native_alarm_state", 0).getString("incidents_v1", null))
        client.dispose()

        saveState(null)
        val acquired = UpdateClient(context, transport(), verifier = StubVerifier())
        acquired.check(); acquired.download()
        saveState(state)
        assertFails { acquired.installable() }
        assertFails { acquired.check() }
        saveState(null)
        assertFails { acquired.installable() } // blocked check discarded the previous acquisition
        acquired.dispose()
    }

    @Test fun twoClientsNeverOverwriteOneAnothersCandidateAndCancellationStopsStream() {
        saveState(null)
        val first = UpdateClient(context, transport(), verifier = StubVerifier())
        val second = UpdateClient(context, transport(), verifier = StubVerifier())
        first.check(); second.check()
        first.download(); second.download()
        val firstFile = first.installable()
        val secondFile = second.installable()
        assertNotEquals(firstFile.absolutePath, secondFile.absolutePath)
        first.dispose()
        assertTrue(secondFile.exists())
        second.dispose()

        val entered = CountDownLatch(1)
        val gate = CountDownLatch(1)
        val blocking = FakeTransport { url ->
            if (url == apkUrl) {
                entered.countDown()
                gate.await(2, TimeUnit.SECONDS)
            }
            when (url) {
                UpdatePolicy.FEED -> 200 to release().toByteArray()
                descriptorUrl -> 200 to manifest().toByteArray()
                else -> 200 to apk
            }
        }
        val client = UpdateClient(context, blocking, verifier = StubVerifier())
        client.check()
        val workerFailure = AtomicReference<Throwable?>()
        val worker = Thread {
            try { client.download(); workerFailure.set(AssertionError("expected cancelled download")) }
            catch (error: IOException) { /* expected */ }
            catch (error: Throwable) { workerFailure.set(error) }
        }
        worker.start()
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        client.cancelWork()
        gate.countDown()
        worker.join(3000)
        assertFalse(worker.isAlive)
        workerFailure.get()?.let { throw AssertionError("background check failed", it) }
        assertFails { client.installable() }
        client.dispose()
    }

    @Test fun queuedTicketCancelledBeforeEntryAndDisposedClientNeverStartsNetwork() {
        saveState(null)
        val network = transport()
        val client = UpdateClient(context, network, verifier = StubVerifier())
        val ticket = client.ticket()
        client.cancelWork()
        assertFails { client.check(ticket) }
        assertTrue(network.requested.isEmpty())
        client.dispose()
        assertFails { client.check(client.ticket()) }
        assertTrue(network.requested.isEmpty())
    }

    @Test fun handedOffClientIsImmutableAndNewClientCanRetryOnlyAfterFreshAcquisition() {
        saveState(null)
        val first = UpdateClient(context, transport(), verifier = StubVerifier())
        first.check(); first.download()
        val old = first.installable()
        first.markHandedOff()
        first.cancelWork() // returning from installer invalidates all old callbacks
        assertTrue(first.hasHandedOff())
        assertFails { first.check() }
        first.dispose()
        assertTrue(old.exists()) // OS might still read the old content URI
        val second = UpdateClient(context, transport(), verifier = StubVerifier())
        assertFails { second.download() }
        assertFails { second.installable() }
        second.check(); second.download()
        assertNotEquals(old.absolutePath, second.installable().absolutePath)
        second.dispose()
    }

    private fun assertFails(action: () -> Unit) {
        try { action(); fail("expected update rejection") } catch (_: IOException) { }
    }
}
