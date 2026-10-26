plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.notifyalarm"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.notifyalarm"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.6.0-safety-poc"
        testInstrumentationRunner = "dev.notifyalarm.AlarmInstrumentation"
    }
    signingConfigs {
        getByName("debug") {
            // Only CI sets this path. Local debug builds retain Android's usual keystore.
            System.getenv("NOTIFY_CI_DEBUG_KEYSTORE")?.takeIf { it.isNotBlank() }?.let { path ->
                storeFile = file(path)
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.13.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.work:work-runtime:2.10.1")
    implementation("androidx.core:core:1.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}

// The pure JVM tests are tiny; avoid Gradle's default 512 MiB worker allocation
// competing with the Android emulator and the user's other applications.
tasks.withType<Test>().configureEach {
    minHeapSize = "32m"
    maxHeapSize = "128m"
    maxParallelForks = 1
}

// Firebase is optional for the local alarm PoC. No credentials are generated or
// embedded here. Configure Firebase explicitly before claiming remote readiness.
