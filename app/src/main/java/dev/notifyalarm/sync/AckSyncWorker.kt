package dev.notifyalarm.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dev.notifyalarm.core.AlarmStore
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** At-least-once delivery. The server Ack endpoint must be idempotent by alert ID. */
class AckSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        withContext(Dispatchers.IO) { drain() }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Storage or WorkManager errors must not crash the process or expose capabilities in logs.
        Result.retry()
    }

    private fun drain(): Result {
        val pending = AlarmStore.pendingAcknowledgements(applicationContext).distinct()
        val confirmed = pending.filter { AckSync.isConfirmed(applicationContext, it) }
        if (confirmed.isNotEmpty()) {
            AlarmStore.confirmAcknowledgements(applicationContext, confirmed.toSet())
        }
        val eligible = pending.filter { id ->
            id !in confirmed && !AckSync.isBlocked(applicationContext, id) &&
                AckSync.route(applicationContext, id) != null
        }
        if (eligible.isEmpty()) return Result.success()

        // Rotating the starting point prevents a repeatedly failing first batch from
        // starving later alerts. A retry uses WorkManager's exponential network backoff.
        val start = AckSync.cursor(applicationContext).mod(eligible.size)
        val batch = (0 until minOf(25, eligible.size)).map { eligible[(start + it) % eligible.size] }
        if (!AckSync.setCursor(applicationContext, (start + batch.size) % eligible.size)) return Result.retry()
        var retry = false
        for (id in batch) {
            if (isStopped) return Result.retry()
            val route = AckSync.route(applicationContext, id) ?: continue
            val acknowledgedAt = AlarmStore.acknowledgedAt(applicationContext, id)
            val actionId = AlarmStore.acknowledgementActionId(applicationContext, id)
            if (acknowledgedAt == null || acknowledgedAt <= 0L || actionId == null) {
                if (!AckSync.block(applicationContext, id, "invalid_local_ack")) return Result.retry()
                continue
            }
            when (send(route, id, acknowledgedAt, actionId)) {
                Outcome.CONFIRMED -> {
                    if (!AckSync.confirm(applicationContext, id)) return Result.retry()
                    AlarmStore.confirmAcknowledgements(applicationContext, setOf(id))
                }
                Outcome.PERMANENT -> if (!AckSync.block(applicationContext, id, "rejected")) return Result.retry()
                Outcome.RETRY -> retry = true
            }
        }
        if (retry) return Result.retry()
        // Append behind the currently running work, never replace its snapshot. Blocked
        // and route-less records are excluded so a permanent response cannot self-loop.
        if (eligible.size > batch.size) AckSync.schedule(applicationContext)
        return Result.success()
    }

    private enum class Outcome { CONFIRMED, PERMANENT, RETRY }

    private fun send(route: AckSync.Route, id: String, acknowledgedAt: Long, actionId: String): Outcome {
        // Validate again immediately before opening the connection, including persisted data.
        if (!AckPolicy.validUrl(route.url, id) || !AckPolicy.validToken(route.token)) return Outcome.PERMANENT
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(route.url).openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.requestMethod = "POST"
            connection.setRequestProperty("Authorization", "Bearer ${route.token}")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.doOutput = true
            val body = JSONObject().put("client_acked_at", Instant.ofEpochMilli(acknowledgedAt).toString())
                .put("client_action_id", actionId)
                .toString().toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            when (connection.responseCode) {
                200 -> {
                    val bytes = connection.inputStream.use { stream ->
                        val buffer = ByteArray(8193)
                        var count = 0
                        while (count < buffer.size) {
                            val read = stream.read(buffer, count, buffer.size - count)
                            if (read < 0) break
                            count += read
                        }
                        buffer.copyOf(count)
                    }
                    if (bytes.size > 8192) Outcome.PERMANENT else {
                        val json = JSONObject(String(bytes, StandardCharsets.UTF_8))
                        if (AckPolicy.validConfirmation(id, json.getString("alert_id"),
                                json.getString("status"), json.getString("acknowledged_at"))) {
                            Outcome.CONFIRMED
                        } else Outcome.PERMANENT
                    }
                }
                429 -> Outcome.RETRY
                in 500..599 -> Outcome.RETRY
                else -> Outcome.PERMANENT // Includes redirects; never follow a capability URL.
            }
        } catch (_: IOException) {
            Outcome.RETRY
        } catch (_: Exception) {
            Outcome.PERMANENT
        } finally {
            connection?.disconnect()
        }
    }
}
