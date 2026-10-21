# Themes

Everything the app's look is made of, as plain files. `npm run themes` compiles this folder into
`app/themes/` (generated, and committed like `app/data/`), which the app loads.

## skins/

One JSON file per theme. Copy one, change the colours, run `npm run themes`, and it appears in
Settings > Theme under Dark or Light according to `dark`.

```json
{
  "id": "gruvbox",             // used in storage and as data-skin; keep it a slug
  "name": "Gruvbox",           // shown in the picker
  "dark": true,                // which group it sits in, and which chart palette it gets
  "order": 1,                  // optional: position within its group (lowest first)
  "radius": "8px",             // optional: corner radius for panels (default 13px)
  "preview": ["#928374", "#83A598", "#8EC07C", "#FABD2F", "#FE8019"],   // five bars in the swatch
  "tokens": { "void": "#1D2021", "rail": "…", "surface": "…", "surface-2": "…", "surface-3": "…",
              "line": "…", "line-hot": "…", "ink": "…", "ink-soft": "…", "muted": "…",
              "acc": "…", "acc-hi": "…", "acc-dim": "…", "acc-wash": "…", "on-acc": "…", "stripe": "…",
              "h1": "…", "h2": "…", "h3": "…", "h4": "…", "h5": "…", "shadow": "…" }
}
```

Tokens: `void` is the page, `rail` the sidebar, `surface`/`surface-2`/`surface-3` the panels in
rising prominence, `line`/`line-hot` borders, `ink`/`ink-soft`/`muted` text, `acc` the accent with
its brighter (`acc-hi`), dimmer (`acc-dim`) and wash (`acc-wash`) steps, `on-acc` text on the
accent, `h1`–`h5` the five-step heat ramp the charts use, `shadow` the panel shadow.

## backgrounds/

Transparent PNG textures laid over the page colour when chosen in Settings > Theme > Background
texture. Any PNG dropped here is offered; the name is taken from the file name
(`Texture_03_Handmade_Pulp_TRANSPARENT_4K.png` becomes "Handmade pulp"). The build keeps only
the alpha channel, scales it to about 1400px on the long side, blends the edges so it tiles
without a seam, and the app lays it over the whole window at one texel per screen pixel — dark
grain on a light theme, inverted to a light grain on a dark one.

## hanzai-origins-logo.png

The logo. It is not compiled into `app/themes/`: `npm run icons` cuts the browser-tab icon and the
home-screen and install icons from it into `app/icons/`. Replace the file and run `npm run icons`
to change them, and bump the `?v=` on the icon links in `app/index.html` and
`app/manifest.webmanifest` so browsers fetch the new ones.
