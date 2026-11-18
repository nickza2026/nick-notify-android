package dev.notifyalarm.sync

import android.view.View
import android.view.ViewGroup
import android.graphics.Rect
import android.widget.EditText
import android.widget.Button
import android.widget.TextView
import dev.notifyalarm.MainActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ClientOnboardingTest {
    @Before fun fakePublicDiscovery() {
        MainActivity.authLookup = { ClientApi.AuthConfig("password", null) }
        MainActivity.authExecutor = Executor { it.run() }
    }
    @After fun restoreDiscovery() { MainActivity.resetAuthDiscovery() }
    private fun <T> field(activity: MainActivity, name: String): T {
        val field = MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST") return field.get(activity) as T
    }

    private fun visible(view: View): Boolean {
        var current: View? = view
        while (current != null) {
            if (current.visibility != View.VISIBLE) return false
            current = current.parent as? View
        }
        return true
    }

    @Test fun freshInstallAlreadyKnowsItsServiceAndDeviceName() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            assertEquals("https://notify-alarm-api-7496986423345747739.olufy-0.nortezh.com",
                field<EditText>(activity, "serverInput").text.toString())
            assertTrue(ClientPolicy.deviceName(field<EditText>(activity, "deviceInput").text.toString()))
        } finally { controller.destroy() }
    }

    @Test fun googleEntryNeverDisappearsWhileServiceConfigurationIsPending() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            assertEquals(View.VISIBLE, field<Button>(controller.get(), "googleLoginButton").visibility)
        } finally { controller.destroy() }
    }

    @Test fun ordinarySetupDoesNotDemandManualServiceAccountOrDeviceFields() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            for (name in listOf("serverInput", "userInput", "passwordInput", "deviceInput")) {
                assertFalse("$name belongs in optional advanced settings", visible(field<View>(activity, name)))
            }
        } finally { controller.destroy() }
    }

    @Test fun serviceDiscoveryRunsWithoutAnyOperatorButtonPress() {
        val seen = mutableListOf<String>()
        MainActivity.authLookup = { seen.add(it); ClientApi.AuthConfig("google", "synthetic-project") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            assertEquals(listOf(ClientOnboarding.DEFAULT_BASE), seen)
            assertTrue(field<Button>(controller.get(), "googleLoginButton").isEnabled)
        } finally { controller.destroy() }
    }

    @Test fun passwordServiceIsExplainedWithoutPretendingGoogleIsReady() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            assertFalse(field<Button>(controller.get(), "googleLoginButton").isEnabled)
            assertTrue(field<TextView>(controller.get(), "accountMessage").text.contains("ยังไม่เปิด Google"))
        } finally { controller.destroy() }
    }

    @Test fun networkFailureRetainsVisibleDisabledGoogleEntryAndRetryExplanation() {
        MainActivity.authLookup = { throw java.io.IOException("synthetic offline") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            assertEquals(View.VISIBLE, field<Button>(activity, "googleLoginButton").visibility)
            assertFalse(field<Button>(activity, "googleLoginButton").isEnabled)
            assertTrue(field<TextView>(activity, "accountMessage").text.contains("เชื่อมต่อบริการไม่ได้"))
        } finally { controller.destroy() }
    }

    @Test fun outOfOrderDiscoveryCannotRestoreAnOldServiceOrMode() {
        val pending = mutableListOf<Runnable>()
        MainActivity.authExecutor = Executor { pending.add(it) }
        MainActivity.authLookup = { base -> if (base == ClientOnboarding.DEFAULT_BASE)
            ClientApi.AuthConfig("password", null) else ClientApi.AuthConfig("google", "synthetic-project") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            field<EditText>(activity, "serverInput").setText("https://other.synthetic.invalid")
            MainActivity::class.java.getDeclaredMethod("refreshAuthConfig").apply { isAccessible = true }.invoke(activity)
            assertEquals(2, pending.size)
            pending[1].run()
            pending[0].run()
            assertEquals("https://other.synthetic.invalid", field<String>(activity, "authConfigBase"))
            assertTrue(field<Button>(activity, "googleLoginButton").isEnabled)
        } finally { controller.destroy() }
    }

    @Test fun existingServiceAndCustomNameArePreservedAndGeneratedNameIsBounded() {
        assertEquals("https://old.synthetic.invalid", ClientOnboarding.initialBase("https://old.synthetic.invalid"))
        assertEquals("My own phone", ClientOnboarding.initialName("My own phone", "Google", "Pixel"))
        assertEquals("Google Pixel", ClientOnboarding.initialName(null, "Google", "Google Pixel"))
        assertEquals("Android", ClientOnboarding.initialName(null, "", ""))
        assertTrue(ClientPolicy.deviceName(ClientOnboarding.initialName(null, "Google", "🙂".repeat(100))))
    }

    @Test fun refreshDuringGoogleConsentCannotCancelTheInFlightLogin() {
        var lookups = 0
        MainActivity.authLookup = { lookups++; ClientApi.AuthConfig("google", "synthetic-project") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            field<AtomicBoolean>(activity, "googleBusy").set(true)
            val before = field<AtomicLong>(activity, "authEpoch").get()
            MainActivity::class.java.getDeclaredMethod("refreshAuthConfig").apply { isAccessible = true }.invoke(activity)
            assertEquals(1, lookups)
            assertEquals(before, field<AtomicLong>(activity, "authEpoch").get())
        } finally { controller.destroy() }
    }

    @Test fun cancellingWhileDiscoveryIsPendingStillAllowsRetry() {
        val pending = mutableListOf<Runnable>()
        MainActivity.authExecutor = Executor { pending.add(it) }
        MainActivity.authLookup = { ClientApi.AuthConfig("google", "synthetic-project") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            val activity = controller.get()
            fun buttons(view: View): List<Button> = when (view) {
                is Button -> listOf(view)
                is ViewGroup -> (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) }
                else -> emptyList()
            }
            buttons(activity.findViewById(android.R.id.content)).single {
                it.text.toString().startsWith("ออกจากระบบ (")
            }.performClick()
            MainActivity::class.java.getDeclaredMethod("refreshAuthConfig").apply { isAccessible = true }.invoke(activity)
            assertEquals(2, pending.size)
            pending[1].run()
            pending[0].run()
            assertTrue(field<Button>(activity, "googleLoginButton").isEnabled)
        } finally { controller.destroy() }
    }

    @Test fun googleEntryFitsInitialPortraitViewportWithoutScrolling() {
        MainActivity.authLookup = { ClientApi.AuthConfig("google", "synthetic-project") }
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume().visible()
        try {
            val activity = controller.get()
            val decor = activity.window.decorView
            val density = activity.resources.displayMetrics.density
            fun buttons(view: View): List<Button> = when (view) {
                is Button -> listOf(view)
                is ViewGroup -> (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) }
                else -> emptyList()
            }
            val ack = buttons(decor).single { it.text == "รับทราบทั้งหมด / หยุดเสียง" }
            for ((width, height) in listOf(411 to 891, 360 to 800)) {
                decor.measure(View.MeasureSpec.makeMeasureSpec((width * density).toInt(), View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec((height * density).toInt(), View.MeasureSpec.EXACTLY))
                decor.layout(0, 0, decor.measuredWidth, decor.measuredHeight)
                for (button in listOf(field<Button>(activity, "googleLoginButton"), ack)) {
                    val visible = Rect()
                    assertTrue("${button.text} must fit initial ${width}x$height viewport", button.getGlobalVisibleRect(visible))
                    val position = IntArray(2).also { button.getLocationOnScreen(it) }
                    assertEquals("${button.text} must fit ${width}x$height; location=${position.toList()}, rect=$visible, density=$density",
                        button.height, visible.height())
                }
            }
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun revokedSessionDoesNotForgetServiceOrDeviceName() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        context.getSharedPreferences("client_account_v1", android.content.Context.MODE_PRIVATE).edit()
            .putString("base", "https://previous.synthetic.invalid")
            .putString("name", "My previous phone")
            .putString("bearer", "synthetic encrypted bearer")
            .putLong("generation", 0).commit()
        ClientAccount.requireLogin(context, 0)
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        try {
            assertEquals("https://previous.synthetic.invalid", field<EditText>(controller.get(), "serverInput").text.toString())
            assertEquals("My previous phone", field<EditText>(controller.get(), "deviceInput").text.toString())
            assertNull(ClientAccount.session(context))
        } finally { controller.destroy() }
    }
}
