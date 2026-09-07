package com.ahlersarcade.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.userAgentString = s.userAgentString + " AhlersArcadeTV/1.0"

        web.webChromeClient = WebChromeClient()
        web.addJavascriptInterface(ArcadeBridge(), "ArcadeTV")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return handleUrl(request.url.toString())
            }
        }
        web.loadUrl(getString(R.string.site_url))
    }

    private fun handleUrl(url: String): Boolean {
        val lower = url.lowercase()
        if (lower.contains("youtube.com") || lower.contains("youtu.be")) {
            openYoutube(url)
            return true
        }
        if (lower.endsWith(".mp4") || lower.endsWith(".m3u8") || lower.contains(".m3u8")) {
            startActivity(Intent(this, PlayerActivity::class.java).putExtra("url", url))
            return true
        }
        return false
    }

    private fun openYoutube(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: Exception) {
            web.loadUrl(url)
        }
    }

    inner class ArcadeBridge {
        @JavascriptInterface
        fun playVideo(url: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java).putExtra("url", url))
            }
        }

        @JavascriptInterface
        fun playYouTube(url: String) {
            runOnUiThread { openYoutube(url) }
        }
    }

    override fun onBackPressed() {
        if (this::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
