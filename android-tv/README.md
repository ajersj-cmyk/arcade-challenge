# Ahlers Arcade for Android TV

Sideload this APK on Google TV / Fire TV. The scoreboard still lives at
https://ajersj-cmyk.github.io/arcade-challenge/

Videos (mp4 / HLS) play in a native ExoPlayer screen. YouTube links open the YouTube TV app instead of the glitchy in-page player.

## Put this on GitHub

1. Upload the whole `android-tv` folder and `.github/workflows/android-tv.yml` into the same repo as `index.html`.
2. GitHub → Actions → **Build Android TV APK** → Run workflow.
3. When it finishes, open the run → Artifacts → download `AhlersArcade-TV`.
4. Copy the APK to the TV (USB, Google Drive, or Downloader app) and install. Allow unknown sources.

## Play a clip from the site later

From JavaScript on the page:

```js
if (window.ArcadeTV) ArcadeTV.playVideo('https://example.com/highlight.mp4');
```
