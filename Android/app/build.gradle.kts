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
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The web app is built from ../../web and bundled as an asset.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web-assets"))
}

// Builds the single-file web app (skip with -PskipWebBuild to reuse web/dist as is).
val buildWeb by tasks.registering(Exec::class) {
    workingDir = rootProject.file("../web")
    commandLine("npm", "run", "build")
    onlyIf { !project.hasProperty("skipWebBuild") }
}

val copyWebApp by tasks.registering(Copy::class) {
    dependsOn(buildWeb)
    from(rootProject.file("../web/dist/index.html"))
    into(layout.buildDirectory.dir("generated/web-assets"))
}

tasks.named("preBuild") { dependsOn(copyWebApp) }
