plugins {
    id("com.android.application")
}

android {
    namespace = "com.stratego.game"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.stratego.game"
        minSdk = 26
        targetSdk = 35
        versionCode = 20000
        versionName = "2.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The web app is built from ../../web and bundled as an asset.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web-assets"))
}

// Builds the pages the app bundles (skip with -PskipWebBuild to reuse existing builds):
//   index.html     single-player game               (single/web/dist)
//   client.html    multiplayer client other devices load from the host phone  (server/public)
//   lan-host.html  the host page: game server + client, runs in the app's WebView (server/dist-android)
val buildPages by tasks.registering(Exec::class) {
    workingDir = rootProject.file("..")
    commandLine("sh", "-c", "(cd web && npm run build) && (cd ../server && npm run build && npm run build:android)")
    onlyIf { !project.hasProperty("skipWebBuild") }
}

val copyPages by tasks.registering(Copy::class) {
    dependsOn(buildPages)
    from(rootProject.file("../web/dist/index.html"))
    from(rootProject.file("../../server/dist-android/lan-host.html"))
    from(rootProject.file("../../server/public/index.html")) { rename { "client.html" } }
    into(layout.buildDirectory.dir("generated/web-assets"))
}

tasks.named("preBuild") { dependsOn(copyPages) }

dependencies {
    testImplementation("junit:junit:4.13.2")
}
