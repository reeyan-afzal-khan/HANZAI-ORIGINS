# HANZAI-ORIGINS

An offline study app for the **HSK 3.0** Chinese standard: 11,092 words, 3,000 characters with stroke order, and all 573 grammar points. It also has a reader for your own books, and conversation practice.

There is no account and no server. Everything runs on your device, and your progress is stored there too.

**Get it:** use it on the web at <https://reeyan-afzal-khan.github.io/HANZAI-ORIGINS/>, open `app/index.html` in a browser, host `release/web/` anywhere, or install `release/HANZAI-ORIGINS-<version>-release.apk` on Android.

## Features

- **Home**: a word of the day, the book and the conversation you left off, and every section with what is behind it at your level.
- **Characters & Grammar**: browse by level, search in hanzi, pinyin or English, with how far into the level you are at the top of each page. Characters animate their stroke order and can be practised by hand; the grid is headed by letter, frequency band or stroke count, and filters to the characters not started, being learned or mastered. Most grammar points have an explanation and example sentences, with the pattern marked in each, listed under the standard's own sections. On a wide screen the character or point you pick opens beside the list, and the arrow keys move through it.
  - The characters can also be laid out as a tree on an open canvas, like a game's skill tree: a radical, sound family or other part on the left, the characters built on it branching to the right tier by tier (木 → 林 → 森), and what it is made of to its left. The tree grows through every level, with the characters above yours drawn locked, and opens its deepest branches first. A big family is gathered into a card per level, with the levels above yours folded onto one shelf until you open them. Drag to pan, scroll or pinch to zoom, use the map in the corner on a big tree, go full window, and grow a new tree from any tile. Tiles show when they are in your deck or mastered. A panel beside the canvas (a sheet on a phone) tells you about the tile picked: its stroke order, which part gives the meaning and which the sound, what it builds into, and the words it is in.
- **Read**: open an EPUB or paste text. Every word is coloured by HSK level.
  - Tap a word for its card.
  - Hold a word and drag to select a passage, then show it in pinyin, word by word, or translated.
  - Pages turn like a book, one or two at a time. Full screen with `F`.
- **Translation**: Google Translate when you are online. Offline, the browser's built-in translator or **Compact** (OPUS-MT, Chinese to English).
  - Compact comes with the desktop and web versions.
  - On Android it is an optional install of about 135 MB, made from the reading settings.
- **Talk**: 4,228 conversation questions in Chinese and English, dealt as decks for chatting with real people. Each question is marked with the level needed to read it and comes with a sample answer.
- **Profiles & display**: several people per device, optional passcodes, JSON backup, and light and dark themes with a choice of Chinese and English fonts.

Shortcuts: `1`–`6` switch sections, `/` searches, `[` folds the sidebar, and `?` lists the rest.

## Running it

The app needs no build step; just open `app/index.html`. To regenerate its data:

```bash
npm install
npm run data        # data/ → data/hskker.db → app/data/
npm run strokes     # stroke-order files
npm run talk        # conversation questions (after `data`)
npm run translation # offline translator: downloads it into data/translation/, packs it into app/data/mt/
npm run serve       # http://localhost:5178
npm run build       # release/web/ and release/HANZAI-ORIGINS-web.zip
```

`app/data/` is generated but committed, except the translator in `app/data/mt/`; `data/hskker.db` is not committed. Other scripts (`themes`, `fonts`) are explained in the README of the folder they work on.

### Website

Every push to `main` deploys the site through `.github/workflows/deploy-pages.yml` (Settings → Pages → Source must be **GitHub Actions**). The workflow fetches the offline translator, runs `node scripts/build.mjs --pages`, and publishes `release/pages/`. To build the same copy locally, run `npm run translation` once, then that command.

### Android

You need JDK 17 and the Android SDK (platform 34, build-tools 34.0.0). Both can live in `tools/`, which is gitignored.

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

- **Versions:** keep the version the same in `package.json`, `app/js/core.js` and `android/app/build.gradle`; the build checks.
- **Signing:** the release is signed when `android/keystore.properties` exists. Keep the keystore in `android/keys/` safe: without it, an installed app can't be updated.

## Project layout

```
app/                  the app as it ships: open app/index.html
├── index.html        the page, with styles.css, manifest.webmanifest and sw.js beside it
├── js/               the code, one script per section (reader.js, talk.js, tree.js, …)
├── icons/            the tab and install icons, cut from themes/hanzai-origins-logo.png (npm run icons)
├── fonts/  vendor/   the Chinese faces it carries, and Hanzi Writer
├── data/             generated from data/
└── themes/           generated from themes/
data/                 what the app is built from, one folder per topic, each with a README
├── hsk3/             the official HSK 3.0 lists
├── dictionary/       meanings, readings and how each character is built
├── grammar/          the grammar points' explanations and example sentences
├── talk/             the conversation questions and their sample answers
└── translation/      the offline translator (downloaded by npm run translation)
themes/               palettes and textures (themes/README.md), and the logo
scripts/              the build scripts behind the npm commands
├── build.mjs         app/ → release/web/ (with --pages, release/pages/ for the website)
└── lib/              what the scripts share: the paths, the database, the compiler, pinyin
android/              the Android project (Capacitor)
```

**Why data files are JavaScript:** a browser can't `fetch` local files from `file://`, but it can load them as scripts. So the same app runs from disk, from a web server, and in the Android WebView.

## Data sources

- HSK 3.0 lists: [ivankra/hsk30](https://github.com/ivankra/hsk30) (MIT)
- English glosses: CC-CEDICT, via [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (CC BY-SA 4.0)
- Stroke order: [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data); character breakdowns: [Make Me A Hanzi](https://github.com/skishore/makemeahanzi) (LGPL / Arphic)
- Frequency, stroke counts, radicals: [hanziDB](https://github.com/ruddfawcett/hanziDB.csv)
- Fonts: [Zhuque Fangsong](https://github.com/TrionesType/zhuque) (SIL OFL 1.1), and for Kai either a `KaiTi.ttf` you supply or [LXGW WenKai](https://github.com/lxgw/LxgwWenKai); see `app/fonts/LICENSES.txt`
- Grammar explanations and their example lines were written for this project.
