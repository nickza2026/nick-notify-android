package dev.notifyalarm.updates

import java.io.File
import java.io.IOException
import java.util.UUID

/** App-cache-only accounting. Never delete a pending handoff or an unrecognized file. */
internal object UpdateCache {
    private const val QUOTA = 256L * 1024 * 1024
    private const val MIN_FREE_SPACE = 32L * 1024 * 1024
    private val reservations = mutableMapOf<String, Long>()
    private val ownedNames = setOf("candidate.apk", "candidate.part", "receipt", "receipt.tmp")

    private fun root(cache: File): File {
        val expected = File(cache.canonicalFile, "updates")
        val actual = expected.canonicalFile
        if (actual != expected) throw IOException("ตำแหน่งแคชอัปเดตไม่ถูกต้อง")
        return actual
    }

    private fun sessions(cache: File): List<File> {
        val root = root(cache)
        if (!root.exists()) return emptyList()
        return root.listFiles()?.toList() ?: throw IOException("อ่านพื้นที่อัปเดตไม่ได้")
    }

    private fun owned(root: File, session: File): Boolean =
        runCatching { UUID.fromString(session.name) }.isSuccess && session.isDirectory &&
            session.canonicalFile.parentFile == root

    @Synchronized fun reclaimCompleted(cache: File, installedCode: Int) {
        val root = root(cache)
        sessions(cache).forEach { session ->
            if (!owned(root, session) || reservations.containsKey(session.canonicalPath)) return@forEach
            val receipt = File(session, "receipt")
            val receiptText = receipt.takeIf { it.isFile && it.length() in 1..128 }?.readText()
            val code = receiptText?.takeIf { it.matches(Regex("[1-9][0-9]*:[a-f0-9]{64}")) }
                ?.substringBefore(':')?.toIntOrNull()
            if (code == null || code <= 0 || code > installedCode) return@forEach
            // A receipt names only our own candidate; refuse to traverse or delete any other path.
            listOf("candidate.apk", "candidate.part", "receipt", "receipt.tmp").forEach { name ->
                val file = File(session, name)
                if (file.isFile && file.canonicalFile.parentFile == session.canonicalFile) file.delete()
            }
            session.delete() // succeeds only if empty
        }
    }

    @Synchronized fun reserve(cache: File, session: File, bytes: Long, installedCode: Int,
                              freeSpace: () -> Long = { cache.usableSpace }) {
        if (bytes !in 1..UpdatePolicy.MAX_APK) throw IOException("ขนาด APK ไม่ถูกต้อง")
        val root = root(cache)
        if (!root.exists() && !root.mkdirs()) throw IOException("สร้างพื้นที่อัปเดตไม่ได้")
        if (!ownedPath(root, session)) throw IOException("ตำแหน่งไฟล์อัปเดตไม่ถูกต้อง")
        reclaimCompleted(cache, installedCode)
        val existing = sessions(cache).sumOf { entry ->
            if (entry.isFile) entry.length() else if (owned(root, entry)) {
                val files = entry.listFiles() ?: throw IOException("อ่านพื้นที่อัปเดตไม่ได้")
                files.sumOf { file ->
                    if (!file.isFile || file.name !in ownedNames || file.canonicalFile.parentFile != entry.canonicalFile)
                        throw IOException("พื้นที่อัปเดตมีไฟล์ที่ไม่รู้จัก กรุณาล้างแคชของแอปผ่าน Android Settings")
                    file.length()
                }
            } else throw IOException("พื้นที่อัปเดตมีรายการที่ไม่รู้จัก กรุณาล้างแคชของแอปผ่าน Android Settings")
        }
        val reserved = reservations.values.sum()
        // Keep room for incident/Ack persistence, including concurrent download reservations.
        if (freeSpace() - bytes - reserved < MIN_FREE_SPACE) throw IOException(
            "พื้นที่ว่างไม่พออัปเดตโดยเว้นพื้นที่บันทึกเหตุการณ์ กรุณาจัดการพื้นที่ก่อน")
        if (existing > QUOTA - reserved - bytes) throw IOException(
            "แคชอัปเดตเต็ม กรุณาล้างแคชของแอปผ่าน Android Settings (ไม่ต้องล้างข้อมูลแอป)")
        reservations[session.canonicalPath] = bytes
    }

    @Synchronized fun release(session: File) { reservations.remove(session.canonicalPath) }

    @Synchronized fun receipt(cache: File, session: File, offer: UpdateOffer) {
        if (!ownedPath(root(cache), session)) throw IOException("ตำแหน่งไฟล์อัปเดตไม่ถูกต้อง")
        val temp = File(session, "receipt.tmp")
        temp.outputStream().use { output ->
            output.write("${offer.code}:${offer.hash}".toByteArray(Charsets.US_ASCII))
            output.fd.sync()
        }
        if (!temp.renameTo(File(session, "receipt"))) throw IOException("บันทึกข้อมูลแคชไม่ได้")
    }

    private fun ownedPath(root: File, session: File): Boolean =
        runCatching { UUID.fromString(session.name) }.isSuccess && session.canonicalFile.parentFile == root
}
