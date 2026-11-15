package dev.notifyalarm.updates

/** A completed background verification never authorizes handoff after pause, even after resume. */
internal class UpdateLifecycle {
    private var epoch = 0L
    private var foreground = false

    fun resume() { foreground = true }
    fun pause() { foreground = false; epoch++ }
    fun ticket(): Long = epoch
    fun accepts(ticket: Long): Boolean = foreground && ticket == epoch
}
