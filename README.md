# HANZAI-ORIGINS

An offline app for learning to read and write Chinese characters. Start with **Characters** to explore 3,000 HSK characters, their components and stroke order, and practise writing. Use **Read** to open an EPUB or paste Chinese text, look up words, and practise characters in context.

Progress stays on your device. Settings includes profiles, backups, themes and fonts.

## Run and build

Install Node.js 22 or later (with npm). From the repository root:

```sh
npm install
npm run serve          # http://localhost:5178
npm run build          # release/web/ and release/HANZAI-ORIGINS-web.zip
npm run serve:release  # http://localhost:5179
npm run build:pages    # release/pages/ for GitHub Pages
```

You can also open `app/index.html` directly. Generated app data is committed, so a normal web build does not require downloading or rebuilding the source data.

## Project layout

- `app/`: web application, bundled fonts, icons, generated data and vendor assets.
- `tools/`: build, development, data-generation and Android helper scripts; see [tools/README.md](tools/README.md).
- `tools/lib/`: shared build utilities.
- `tools/local/`: optional local SDKs and JDKs; ignored by Git.
- `data/`: source dictionaries, HSK lists and examples. Historical grammar sources remain as inputs for reading examples.
- `themes/`: editable palettes, textures and logo assets.
- `android/`: Capacitor Android project and Gradle wrapper.
- `release/`: generated web builds and archives; ignored by Git.
- `.github/workflows/`: GitHub Pages deployment.

Package manifests and Capacitor configuration stay at the root, where their tools expect them.

## Android

Install JDK 17 and Android SDK platform 34 with build-tools 34.0.0. Set `JAVA_HOME` and `ANDROID_HOME`, or configure the SDK in `android/local.properties`.

```sh
npm run android:sync
npm run android:open
npm run android:apk
```

The debug APK is written to `android/app/build/outputs/apk/debug/`. The helper selects the Windows or Unix Gradle wrapper automatically. For a release, run `node tools/android.mjs assembleRelease` after syncing. Signing uses `android/keystore.properties`; keep signing keys private and backed up.

Keep versions aligned in `package.json`, `app/js/core.js`, and `android/app/build.gradle`; the web build checks them.

## Data and assets

```sh
npm run sources       # download dictionary sources
npm run data          # regenerate dictionary, characters and reading examples
npm run strokes       # offline stroke-order data
npm run themes
npm run icons
npm run fonts         # Python, fonttools and brotli required
npm run translation   # optional offline reader translator
```

The Pages workflow builds and publishes `release/pages/` on pushes to `main`. Each build stamps the page, scripts and service worker together to keep cached versions consistent.

Keyboard shortcuts: `1` Characters, `2` Read, `3` Settings, `?` help.

## Recovering an outdated web app

After deploying, if the browser still shows the old sidebar or a blank screen,
open `recover.html` under the site's URL and choose **Refresh app files**.
This removes this app's service worker and cached assets, then reloads the app.
It does not clear localStorage or IndexedDB, so profiles, progress and books remain.
The recovery page must be included in the deployed Pages build first.

`tools/check-pages.cjs` can check HTTP startup, worker-controlled and offline
reloads, and recovery. With Playwright configured as for `check-ui.cjs`, build
Pages and run `node tools/check-pages.cjs http://127.0.0.1:5185/pages/ --verify --serve`.

## Sources

- HSK lists: [ivankra/hsk30](https://github.com/ivankra/hsk30), MIT.
- Glosses: CC-CEDICT via [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary), CC BY-SA 4.0.
- Stroke order: [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data).
- Character breakdowns: [Make Me A Hanzi](https://github.com/skishore/makemeahanzi), LGPL / Arphic.
- Frequency and radicals: [hanziDB](https://github.com/ruddfawcett/hanziDB.csv).
- Font licensing: `app/fonts/LICENSES.txt`.
