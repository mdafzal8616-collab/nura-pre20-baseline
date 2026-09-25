plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.nura.claude"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.nura.claude"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The website (../index.html, css, js, assets) is copied in at build time
    // so the APK always ships exactly what is in the repo root.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/site"))
}

val copySite by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile) {
        include("index.html", "css/**", "js/**", "assets/**")
    }
    into(layout.buildDirectory.dir("generated/site/www"))
}
tasks.named("preBuild") { dependsOn(copySite) }

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.webkit:webkit:1.10.0")
}
