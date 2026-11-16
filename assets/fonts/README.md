# Display font

`dela-gothic-one-display.woff2` is a self-hosted, publisher-provided subset of **Dela Gothic One Regular**, designed by artakana / The Dela Gothic Project Authors.

- Downloaded: 2026-11-16.
- Format: WOFF2; weight **400**, normal style. Its regular face is intentionally heavy; do not request a separate 700/900 asset.
- Size: **9,088 bytes** (8.88 KiB).
- Included code points: printable ASCII `U+0020–U+007E` and `しらつめ` (`U+3057`, `U+3089`, `U+3064`, `U+3081`). This covers the approved avatar title plus `SHIRATSUME`, `Amubis` and short Latin display labels.
- Intended use: short display headings / temporary text logos. Keep body text on the existing readable CJK stack. Other names and characters use the CSS fallback font; this file is not a complete Japanese or Chinese font. A later PNG logo can replace the visual title while retaining its real text.
- Native verification: `fc-scan` recognizes `Dela Gothic One`, `Regular`, and reports exactly `20-7e 3057 3064 3081 3089`.

## License and source

Licensed under **SIL Open Font License 1.1**. The complete copyright and license travel with the font in [OFL-DelaGothicOne.txt](./OFL-DelaGothicOne.txt). Google Fonts supplied the subset; no subsequent glyph edits were made here.

- [Google Fonts family](https://fonts.google.com/specimen/Dela+Gothic+One)
- [Official Google Fonts metadata](https://github.com/google/fonts/blob/main/ofl/delagothicone/METADATA.pb)
- [Official license source](https://github.com/google/fonts/blob/main/ofl/delagothicone/OFL.txt)
- [Upstream project](https://github.com/syakuzen/DelaGothic), source revision listed by Google Fonts: `da8b03e57a8977132b3d0358c48c8463374c74ab`.
- Exact subset request: https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap&text=+%21%22%23%24%25%26%27%28%29%2A%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D~%E3%81%97%E3%82%89%E3%81%A4%E3%82%81
- Asset SHA-256: `08da49d387939a3262e52e632f88e6c7c3cbbcab45c478349e60991dc08384ec`.

Suggested face properties are `font-family: "Dela Gothic One"`, `font-style: normal`, `font-weight: 400`, `font-display: swap`, and `unicode-range: U+20-7E, U+3057, U+3064, U+3081, U+3089`. Resolve the local asset URL relative to the final stylesheet location: the source styles live in `src/`, while the production build concatenates them at the site root.
