# Family Messenger Phase 3C Android APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a real installable Android APK that hosts the same Family Messenger web/PWA application securely, preserves its IndexedDB/E2E state, supports media/file selection, behaves like a normal Android app, and is built automatically as a CI artifact.

**Architecture:** Android is a thin trusted WebView shell around the deployed HTTPS Family Messenger origin. The shell does not reimplement chat, crypto, storage, permissions or media protocol: all product logic remains in the shared web application. Native code is responsible only for trusted-origin navigation, file/camera chooser bridging, Android back behavior, external-link handoff, secure WebView settings and APK packaging. The deployed origin is supplied at build time and must be HTTPS.

**Tech Stack:** Android Gradle Plugin 8.7.3, Gradle 8.9, Kotlin 2.0.21, JDK 17, compileSdk/targetSdk 35, minSdk 26, AndroidX Activity/AppCompat, Android WebView, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-16-family-messenger-phase3-design.md`

## Global Constraints

- Stable application id: `com.zialex.familymessenger`.
- The APK must load only the build-configured HTTPS Family Messenger origin as an in-app trusted origin.
- Cleartext HTTP is disabled.
- Same-origin Family Messenger navigation stays inside the app; unrelated external http/https URLs open through the Android browser chooser.
- JavaScript and DOM storage are enabled because the PWA requires them; mixed content is blocked.
- IndexedDB/localStorage/WebView cookies persist in the app sandbox across ordinary restarts.
- File/media chooser must support gallery, camera and general files without changing the shared web protocol.
- Android shell must never receive or log plaintext message bodies, PINs, private keys, conversation keys or recovery material.
- The debug/test-signed APK is the Phase 3 acceptance artifact. Production signing material is never committed to Git.
- CI must fail if no HTTPS `appUrl` is supplied for an APK intended for testing.

---

### Task 1: Android project skeleton and build-time HTTPS URL policy

**Files:**
- Create: `apps/android/settings.gradle.kts`
- Create: `apps/android/build.gradle.kts`
- Create: `apps/android/gradle.properties`
- Create: `apps/android/app/build.gradle.kts`
- Create: `apps/android/app/proguard-rules.pro`
- Create: `apps/android/app/src/main/AndroidManifest.xml`
- Create: `apps/android/app/src/main/res/xml/network_security_config.xml`
- Create: `apps/android/app/src/main/res/values/strings.xml`
- Create: `apps/android/app/src/main/res/values/themes.xml`
- Create: `apps/android/app/src/main/res/values-night/themes.xml`
- Create: `apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml`
- Create: `apps/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `apps/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Create: `apps/android/gradlew`
- Create: `apps/android/gradlew.bat`
- Create: `apps/android/gradle/wrapper/gradle-wrapper.properties`
- Create: `apps/android/gradle/wrapper/gradle-wrapper.jar`
- Create: `apps/android/app/src/main/java/com/zialex/familymessenger/AppUrlPolicy.kt`
- Create: `apps/android/app/src/test/java/com/zialex/familymessenger/AppUrlPolicyTest.kt`
- Modify: `.gitignore`

**Interfaces:**
- Gradle property `appUrl` becomes `BuildConfig.FAMILY_MESSENGER_URL`.
- `AppUrlPolicy.parse(raw:String): URI` accepts only absolute `https://` URL with non-empty host and no user-info.
- `AppUrlPolicy.isTrusted(uri:URI, trusted:URI):Boolean` compares scheme, normalized host and effective port.

- [ ] **Step 1: Write failing URL policy unit tests**

```kotlin
class AppUrlPolicyTest {
  @Test fun acceptsHttpsOrigin() {
    assertEquals("https", AppUrlPolicy.parse("https://family.example").scheme)
  }

  @Test fun rejectsCleartextAndJavascriptUrls() {
    assertFails { AppUrlPolicy.parse("http://family.example") }
    assertFails { AppUrlPolicy.parse("javascript:alert(1)") }
  }

  @Test fun comparesOnlyConfiguredOriginAsTrusted() {
    val trusted=AppUrlPolicy.parse("https://family.example")
    assertTrue(AppUrlPolicy.isTrusted(URI("https://family.example/chat"),trusted))
    assertFalse(AppUrlPolicy.isTrusted(URI("https://example.org"),trusted))
  }
}
```

- [ ] **Step 2: Run RED**

```bash
cd apps/android
./gradlew testDebugUnitTest -PappUrl=https://family.example
```

Expected: FAIL because Android project/policy does not exist.

- [ ] **Step 3: Create Gradle project and URL validation**

`app/build.gradle.kts` must validate `providers.gradleProperty("appUrl")` during configuration:

```kotlin
val appUrl = providers.gradleProperty("appUrl").orNull ?: ""
require(appUrl.startsWith("https://")) { "appUrl must be an HTTPS URL" }
android.defaultConfig.buildConfigField("String","FAMILY_MESSENGER_URL","\"$appUrl\"")
```

Use:

```kotlin
namespace = "com.zialex.familymessenger"
compileSdk = 35
minSdk = 26
targetSdk = 35
versionCode = 1
versionName = "0.3.0-test"
```

Enable `buildFeatures { buildConfig = true }` and JDK 17 toolchain.

- [ ] **Step 4: Secure manifest/network config**

Manifest sets `android:usesCleartextTraffic="false"`, `android:networkSecurityConfig="@xml/network_security_config"`, no backup of WebView data for the test build (`android:allowBackup="false"`), launcher activity exported only for launcher intent. Add CAMERA permission only because camera capture is user-triggered through file chooser.

`network_security_config.xml`:

```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

- [ ] **Step 5: Run GREEN**

```bash
cd apps/android
./gradlew testDebugUnitTest -PappUrl=https://family.example
./gradlew assembleDebug -PappUrl=https://family.example
```

Expected: unit tests pass and `app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 6: Commit**

```bash
git add apps/android .gitignore
 git commit -m "feat: scaffold secure Android messenger shell"
```

---

### Task 2: Secure WebView activity and trusted navigation

**Files:**
- Create: `apps/android/app/src/main/res/layout/activity_main.xml`
- Create: `apps/android/app/src/main/java/com/zialex/familymessenger/MainActivity.kt`
- Create: `apps/android/app/src/main/java/com/zialex/familymessenger/TrustedNavigation.kt`
- Create: `apps/android/app/src/test/java/com/zialex/familymessenger/TrustedNavigationTest.kt`

**Interfaces:**
- `TrustedNavigation.actionFor(url:String,trustedOrigin:URI): NavigationAction` returns `IN_WEBVIEW`, `EXTERNAL_BROWSER`, or `BLOCK`.
- Only trusted same-origin `https` navigation is `IN_WEBVIEW`.
- Other valid `http/https` destinations are `EXTERNAL_BROWSER`.
- `javascript:`, `file:`, `content:`, malformed and unknown schemes are `BLOCK` unless initiated through the explicit file chooser bridge.

- [ ] **Step 1: Write failing navigation tests**

Cover same host, alternate port, subdomain, external HTTPS, tel/mailto (block for Phase 3 shell), javascript/file/content schemes and malformed input.

- [ ] **Step 2: Run RED**

```bash
cd apps/android
./gradlew testDebugUnitTest -PappUrl=https://family.example
```

- [ ] **Step 3: Implement MainActivity WebView settings**

Configure:

```kotlin
settings.javaScriptEnabled = true
settings.domStorageEnabled = true
settings.databaseEnabled = true
settings.allowFileAccess = false
settings.allowContentAccess = true
settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
CookieManager.getInstance().setAcceptCookie(true)
CookieManager.getInstance().setAcceptThirdPartyCookies(webView,false)
WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
```

Enable safe browsing where available. Do not add a JavaScript interface. Load exactly `BuildConfig.FAMILY_MESSENGER_URL` after URL-policy validation.

- [ ] **Step 4: Implement navigation and back behavior**

Use `WebViewClient.shouldOverrideUrlLoading`. Trusted URL stays WebView; external http(s) uses `Intent.ACTION_VIEW`; blocked URL returns true without execution. Use `OnBackPressedDispatcher`: `webView.goBack()` when possible, otherwise finish activity.

- [ ] **Step 5: Preserve normal browser error visibility**

Network/HTTP failures show a small native retry overlay or the WebView error page with a `Повторить` action; do not silently redirect to another host.

- [ ] **Step 6: Run GREEN**

```bash
cd apps/android
./gradlew testDebugUnitTest assembleDebug -PappUrl=https://family.example
```

- [ ] **Step 7: Commit**

```bash
git add apps/android/app/src
 git commit -m "feat: add trusted Android WebView navigation"
```

---

### Task 3: File, gallery and camera chooser bridge

**Files:**
- Create: `apps/android/app/src/main/java/com/zialex/familymessenger/FileChooserBridge.kt`
- Modify: `apps/android/app/src/main/java/com/zialex/familymessenger/MainActivity.kt`
- Modify: `apps/android/app/src/main/AndroidManifest.xml`
- Create: `apps/android/app/src/main/res/xml/file_paths.xml`
- Create: `apps/android/app/src/test/java/com/zialex/familymessenger/FileChooserBridgeTest.kt`

**Interfaces:**
- `FileChooserBridge.createIntent(acceptTypes:Array<String>,captureEnabled:Boolean)` returns a chooser that can select general files and, when media is requested, offers camera capture.
- `WebChromeClient.onShowFileChooser(...)` supplies returned URIs to the web `<input type=file>` callback.

- [ ] **Step 1: Write failing MIME/chooser tests**

Pure tests assert:

```text
image/*,video/* -> ACTION_GET_CONTENT with media MIME support + camera option
application/pdf -> ACTION_GET_CONTENT application/pdf
empty or */* -> ACTION_GET_CONTENT */*
multiple requested -> EXTRA_ALLOW_MULTIPLE=true when WebChromeClient mode allows it
```

- [ ] **Step 2: Run RED**

```bash
cd apps/android
./gradlew testDebugUnitTest -PappUrl=https://family.example
```

- [ ] **Step 3: Implement FileProvider + Activity Result APIs**

Use an app-cache camera output URI via `FileProvider`; never expose `file://`. Request CAMERA permission only immediately before a camera launch when needed. If permission is declined, keep gallery/file selection working.

- [ ] **Step 4: Handle result variants**

Support one URI, `ClipData` multiple URIs, camera output URI and cancellation. Always clear the outstanding `ValueCallback<Array<Uri>>` after result to avoid leaking a stale chooser callback.

- [ ] **Step 5: Run GREEN and assemble APK**

```bash
cd apps/android
./gradlew testDebugUnitTest assembleDebug -PappUrl=https://family.example
```

- [ ] **Step 6: Commit**

```bash
git add apps/android/app/src
 git commit -m "feat: bridge Android media and file selection"
```

---

### Task 4: Web/PWA behavior inside Android shell

**Files:**
- Create: `apps/web/src/platform/runtime.ts`
- Create: `apps/web/src/platform/runtime.test.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/android/app/src/main/java/com/zialex/familymessenger/MainActivity.kt`

**Interfaces:**
- Android shell appends an innocuous query marker only to initial navigation: `?platform=android-shell` while keeping same origin.
- `detectRuntime()` -> `'android-shell'|'pwa'|'browser'` based on query/display-mode; do not expose any secret native bridge.
- Android shell does not attempt to register/install the PWA service worker solely for navigation caching when native WebView is used; normal app web assets still load from deployed origin and IndexedDB persists.

- [ ] **Step 1: Write failing runtime tests**

Test Android marker, standalone PWA and normal browser. Ensure query marker never changes API origin.

- [ ] **Step 2: Implement runtime detection**

In `main.tsx`, register service worker for PWA/browser as today. Android shell may leave it registered if already present, but do not depend on service worker for native APK startup. Product behavior and crypto remain shared.

- [ ] **Step 3: Add safe-area/native-shell CSS**

Use existing `env(safe-area-inset-*)` and add `.runtime-android-shell` only for spacing/status-bar integration. Do not change approved color system.

- [ ] **Step 4: Run GREEN**

```bash
npm run test -w apps/web -- --run src/platform/runtime.test.ts
npm run build -w apps/web
cd apps/android && ./gradlew assembleDebug -PappUrl=https://family.example
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform apps/web/src/main.tsx apps/web/src/styles/app.css apps/android/app/src/main/java/com/zialex/familymessenger/MainActivity.kt
 git commit -m "feat: integrate Android shell runtime"
```

---

### Task 5: Android CI APK artifact

**Files:**
- Create: `.github/workflows/android-apk.yml`
- Modify: `README.md`

**Interfaces:**
- Workflow is `workflow_dispatch` with required string input `base_url`.
- Artifact name: `family-messenger-android-debug`.
- Output filename copied to `artifacts/FamilyMessenger-0.3.0-test.apk` before upload.

- [ ] **Step 1: Create workflow**

```yaml
name: Android APK
on:
  workflow_dispatch:
    inputs:
      base_url:
        description: HTTPS Family Messenger deployment URL
        required: true
        type: string
jobs:
  apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
      - run: chmod +x apps/android/gradlew
      - run: ./gradlew testDebugUnitTest lintDebug assembleDebug -PappUrl='${{ inputs.base_url }}'
        working-directory: apps/android
      - run: mkdir -p artifacts && cp apps/android/app/build/outputs/apk/debug/app-debug.apk artifacts/FamilyMessenger-0.3.0-test.apk
      - uses: actions/upload-artifact@v4
        with:
          name: family-messenger-android-debug
          path: artifacts/FamilyMessenger-0.3.0-test.apk
```

- [ ] **Step 2: Document local and CI build**

README must state debug APK is test-signed, not Play Store release-signed. Never document or request keystore passwords for this acceptance build.

- [ ] **Step 3: Run workflow with a temporary HTTPS URL**

Expected: unit tests, lint and assembly pass; artifact contains exactly one APK.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/android-apk.yml README.md
 git commit -m "ci: build installable Android APK artifact"
```

---

### Task 6: Emulator install/start/navigation/media smoke test

**Files:**
- Create: `apps/android/app/src/androidTest/java/com/zialex/familymessenger/LaunchSmokeTest.kt`
- Modify: `.github/workflows/android-apk.yml`
- Create: `docs/testing/android-smoke.md`

**Interfaces:**
- Instrumentation test verifies launcher activity starts and WebView exists.
- Manual/emulator checklist verifies loaded HTTPS app, local state persistence, trusted/external navigation, chooser, back navigation and theme.

- [ ] **Step 1: Add instrumentation launch test**

Use AndroidX test runner and `ActivityScenario.launch(MainActivity::class.java)`. Assert activity is resumed and the WebView view id exists. It must not assert external network content in CI.

- [ ] **Step 2: Add emulator CI smoke job**

Use a maintained Android emulator runner action on API 35, install debug APK, execute connectedDebugAndroidTest. Network content test remains manual against the Phase 3 preview because public deployment credentials/origin availability can vary.

- [ ] **Step 3: Write exact manual APK checklist**

`docs/testing/android-smoke.md`:

1. install APK;
2. launch and load the configured Phase 3 HTTPS preview;
3. sign into/join a test family;
4. close/reopen and confirm PIN-protected local identity persists;
5. choose photo from gallery;
6. choose a general file;
7. invoke camera capture and cancel/succeed;
8. open an external link and confirm it leaves to browser chooser;
9. use Android back inside chat navigation;
10. switch System/Light/Dark in the shared UI;
11. restart and confirm theme + local identity persist.

- [ ] **Step 4: Run verification**

```bash
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleDebug -PappUrl=https://family.example
```

Expected: green. Connected emulator test is green in CI.

- [ ] **Step 5: Commit**

```bash
git add apps/android/app/src/androidTest .github/workflows/android-apk.yml docs/testing/android-smoke.md
 git commit -m "test: verify Android APK launch and integration"
```

## Phase 3C Exit Gate

Phase 3C is complete only when a CI-produced debug/test-signed APK exists, Android unit/lint/instrumentation checks are green, the shell accepts only the configured HTTPS origin in-app, file/gallery/camera selection works, external navigation is safe, back behavior is normal, IndexedDB identity survives restart, and the real Phase 3 preview passes the documented Android smoke test.