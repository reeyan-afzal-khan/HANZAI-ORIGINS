# Development tools

Run all commands from the repository root. The npm scripts in `package.json` call the helpers here.

- `serve.mjs`: local static server for `release/web/`.
- `build.mjs` checks versions and refreshes cache identifiers in `release/web/` for local use, GitHub Pages and Capacitor.
- `android.mjs`: cross-platform Gradle wrapper launcher. Run `npm run android:apk` to build and sync web assets first.
- `build-db.mjs`, `build-data.mjs`, `build-examples.mjs`: source database, app data and reading examples.
- `fetch-sources.mjs`, `build-char*.mjs`, `build-radicals.mjs`, `build-strokes.mjs`: dictionary and character assets.
- `build-extrawords.mjs`: the character map's everyday words (`src/data/dictionary/extrawords.json`), from CC-CEDICT and an OpenSubtitles frequency list. `npm run sources` runs it.
- `build-rust.mjs`, `check-rust.mjs`: compile the Rust engine in `src/engine/`, and check it against JavaScript (reader parity with the pre-migration release, the character map's word lists and layout).
- `build-themes.mjs`, `make-icons.mjs`, `build-fonts.py`: appearance assets.
- `lib/`: shared paths, compilers and parsers (`cedict.mjs` reads CC-CEDICT lines and tone marks for the dictionary builds).
- `local/`: optional SDK/JDK installations (not committed).

Requirements: Node.js 22+ and npm. Font generation additionally needs Python with fonttools and brotli. Android builds need JDK 17 and Android SDK 34; see the root README.

## UI smoke check

`node tools/check-ui.cjs` checks the built app at desktop and phone widths. It requires Playwright and a Chromium browser. If using existing installations, set `PLAYWRIGHT_MODULE` to the module path and `BROWSER_PATH` to the browser executable. Run `npm run build` first.
