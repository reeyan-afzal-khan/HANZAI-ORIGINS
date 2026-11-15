# HANZAI-ORIGINS

An offline app for learning to read and write Chinese characters. Start with **Characters** to explore 3,000 HSK characters, their components and stroke order, and practise writing. Use **Read** to open an EPUB or paste Chinese text, look up words, and practise characters in context.

Progress stays on your device. Settings includes reading preferences, themes and Chinese fonts.

## The character map

**Characters → Tree** draws a family as a map, left to right, and plays it as a
role-playing game's skill tree. Pick a radical from **Radicals** (or a character
from any entry) and the map shows:

- **Built from**: the parts of the core, where it has any (木 is 十 and 八).
- **Core**: the radical or character itself.
- **Tier I**: every character built on it, with its recipe on the link
  (氵 `+每` → 海): a card each for a small family, a group per HSK level for a
  big one.
- **Further tiers and words**: open a character (its `+N` knob, Space, or
  **Expand on map**) to see what is built on it in turn, and the words it writes.
  A word that uses two characters on the map, such as 海洋 from 海 and 洋, is
  linked from both, so separate paths meet in the vocabulary they make.
- **Words**: each character's list holds its HSK words and the common everyday
  words the official list leaves out, such as 你好 from 你 and 好, marked
  **Everyday**. A list shows its first six; **Show more** pages through the rest.
- **Also filed under**: every other character the radical index files under the
  radical, so a radical's map always shows all of its characters.
- **Word maps**: search a word (你好), or pick one in a list and press **Map this
  word** (or **G**), and the map shows how it is built: each character's parts,
  each character, then the word and the longer words it appears in. The panel
  explains it character by character: what each part brings (meaning or sound),
  how the parts sit, and the dictionary's account of the character.

- Every character is a skill: locked, ready, learned (★★) or mastered (★★★).
  One star comes from recognising it in a quest or meeting it in your deck, two
  from finishing its writing quest, three from mastering its card.
- A character opens once the one it is built on is learned: learn 木 and its
  first tier opens. A component with no entry of its own (氵, 扌) holds nothing
  back. A word is ready once all its characters are learned. **Train anyway**
  practises a locked character early.
- **Next quest**, over the map, always names what to learn next. A quest is a
  short study, recognition and guided-writing round. First recognition earns
  10 XP and first writing completion 20 XP per character; every 150 XP raises
  your scholar level (Novice, Apprentice, Initiate, Scribe…).

Press the search icon over the map (or **/**) to jump to a character, a word (你好), toneless
pinyin (nihao) or a radical (竹). Drag to pan, scroll or pinch to zoom, and use
the small map in the bottom-left corner for big families (tap it to enlarge it,
then tap or drag on it to move there). Keys: arrows move, **Space** opens a character on the map, **Enter**
opens its entry, **Q** starts its quest, **G** makes it the core, **+ −** zoom,
**0** fits the map, **Backspace** goes back.

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

The web app ships a Rust WebAssembly engine for the reader (word segmentation, annotated markup, text import and book analysis), the character tree, the character map (each character's word list and the map's layout) and the EPUB fallback decompressor. The page shell stays plain HTML in `release/web/index.html`, so the browser can draw it without waiting for the engine, and small pieces of markup such as the character grid are built in JavaScript, where crossing into WebAssembly would cost more than it saves. After editing files in `src/engine/`, run `rustup target add wasm32-unknown-unknown` and `npm run build:rust`. The generated engine is bundled as a local script so it also loads offline. Run `node tools/check-rust.mjs` in a full Git checkout to compare its output and book-analysis time with the pre-migration version, and the character map's word lists and layout with a plain JavaScript version.

## Project layout

```text
release/
  web/          Editable web app used by the browser, GitHub Pages and Capacitor
  android/      Android project and Gradle wrapper
src/
  engine/       Rust WebAssembly engine
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
- Everyday words: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict), CC BY-SA 4.0, ranked by [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018), CC BY-SA 4.0.
- Stroke order: [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data).
- Character breakdowns: [Make Me A Hanzi](https://github.com/skishore/makemeahanzi), LGPL / Arphic.
- Frequency and radicals: [hanziDB](https://github.com/ruddfawcett/hanziDB.csv).
- Font licensing: `release/web/fonts/LICENSES.txt`.
