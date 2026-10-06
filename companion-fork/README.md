# Companion

An English-first, local-first companion prototype with an optional KoboldCpp Character Card V2 export.

The Android app installs as **Companion Fork** (`com.stvedgar.companionf`), separately from the original Companion app.

## Run the preview

Opening `index.html` directly (`file://`) is not supported because browsers restrict ES module imports and origin-bound local storage on file URLs. If opened directly, the page shows these instructions instead of a blank screen.

On Linux, open a terminal in this project folder and run:

```sh
./start-preview.sh
```

The launcher starts a local-only web server and opens the preview in your browser. It chooses an available port between 4173 and 4189 once, then remembers it so your browser keeps using the same local storage. Keep the terminal open until you finish testing; press `Ctrl+C` to stop it.

Create and save a companion to add it to the catalog. Open **Connection settings**, enter your KoboldCpp base URL (for example `http://100.x.x.x:5001`), choose **Test connection**, and save. Then open the companion and send a message. The Android app uses Capacitor's native HTTP bridge for the HTTP address you configure, including Tailscale endpoints; the browser preview can still be subject to browser CORS and mixed-content rules.

## Android / APK builds

The `build:web` script stages only the app's HTML, CSS, and JavaScript into the Capacitor web directory. Then `npx cap add android` creates the Android project and `npm run android:sync` refreshes the packaged app assets.

GitHub Actions builds a debug APK on `main` pushes or manual runs. Download it from that workflow run's **Artifacts** section. Pushing a `v*` tag also attaches the APK to a GitHub Release. These are debug builds for testing; a signed production APK needs a separately configured signing key. Do not commit signing keys or passwords.
