# data/translation/

The reader's offline translator — "Compact" in its settings — exactly as
published, each file pinned to one release and checked against its SHA-256 by
`scripts/build-translation.mjs`.

```
translation/
├── runtime/                          Transformers.js 3.7.5 (Apache 2.0), from jsDelivr
│   ├── transformers.min.js           the library
│   ├── ort-wasm-simd-threaded.jsep.mjs   ONNX Runtime Web's loader (MIT)
│   └── ort-wasm-simd-threaded.jsep.wasm  ONNX Runtime Web itself
└── opus-mt-zh-en/                    OPUS-MT zho-eng, Language Technology Research Group,
    ├── config.json                   University of Helsinki — CC BY 4.0
    ├── generation_config.json        (Xenova/opus-mt-zh-en on Hugging Face, the ONNX
    ├── tokenizer.json                 conversion, 8-bit quantized, commit 39d480d5)
    ├── tokenizer_config.json
    └── onnx/
        ├── encoder_model_quantized.onnx
        └── decoder_model_merged_quantized.onnx
```

About 135 MB in all. It translates Chinese into English on the device, with no
connection, in the browser, from a page opened from disk, and in the Android app.
`files.json` lists every file once: its name, where it comes from (pinned to
one release), its size and its SHA-256.

## How it flows

```
translation/  ──[npm run translation]──>  app/data/mt/                 (52 scripts, about 180 MB)
                                     └─>  app/data/translation-files.js (the list, a few lines)
```

`npm run translation` fetches whatever is missing or does not match its
checksum, then writes two things:

- **`app/data/mt/`** — every file as base64 in pieces of 3 MB, each piece a
  script: the one form a page opened straight from disk (file://) can load.
  The app opened from this folder and the web build carry it and use it
  directly; `reader.js` (`mtShipped`) puts the pieces back together.
- **`app/data/translation-files.js`** — the list, for the Android app. The APK
  leaves `app/data/mt/` out (`ignoreAssetsPattern` in `android/app/build.gradle`)
  to stay small; instead the reader offers **Install** under Translation, and
  the app fetches the files from their sources into its own storage on the
  device (`files/translation/`, private to the app, removed with it), checking
  each against its checksum (`OfflineTranslatorPlugin.java`). **Remove** gives
  the space back.

Run it, then `npm run build`.

## In the repository

Neither these files nor `app/data/mt/` are committed — they are large and
come from elsewhere, and `npm run translation` brings both back in a
minute. This README is.
