package dev.notifyalarm.updates

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import dev.notifyalarm.core.AlarmStore
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicLong

internal interface UpdateTransport {
    fun get(url: String, limit: Long, asset: Boolean = false, sink: (InputStream) -> Unit): Int
}

internal class GitHubTransport : UpdateTransport {
    override fun get(url: String, limit: Long, asset: Boolean, sink: (InputStream) -> Unit): Int {
        var next = url
        var redirected = false
        val deadline = System.nanoTime() +
            (if (limit > 256 * 1024) 180_000_000_000L else 30_000_000_000L)
        val timer = Timer("update-http-deadline", true)
        try {
            repeat(3) {
                val remaining = (deadline - System.nanoTime()) / 1_000_000L
                if (remaining <= 0) throw IOException("Update request timed out")
                val feed = !asset && next == UpdatePolicy.FEED
                if (!feed && !UpdatePolicy.safeUrl(next, redirected)) throw IOException("Untrusted update URL")
                val connection = (URL(next).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 8_000
                    readTimeout = 15_000
                    setRequestProperty("Accept", if (feed) "application/vnd.github+json" else "application/octet-stream")
                    setRequestProperty("User-Agent", "NotifyAlarm-Android-Updater")
                }
                val timeout = object : TimerTask() { override fun run() { connection.disconnect() } }
                timer.schedule(timeout, remaining)
                try {
                    val status = connection.responseCode
                    if (status in 300..399) {
                        if (feed || !asset || redirected || status !in listOf(301, 302, 303, 307, 308))
                            throw IOException("Untrusted redirect")
                        val location = connection.getHeaderField("Location") ?: throw IOException("Missing redirect")
                        if (!UpdatePolicy.safeUrl(location, cdn = true)) throw IOException("Untrusted redirect")
                        next = location
                        redirected = true
                    } else {
                        if (status == 200) {
                            if (connection.contentLengthLong > limit) throw IOException("Update response too large")
                            connection.inputStream.use { input -> sink(LimitedInput(input, limit)) }
                        }
                        return status
                    }
                } finally { timeout.cancel(); connection.disconnect() }
            }
            throw IOException("Too many redirects")
        } finally { timer.cancel() }
    }
}

internal class LimitedInput(
    private val input: InputStream,
    private val max: Long,
    private val cancelled: () -> Boolean = { false },
    private val deadline: Long = System.nanoTime() + 180_000_000_000L,
) : InputStream() {
    private var count = 0L
    private fun guard() {
        if (cancelled() || System.nanoTime() > deadline) throw IOException("Update transfer cancelled or timed out")
    }
    override fun read(): Int {
        guard()
        val byte = input.read()
        if (byte != -1 && ++count > max) throw IOException("Update response too large")
        return byte
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        guard()
        val read = input.read(buffer, offset, length)
        if (read > 0 && (count + read > max)) throw IOException("Update response too large")
        if (read > 0) count += read
        return read
    }
}

internal fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it) }

internal interface UpdateVerifier {
    fun installedCode(): Int
    fun installedCert(): String
    fun verifyArchive(file: File, offer: UpdateOffer)
}

internal class AndroidUpdateVerifier(private val context: Context) : UpdateVerifier {
    override fun installedCode(): Int {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
    }

    private fun cert(file: File?): String {
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else
            PackageManager.GET_SIGNATURES
        val info = if (file == null) context.packageManager.getPackageInfo(context.packageName, flags) else
            context.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
                ?: throw IOException("อ่านลายเซ็น APK ไม่ได้")
        @Suppress("DEPRECATION")
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        if (signatures?.size != 1) throw IOException("ลายเซ็น APK ไม่ถูกต้อง")
        return sha256(signatures[0].toByteArray())
    }

    override fun installedCert() = cert(null)

    override fun verifyArchive(file: File, offer: UpdateOffer) {
        val info = context.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            ?: throw IOException("APK ไม่ถูกต้อง")
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        if (info.packageName != context.packageName || info.versionName != offer.name ||
            code != offer.code.toLong() || code <= installedCode() || cert(file) != UpdatePolicy.CERT) {
            throw IOException("APK รุ่น/แพ็กเกจ/ลายเซ็นไม่ตรง")
        }
    }
}

internal class UpdateClient(
    private val context: Context,
    private val transport: UpdateTransport = GitHubTransport(),
    private val critical: () -> Boolean = { AlarmStore.hasCriticalForUpdate(context) },
    private val verifier: UpdateVerifier = AndroidUpdateVerifier(context),
) {
    // Each Activity/client owns its own files: another Activity cannot overwrite a pending handoff.
    private val directory = File(context.cacheDir, "updates/${UUID.randomUUID()}")
    private val candidate = File(directory, "candidate.apk")
    private val partial = File(directory, "candidate.part")
    private var offer: UpdateOffer? = null
    private var ready: UpdateOffer? = null
    private val generation = AtomicLong()
    private val workGeneration = ThreadLocal<Long>()
    private fun cancelled() = workGeneration.get()?.let { it != generation.get() } ?: false
    private fun beginWork(ticket: Long) {
        if (disposed || handedOff || ticket != generation.get()) throw IOException("การตรวจอัปเดตถูกยกเลิก")
        workGeneration.set(ticket)
    }
    @Volatile private var handedOff = false
    @Volatile private var disposed = false
    fun ticket(): Long = generation.get()
    fun hasHandedOff(): Boolean = handedOff

    fun guard() {
        if (cancelled() || handedOff || disposed) throw IOException("การตรวจอัปเดตถูกยกเลิก")
        val active = try { critical() } catch (error: Exception) {
            throw IOException("อ่านข้อมูลเหตุการณ์ไม่ได้ ไม่เริ่มอัปเดต", error)
        }
        if (active) throw IOException("มีเหตุการณ์สำคัญค้างอยู่ จัดการเหตุการณ์ก่อนอัปเดต")
    }

    private fun read(url: String, max: Long, asset: Boolean = false): Pair<Int, String> {
        var body = ByteArray(0)
        val status = transport.get(url, max, asset) {
            body = LimitedInput(it, max, { cancelled() }, System.nanoTime() + 30_000_000_000L).readBytes()
        }
        return status to body.toString(Charsets.UTF_8)
    }

    @Synchronized fun check(ticket: Long = this.ticket()): String {
        beginWork(ticket)
        clear()
        guard()
        UpdateCache.reclaimCompleted(context.cacheDir, installedCode())
        guard()
        val (status, body) = read(UpdatePolicy.FEED, 256 * 1024)
        if (status == 404) return "ยังไม่มีรุ่นอัปเดตเผยแพร่"
        if (status != 200) throw IOException("ตรวจรุ่นไม่ได้ (HTTP $status)")
        val release = try { UpdatePolicy.release(body) } catch (error: Exception) {
            throw IOException("ข้อมูล GitHub release ไม่ถูกต้อง", error)
        } ?: return "ยังไม่มีรุ่นอัปเดตที่ใช้งานได้"
        val (name, descriptorUrl, apkUrl) = release
        val (manifestStatus, manifest) = read(descriptorUrl, 32 * 1024, true)
        if (manifestStatus != 200) throw IOException("อ่านข้อมูลอัปเดตไม่ได้ (HTTP $manifestStatus)")
        val parsed = try { UpdatePolicy.descriptor(manifest, name, descriptorUrl, apkUrl) }
            catch (error: Exception) { throw IOException("ข้อมูลรุ่นอัปเดตไม่ถูกต้อง", error) }
            ?: throw IOException("ข้อมูลรุ่นอัปเดตไม่ถูกต้อง")
        if (parsed.code <= installedCode()) return "แอปเป็นรุ่นล่าสุดแล้ว (${installedCode()})"
        ensureInstalledCert()
        guard()
        offer = parsed
        return "พบรุ่น ${parsed.name} (${parsed.code}) กดดาวน์โหลดเพื่อตรวจสอบไฟล์"
    }

    @Synchronized fun download(ticket: Long = this.ticket()): String {
        beginWork(ticket)
        val item = offer ?: throw IOException("กรุณาตรวจรุ่นก่อน")
        clearFile()
        guard()
        UpdateCache.reserve(context.cacheDir, directory, item.size, installedCode())
        try {
            guard()
            if (!directory.exists() && !directory.mkdirs()) throw IOException("สร้างพื้นที่ดาวน์โหลดไม่ได้")
            guard()
            var count = 0L
            val digest = MessageDigest.getInstance("SHA-256")
            val status = transport.get(item.apkUrl, UpdatePolicy.MAX_APK, true) { raw ->
                val input = LimitedInput(raw, UpdatePolicy.MAX_APK, { cancelled() })
                partial.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val n = input.read(buffer)
                        if (n == -1) break
                        count += n
                        if (count > item.size || count > UpdatePolicy.MAX_APK) throw IOException("ไฟล์ใหญ่เกินกำหนด")
                        digest.update(buffer, 0, n)
                        output.write(buffer, 0, n)
                    }
                    output.fd.sync()
                }
            }
            if (status != 200 || count != item.size ||
                digest.digest().joinToString("") { "%02x".format(it) } != item.hash) {
                throw IOException("ไฟล์อัปเดตไม่ตรงข้อมูลที่เผยแพร่")
            }
            verifier.verifyArchive(partial, item)
            guard()
            if (!partial.renameTo(candidate)) throw IOException("บันทึกไฟล์อัปเดตไม่ได้")
            UpdateCache.receipt(context.cacheDir, directory, item)
            ready = item
            return "ตรวจไฟล์รุ่น ${item.name} แล้ว กดติดตั้งเพื่อให้ Android ขอการยืนยัน"
        } catch (failure: Exception) {
            clearFile()
            throw failure
        } finally {
            UpdateCache.release(directory)
        }
    }

    @Synchronized fun installable(ticket: Long = this.ticket()): File {
        beginWork(ticket)
        guard()
        ensureInstalledCert()
        val item = ready ?: throw IOException("กรุณาดาวน์โหลดและตรวจไฟล์ใหม่")
        if (!candidate.isFile || candidate.length() != item.size ||
            hashFile(candidate) != item.hash) {
            clearFile()
            throw IOException("ไฟล์อัปเดตเปลี่ยนไป กรุณาดาวน์โหลดใหม่")
        }
        try { verifier.verifyArchive(candidate, item); guard() } catch (failure: Exception) {
            clearFile()
            throw failure
        }
        return candidate
    }

    fun installedCode(): Int = verifier.installedCode()

    private fun ensureInstalledCert() {
        if (verifier.installedCert() != UpdatePolicy.CERT) throw IOException(
            "แอปที่ติดตั้งลงชื่อคนละใบกับรุ่นเผยแพร่ (เช่น local debug) ไม่สามารถอัปเดตทับได้")
    }

    @Synchronized fun clear() { offer = null; clearFile() }
    private fun clearFile() {
        ready = null
        partial.delete()
        if (!handedOff) {
            candidate.delete()
            File(directory, "receipt").delete()
            File(directory, "receipt.tmp").delete()
        }
    }

    /** Cancels in-flight reads; candidate stays private until an explicit new install tap. */
    fun cancelWork() { generation.incrementAndGet() }

    /** Retain an immutable APK after handoff: Android may still be reading its content URI. */
    @Synchronized fun markHandedOff() {
        if (ready == null) throw IOException("ไฟล์อัปเดตไม่พร้อม")
        handedOff = true
    }

    fun dispose() {
        disposed = true
        cancelWork()
        synchronized(this) {
            clear()
            if (!handedOff) {
                File(directory, "receipt").delete()
                directory.delete()
            }
        }
    }

    private fun hashFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
