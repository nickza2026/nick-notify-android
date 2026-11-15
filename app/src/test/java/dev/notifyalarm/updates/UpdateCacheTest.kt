package dev.notifyalarm.updates

import org.junit.Assert.*
import org.junit.After
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.UUID

class UpdateCacheTest {
    private val roots = mutableListOf<File>()
    private fun cache() = Files.createTempDirectory("updater-cache-test").toFile().also { roots += it }
    @After fun cleanupOwnedFixtures() {
        val temporaryRoot = File(System.getProperty("java.io.tmpdir")).canonicalFile
        roots.forEach { root ->
            check(root.name.startsWith("updater-cache-test") && root.canonicalFile.parentFile == temporaryRoot)
            check(!Files.isSymbolicLink(root.toPath()))
            File(root, "updates").listFiles()?.forEach { UpdateCache.release(it) }
            // Files.walk does not follow links by default; only this test's mkdtemp root is removed.
            Files.walk(root.toPath()).use { paths ->
                paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
            }
        }
    }
    private fun session(cache: File) = File(cache, "updates/${UUID.randomUUID()}").apply { mkdirs() }
    private fun offer(code: Int) = UpdateOffer(code, "0.8.1-in-app-updates", 1,
        "a".repeat(64), "descriptor", "apk")

    @Test fun completedUpgradeCleansOnlyKnownFilesButPendingHandoffRemains() {
        val cache = cache()
        val completed = session(cache)
        File(completed, "candidate.apk").writeText("verified")
        UpdateCache.receipt(cache, completed, offer(9))
        val pending = session(cache)
        File(pending, "candidate.apk").writeText("pending")
        UpdateCache.receipt(cache, pending, offer(10))
        UpdateCache.reclaimCompleted(cache, 8)
        assertTrue(File(completed, "candidate.apk").exists())
        UpdateCache.reclaimCompleted(cache, 9)
        assertFalse(File(completed, "candidate.apk").exists())
        assertTrue(File(pending, "candidate.apk").exists())
        val unknown = session(cache)
        File(unknown, "candidate.apk").writeText("unrecognized without receipt")
        UpdateCache.reclaimCompleted(cache, 100)
        assertTrue(File(unknown, "candidate.apk").exists())
    }

    @Test fun concurrentReservationsCannotExceedQuotaAndUnknownFilesArePreserved() {
        val cache = cache()
        val one = session(cache)
        val two = session(cache)
        val three = session(cache)
        val max = UpdatePolicy.MAX_APK
        UpdateCache.reserve(cache, one, max, 8)
        UpdateCache.reserve(cache, two, max, 8)
        try { UpdateCache.reserve(cache, three, 1, 8); fail("over quota") }
        catch (_: IOException) { }
        UpdateCache.release(one)
        UpdateCache.release(two)
        val unexpected = File(one, "unexpected")
        unexpected.writeText("preserve")
        try { UpdateCache.reserve(cache, three, 1, 8); fail("unknown file bypass") }
        catch (_: IOException) { }
        assertTrue(unexpected.exists())
    }

    @Test fun lowDiskCannotConsumeSpaceNeededForIncidentPersistence() {
        val cache = cache()
        val one = session(cache)
        val two = session(cache)
        val size = 20L * 1024 * 1024
        val free = 32L * 1024 * 1024 + size
        UpdateCache.reserve(cache, one, size, 8) { free }
        try {
            UpdateCache.reserve(cache, two, 1, 8) { free }
            fail("concurrent download consumed incident space reserve")
        } catch (_: IOException) { }
        UpdateCache.release(one)
        try {
            UpdateCache.reserve(cache, two, size, 8) { free - 1 }
            fail("low disk bypassed incident space reserve")
        } catch (_: IOException) { }
    }
}
