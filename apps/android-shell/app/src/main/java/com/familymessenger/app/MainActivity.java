package com.familymessenger.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.security.SecureRandom;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int AUDIO_PERMISSION_REQUEST = 1002;
    private static final String PREFS = "family_messenger";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String PREF_AUTO_PIN = "auto_pin";

    private WebView webView;
    private LinearLayout onboarding;
    private LinearLayout topBar;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingAudioPermission;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        setContentView(createContentView());

        String savedUrl = preferences.getString(PREF_SERVER_URL, "");
        if (savedUrl == null || savedUrl.isBlank()) {
            showOnboarding();
        } else {
            showWeb();
            loadServer(savedUrl);
        }
    }

    private LinearLayout createContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244, 248, 247));

        LinearLayout bar = new LinearLayout(this);
        topBar = bar;
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(6), dp(8), dp(6));
        bar.setBackgroundColor(Color.rgb(244, 248, 247));

        TextView title = new TextView(this);
        title.setText("Family Messenger");
        title.setTextSize(17);
        title.setTextColor(Color.rgb(38, 53, 50));
        title.setGravity(Gravity.CENTER_VERTICAL);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(44), 1f));

        Button settings = new Button(this);
        settings.setText("⚙");
        settings.setTextSize(20);
        settings.setContentDescription("Настройки подключения");
        settings.setOnClickListener(v -> showConnectionMenu());
        bar.addView(settings, new LinearLayout.LayoutParams(dp(52), dp(44)));

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        onboarding = createOnboardingView();
        root.addView(onboarding, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        webView = new WebView(this);
        configureWebView();
        webView.setVisibility(View.GONE);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private LinearLayout createOnboardingView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(28), dp(32), dp(28), dp(32));

        TextView mark = new TextView(this);
        mark.setText("F");
        mark.setTextSize(34);
        mark.setTextColor(Color.WHITE);
        mark.setGravity(Gravity.CENTER);
        mark.setBackgroundColor(Color.rgb(53, 127, 112));
        box.addView(mark, new LinearLayout.LayoutParams(dp(76), dp(76)));

        TextView heading = new TextView(this);
        heading.setText("Подключиться к семье");
        heading.setTextSize(25);
        heading.setTextColor(Color.rgb(38, 53, 50));
        heading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingParams.setMargins(0, dp(28), 0, dp(10));
        box.addView(heading, headingParams);

        TextView hint = new TextView(this);
        hint.setText("Нажмите кнопку и наведите камеру на QR-код, который показал администратор семьи.");
        hint.setTextSize(16);
        hint.setTextColor(Color.rgb(99, 120, 115));
        hint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintParams.setMargins(0, 0, 0, dp(24));
        box.addView(hint, hintParams);

        Button scan = new Button(this);
        scan.setText("Сканировать QR-код");
        scan.setTextSize(18);
        scan.setTextColor(Color.WHITE);
        scan.setBackgroundColor(Color.rgb(53, 127, 112));
        scan.setOnClickListener(v -> scanFamilyQr());
        box.addView(scan, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        TextView manual = new TextView(this);
        manual.setText("Если камера не сработала — открыть ручную настройку");
        manual.setTextSize(13);
        manual.setTextColor(Color.rgb(82, 117, 108));
        manual.setGravity(Gravity.CENTER);
        manual.setPadding(0, dp(22), 0, dp(8));
        manual.setOnClickListener(v -> showServerDialog(false));
        box.addView(manual, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        return box;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new NativeBridge(), "FamilyMessengerNative");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri current = Uri.parse(preferences.getString(PREF_SERVER_URL, ""));
                if (current.getHost() != null && current.getHost().equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean asksForAudio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            asksForAudio = true;
                            break;
                        }
                    }
                    if (!asksForAudio) {
                        request.deny();
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingAudioPermission = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                try {
                    Intent chooser = fileChooserParams.createIntent();
                    chooser.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
    }

    private void scanFamilyQr() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAutoZoom()
                .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        scanner.startScan()
                .addOnSuccessListener(barcode -> handleScannedQr(barcode.getRawValue()))
                .addOnCanceledListener(() -> Toast.makeText(this, "Сканирование отменено", Toast.LENGTH_SHORT).show())
                .addOnFailureListener(error -> {
                    Toast.makeText(this, "Не удалось открыть сканер QR", Toast.LENGTH_LONG).show();
                    showServerDialog(false);
                });
    }

    private void handleScannedQr(String rawValue) {
        Uri uri;
        try {
            uri = Uri.parse(rawValue == null ? "" : rawValue.trim());
        } catch (Exception error) {
            showInvalidQr();
            return;
        }

        String scheme = uri.getScheme();
        String host = uri.getHost();
        String fragment = uri.getFragment();
        boolean validRoute = fragment != null &&
                (fragment.startsWith("/join?token=") || fragment.startsWith("/device?token="));

        if (!"https".equalsIgnoreCase(scheme) || host == null || !validRoute) {
            showInvalidQr();
            return;
        }

        Uri origin = new Uri.Builder()
                .scheme("https")
                .encodedAuthority(uri.getEncodedAuthority())
                .build();
        String serverUrl = origin.toString();

        preferences.edit().putString(PREF_SERVER_URL, serverUrl).apply();
        showWeb();
        webView.loadUrl(uri.toString());
    }

    private void showInvalidQr() {
        new AlertDialog.Builder(this)
                .setTitle("Это не QR Family Messenger")
                .setMessage("Попросите администратора открыть «Пригласить нового участника» и отсканируйте QR-код из приложения.")
                .setPositiveButton("Сканировать ещё раз", (d, which) -> scanFamilyQr())
                .setNegativeButton("Закрыть", null)
                .show();
    }

    private void showConnectionMenu() {
        String saved = preferences.getString(PREF_SERVER_URL, "");
        String[] items = saved == null || saved.isBlank()
                ? new String[]{"Сканировать QR-код", "Ручная настройка"}
                : new String[]{"Сканировать новый QR-код", "Открыть Family Messenger", "Ручная настройка"};
        new AlertDialog.Builder(this)
                .setTitle("Подключение")
                .setItems(items, (dialog, which) -> {
                    if (which == 0) {
                        scanFamilyQr();
                    } else if (saved != null && !saved.isBlank() && which == 1) {
                        showWeb();
                        loadServer(saved);
                    } else {
                        showServerDialog(false);
                    }
                })
                .show();
    }

    private void showServerDialog(boolean required) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("https://chat.example.com");
        input.setText(preferences.getString(PREF_SERVER_URL, ""));
        input.setSelection(input.getText().length());

        int pad = dp(20);
        LinearLayout holder = new LinearLayout(this);
        holder.setPadding(pad, dp(4), pad, 0);
        holder.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Ручная настройка")
                .setMessage("Используйте её только если QR-сканирование недоступно.")
                .setView(holder)
                .setCancelable(!required)
                .setNegativeButton(required ? "Закрыть" : "Отмена", (d, which) -> {
                    if (required) finish();
                })
                .setPositiveButton("Подключиться", null)
                .create();

        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String normalized = normalizeServerUrl(input.getText().toString());
            if (normalized == null) {
                input.setError("Нужен корректный HTTPS-адрес");
                return;
            }
            preferences.edit().putString(PREF_SERVER_URL, normalized).apply();
            dialog.dismiss();
            showWeb();
            loadServer(normalized);
        }));
        dialog.show();
    }

    private String normalizeServerUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        try {
            Uri uri = Uri.parse(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return null;
            return uri.toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void showOnboarding() {
        if (topBar != null) topBar.setVisibility(View.VISIBLE);
        onboarding.setVisibility(View.VISIBLE);
        webView.setVisibility(View.GONE);
    }

    private void showWeb() {
        if (topBar != null) topBar.setVisibility(View.GONE);
        onboarding.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void loadServer(String serverUrl) {
        showWeb();
        webView.loadUrl(serverUrl + "/");
    }

    @Override
    @Deprecated
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERMISSION_REQUEST && pendingAudioPermission != null) {
            PermissionRequest request = pendingAudioPermission;
            pendingAudioPermission = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
                Toast.makeText(this, "Для голосовых сообщений нужен доступ к микрофону", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
        } else if (webView != null && webView.getVisibility() == View.VISIBLE &&
                (preferences.getString(PREF_SERVER_URL, "") == null || preferences.getString(PREF_SERVER_URL, "").isBlank())) {
            showOnboarding();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = null;
        if (pendingAudioPermission != null) pendingAudioPermission.deny();
        pendingAudioPermission = null;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private String getOrCreateAutoPin() {
        String existing = preferences.getString(PREF_AUTO_PIN, "");
        if (existing != null && existing.matches("\\d{18,}")) return existing;
        SecureRandom random = new SecureRandom();
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < 24; i++) value.append(random.nextInt(10));
        String generated = value.toString();
        preferences.edit().putString(PREF_AUTO_PIN, generated).apply();
        return generated;
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String getAutoPin() {
            return getOrCreateAutoPin();
        }

        @JavascriptInterface
        public String getDeviceName() {
            String model = Build.MODEL == null ? "" : Build.MODEL.trim();
            return model.isEmpty() ? "Android телефон" : model;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
