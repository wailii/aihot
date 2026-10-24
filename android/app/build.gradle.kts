import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.xiaodeng.aihot"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.xiaodeng.aihot"
        minSdk = 30
        targetSdk = 36
        versionCode = 16
        versionName = "0.7.3"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
