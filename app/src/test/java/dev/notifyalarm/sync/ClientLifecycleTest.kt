package dev.notifyalarm.sync

import android.content.Context
import dev.notifyalarm.R
import dev.notifyalarm.core.AlarmEngine
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.xmlpull.v1.XmlPullParser
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
class ClientLifecycleTest {
    @Test fun stalledNetworkDoesNotHoldUiStateLockAndCancelInvalidatesLogin() {
        val context: Context = RuntimeEnvironment.getApplication()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val thread = Thread { ClientRegistration.serializedNetwork {
            entered.countDown()
            release.await(3, TimeUnit.SECONDS)
        } }
        val ticket = ClientAccount.loginTicket(context)!!
        AlarmEngine.acknowledgeAll(context) // Warm local notification/work state before timing contention.
        thread.start()
        assertTrue(entered.await(1, TimeUnit.SECONDS))
        try {
            val start = System.nanoTime()
            assertNotNull(ClientRegistration.status(context))
            AlarmEngine.acknowledgeAll(context)
            assertTrue(ClientAccount.cancelLogin(context))
            assertFalse(ClientAccount.ticketCurrent(context, ticket))
            assertTrue("account status and local controls cannot wait for HTTP",
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000)
        } finally { release.countDown(); thread.join(3000) }
    }

    @Test fun backupExcludesSecretBearingDomainsInBothTransportSections() {
        val context: Context = RuntimeEnvironment.getApplication()
        val parser = context.resources.getXml(R.xml.data_extraction_rules)
        val sections = mutableMapOf<String, MutableSet<String>>()
        var section = ""
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType == XmlPullParser.START_TAG) {
                when (parser.name) {
                    "cloud-backup", "device-transfer" -> section = parser.name
                    "exclude" -> sections.getOrPut(section) { mutableSetOf() }
                        .add(parser.getAttributeValue(null, "domain") + ":" +
                            parser.getAttributeValue(null, "path"))
                }
            }
            parser.next()
        }
        val domains = setOf("root", "file", "database", "sharedpref", "external",
            "device_root", "device_file", "device_database", "device_sharedpref")
        for (sectionName in listOf("cloud-backup", "device-transfer"))
            assertTrue(sectionName, sections[sectionName]!!.containsAll(domains.map { "$it:." }))
    }

    @Test fun boundedRetryCooldownSurvivesFreshReadsAndDoesNotApplyToNextGeneration() {
        val context: Context = RuntimeEnvironment.getApplication()
        val ticket = ClientAccount.loginTicket(context)!!
        val start = System.currentTimeMillis()
        assertTrue(ClientAccount.postpone(context, ticket.generation, 500, start))
        assertEquals(500000L, ClientAccount.retryDelay(context, ticket.generation, start))
        assertTrue(ClientAccount.retryDelay(context, ticket.generation, start + 30000) > 30000L)
        assertTrue(ClientAccount.cancelLogin(context))
        assertEquals(0L, ClientAccount.retryDelay(context, ticket.generation + 1, start))
    }

    @Test fun queuedDuplicateLoginsCannotInvalidatePersistedServerBearer() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        var generation = 7
        var serverBearer = ""
        var savedBearer = ""
        fun request() = Thread {
            ClientRegistration.mutateIfCurrent({ generation == 7 }) {
                val token = "server-${calls.incrementAndGet()}"
                serverBearer = token // Fake server invalidates every previous login for this installation.
                entered.countDown()
                release.await(3, TimeUnit.SECONDS)
                if (generation == 7) { savedBearer = token; generation++ }
            }
        }
        val first = request()
        first.start()
        assertTrue(entered.await(1, TimeUnit.SECONDS))
        val second = request()
        second.start()
        release.countDown()
        first.join(3000); second.join(3000)
        assertEquals(1, calls.get())
        assertEquals(serverBearer, savedBearer)
    }

    @Test fun passwordRotationRegistrationAndRecoveryShareOneMutationQueue() {
        var generation = 1
        var bearer = "initial"
        val operations = mutableListOf<String>()
        ClientRegistration.serializedNetwork { operations += "registration:$bearer" }
        ClientRegistration.mutateIfCurrent({ generation == 1 }) {
            bearer = "password-rotated"; generation++; operations += "password"
        }
        ClientRegistration.mutateIfCurrent({ generation == 1 }) { operations += "stale-password" }
        ClientRegistration.mutateIfCurrent({ generation == 2 }) {
            operations += "registration:$bearer"
        }
        ClientRegistration.mutateIfCurrent({ generation == 2 }) {
            bearer = "recovery-token"; generation++; operations += "recovery"
        }
        ClientRegistration.mutateIfCurrent({ generation == 2 }) { operations += "stale-recovery" }
        assertEquals(listOf("registration:initial", "password", "registration:password-rotated", "recovery"),
            operations)
    }

    @Test fun retryAfter503BlocksAllTriggerTypesUntilDeadline() {
        val context: Context = RuntimeEnvironment.getApplication()
        val ticket = ClientAccount.loginTicket(context)!!
        val now = System.currentTimeMillis()
        assertTrue(ClientRegistration.shouldThrottle(ClientApi.Reply(503, org.json.JSONObject(), 600)))
        assertFalse(ClientRegistration.shouldThrottle(ClientApi.Reply(503, org.json.JSONObject(), 0)))
        assertTrue(ClientAccount.postpone(context, ticket.generation, 600, now))
        val calls = AtomicInteger()
        for (trigger in listOf("manual", "new-token", "periodic")) {
            assertNull(trigger, ClientRegistration.attemptAfterCooldown(context, ticket.generation, now + 30000) {
                calls.incrementAndGet()
            })
        }
        assertEquals(0, calls.get())
        assertEquals(1, ClientRegistration.attemptAfterCooldown(context, ticket.generation, now + 600001) {
            calls.incrementAndGet()
        })
        assertEquals(1, calls.get())
        assertTrue(ClientAccount.postpone(context, ticket.generation, 5000, now))
        assertEquals(3600000L, ClientAccount.retryDelay(context, ticket.generation, now))
    }
}
