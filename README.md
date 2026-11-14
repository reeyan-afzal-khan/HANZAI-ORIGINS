# HANZAI-ORIGINS

An offline app for learning to read and write Chinese characters. Start with **Characters** to explore 3,000 HSK characters, their components and stroke order, and practise writing. Use **Read** to open an EPUB or paste Chinese text, look up words, and practise characters in context.

Progress stays on your device. Settings includes reading preferences, themes and Chinese fonts.

## Character adventures

Use **Radicals** to explore character families across all levels. Select a
node and choose **Learn** for a short study, recognition and guided-writing quest.
The family path suggests unfinished characters, including component characters.

First recognition earns 10 XP and first writing completion earns 20 XP per
character; every 150 XP raises the scholar level. Repeating practice is free and
mistakes have no penalty. A star marks a completed writing quest, not mastery.
Quest results belong to the active local profile. No account or server is required.

Explanations use the bundled dictionary and decomposition data. Sound resemblance
is labelled as a learning clue rather than a claim about historical origins.

## Run and build

Install Node.js 22 or later (with npm). From the repository root:

```sh
npm install
npm run serve          # development preview with offline caching disabled
npm run build          # release/web/
npm run serve:release  # http://localhost:5179
npm run build:pages    # release/web/ for GitHub Pages
```

Edit the site in `release/web/` or open `release/web/index.html` directly. Run `npm run build` before publishing to refresh the offline cache and asset URLs in place. Generated app data is committed, so a normal web build does not require downloading or rebuilding the source data.

The web app ships a Rust WebAssembly engine for the reader, character tree and parts of the interface. After editing files in `src/engine/`, run `rustup target add wasm32-unknown-unknown` and `npm run build:rust`. The generated engine is bundled as a local script so it also loads offline. Run `node tools/check-rust.mjs` in a full Git checkout to compare its output and book-analysis time with the pre-migration version.

## Project layout

```text
release/
  web/          Editable web app used by the browser, GitHub Pages and Capacitor
  android/      Android project and Gradle wrapper
src/
  engine/       Rust WebAssembly engine and interface templates
  data/         Source dictionaries, HSK lists and example sentences
  themes/       Source palettes, textures and logo
tools/          Build scripts, development server and verification tools
.github/        GitHub Pages workflow
```

Edit browser code in `release/web/`. Change dictionaries and artwork under `src/` and use the corresponding npm commands to regenerate the bundled assets. The root contains the npm manifest and lockfile, Capacitor configuration, Git ignore rules and this guide.

## Android

Install JDK 17 and Android SDK platform 34 with build-tools 34.0.0. Set `JAVA_HOME` and `ANDROID_HOME`, or configure the SDK in `release/android/local.properties`.

```sh
npm run android:sync
npm run android:open
npm run android:apk
```

The debug APK is written to `release/android/app/build/outputs/apk/debug/`. The helper selects the Windows or Unix Gradle wrapper automatically. For a release, run `node tools/android.mjs assembleRelease` after syncing. Signing uses `release/android/keystore.properties`; keep signing keys private and backed up.

Keep versions aligned in `package.json`, `release/web/js/core.js`, and `release/android/app/build.gradle`; the web build checks them.

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

The Pages workflow builds and publishes `release/web/` on pushes to `main`. Each build stamps the page, scripts and service worker together to keep cached versions consistent.

Keyboard shortcuts: `1` Characters, `2` Read, `3` Settings, `?` help.

## Checking the Pages build

`tools/check-pages.cjs` checks HTTP startup, worker-controlled reloads and offline
reloads. With Playwright configured as for `check-ui.cjs`, build Pages and run
`node tools/check-pages.cjs http://127.0.0.1:5185/web/ --verify --serve`.

## Sources

- HSK lists: [ivankra/hsk30](https://github.com/ivankra/hsk30), MIT.
- Glosses: CC-CEDICT via [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary), CC BY-SA 4.0.
- Stroke order: [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data).
- Character breakdowns: [Make Me A Hanzi](https://github.com/skishore/makemeahanzi), LGPL / Arphic.
- Frequency and radicals: [hanziDB](https://github.com/ruddfawcett/hanziDB.csv).
- Font licensing: `release/web/fonts/LICENSES.txt`.
