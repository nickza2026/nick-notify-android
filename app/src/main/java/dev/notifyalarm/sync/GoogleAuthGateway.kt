package dev.notifyalarm.sync

import android.app.Activity
import android.os.CancellationSignal
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import java.util.concurrent.Executor

/** Only invoked for a user-pressed Google button. Never retains a Google or Firebase token. */
object GoogleAuthGateway {
    internal fun projectMatches(expected: String, actual: String?): Boolean =
        expected.isNotBlank() && actual != null && actual == expected

    fun configuredProject(activity: Activity, expected: String): Boolean =
        projectMatches(expected, FirebaseApp.getApps(activity)
            .firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.options?.projectId)

    fun start(activity: Activity, expectedProject: String, active: () -> Boolean,
              callback: (String?) -> Unit) {
        if (!configuredProject(activity, expectedProject)) { callback(null); return }
        // No assumption that google-services generated this resource: an operator may provide it.
        val id = activity.resources.getIdentifier("default_web_client_id", "string", activity.packageName)
        val webClient = if (id != 0) activity.getString(id).trim() else ""
        if (webClient.isBlank()) { callback(null); return }
        val auth = try { FirebaseAuth.getInstance() } catch (_: Exception) { callback(null); return }
        val option = GetGoogleIdOption.Builder().setServerClientId(webClient)
            .setFilterByAuthorizedAccounts(false).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val main = Executor { activity.runOnUiThread(it) }
        try {
            CredentialManager.create(activity).getCredentialAsync(activity, request,
                CancellationSignal(), main, object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                    override fun onError(e: GetCredentialException) { auth.signOut(); callback(null) }

                    override fun onResult(result: GetCredentialResponse) {
                        if (!active()) { auth.signOut(); callback(null); return }
                        val credential = result.credential
                        val googleToken = try {
                            if (credential is CustomCredential &&
                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
                                GoogleIdTokenCredential.createFrom(credential.data).idToken else null
                        } catch (_: Exception) { null }
                        if (googleToken == null) { auth.signOut(); callback(null); return }
                        auth.signInWithCredential(GoogleAuthProvider.getCredential(googleToken, null))
                            .addOnCompleteListener { signIn ->
                                if (!signIn.isSuccessful) { auth.signOut(); callback(null); return@addOnCompleteListener }
                                val user = signIn.result?.user
                                if (user == null) { auth.signOut(); callback(null); return@addOnCompleteListener }
                                user.getIdToken(false).addOnCompleteListener { token ->
                                    val firebaseIdToken = if (active() && token.isSuccessful) token.result?.token else null
                                    auth.signOut()
                                    callback(firebaseIdToken)
                                }
                            }
                    }
                })
        } catch (_: Exception) { auth.signOut(); callback(null) }
    }
}
