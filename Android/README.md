# Stratego for Android

A thin WebView wrapper around the web app in `../web`. The build runs `npm run build` there and bundles
`web/dist/index.html` into the APK as an asset (fully offline, no INTERNET permission).

Open this folder in Android Studio, or from a shell (JDK 17 required):

    ./gradlew :app:assembleDebug          # builds web app + APK
    adb install -r app/build/outputs/apk/debug/app-debug.apk

Pass `-PskipWebBuild` to reuse the existing `web/dist/index.html` without running npm.
