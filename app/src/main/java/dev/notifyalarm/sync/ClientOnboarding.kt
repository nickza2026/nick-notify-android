package dev.notifyalarm.sync

/** Public service address, never an application key, identity allowlist or bearer. */
object ClientOnboarding {
    const val DEFAULT_BASE = "https://notify-alarm-api-7496986423345747739.olufy-0.nortezh.com"

    fun initialBase(existing: String?): String =
        existing?.let { ClientPolicy.baseUrl(it) } ?: DEFAULT_BASE

    fun initialName(existing: String?, manufacturer: String, model: String): String {
        if (existing != null && ClientPolicy.deviceName(existing)) return existing
        val make = manufacturer.trim()
        val device = model.trim()
        val label = when {
            device.startsWith(make, ignoreCase = true) && device.isNotBlank() -> device
            else -> "$make $device".trim()
        }.ifBlank { "Android" }
        val points = label.codePoints().limit(80).toArray()
        return String(points, 0, points.size)
    }
}
