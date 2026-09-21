# Family Messenger for Android

The Android app is a small HTTPS WebView shell around the same Family Messenger PWA used on iPhone and desktop. The messenger logic, E2EE keys, messages, QR enrollment, and encrypted attachments remain in the web application.

## First launch

If no default server URL was embedded at build time, the app asks for the Family Messenger HTTPS address once and stores it locally. Only HTTPS URLs are accepted.

## Build locally

Requirements:

- JDK 17
- Android SDK platform 35
- Android build-tools 35.0.0
- Gradle 8.11.1

From the repository root:

    gradle -p android :app:assembleDebug

To embed the server URL:

    gradle -p android :app:assembleDebug -PfamilyMessengerUrl="https://your-family-server.example"

Output:

    android/app/build/outputs/apk/debug/app-debug.apk

## GitHub Actions

The `Android APK` workflow builds `FamilyMessenger-debug.apk` and a SHA-256 checksum. If repository variable `FAMILY_MESSENGER_URL` is set, that HTTPS address is embedded as the default. A manual workflow run may also provide `start_url`.

The APK keeps cookies enabled for the authenticated Family Messenger session, supports the system photo/video/file chooser, and blocks cleartext HTTP server configuration.
