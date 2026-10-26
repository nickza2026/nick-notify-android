package dev.notifyalarm.sync

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Persistent recovery for a process death between the outbox commit and immediate enqueue. */
class AckReconcileWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result = try {
        AckSync.reconcile(applicationContext)
        Result.success()
    } catch (_: Exception) { Result.retry() }
}
