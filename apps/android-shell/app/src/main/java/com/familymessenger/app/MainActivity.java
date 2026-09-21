package com.familymessenger.app;

import android.app.AlertDialog;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
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

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String PREFS = "family_messenger";
    private static final String PREF_SERVER_URL = "server_url";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        setContentView(createContentView());

        String savedUrl = preferences.getString(PREF_SERVER_URL, "");
        if (savedUrl == null || savedUrl.isBlank()) {
            showServerDialog(true);
        } else {
            loadServer(savedUrl);
        }
    }

    private LinearLayout createContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244, 248, 247));

        LinearLayout bar = new LinearLayout(this);
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
        settings.setContentDescription("Сменить адрес сервера");
        settings.setOnClickListener(v -> showServerDialog(false));
        bar.addView(settings, new LinearLayout.LayoutParams(dp(52), dp(44)));

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        configureWebView();
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
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
                    Toast.makeText(MainActivity.this, "На устройстве нет приложения для выбора файла", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
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
                .setTitle("Адрес Family Messenger")
                .setMessage("Введите HTTPS-адрес вашего сервера. Он сохранится только на этом устройстве.")
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

    private void loadServer(String serverUrl) {
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
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = null;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
