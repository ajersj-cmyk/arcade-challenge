# The JS bridge is called by name from the page.
-keepclassmembers class com.ahlersarcade.tvapp.ArcadeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
