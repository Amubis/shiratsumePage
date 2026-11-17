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

## Album heading extension — 2026-11-17

The original 9,088-byte display subset above is unchanged. It does not contain
Chinese characters, so the album previously fell back to the browser's ordinary
CJK face even though its CSS named the same display family as the first pages.
The album now has two additional, self-hosted publisher subsets:

| Asset | Actual face | Size | Intended coverage |
| --- | --- | ---: | --- |
| `dela-gothic-one-album.woff2` | Dela Gothic One Regular, 400 | 4,428 bytes | Existing Japanese album title, `超相册`, digits and most current date-label characters |
| `noto-sans-sc-album-black.woff2` | Noto Sans SC Black, 900 | 2,816 bytes | Simplified Chinese fallback, including `级` and `补`, which Dela does not contain |

Both files are the exact WOFF2 bytes served by Google Fonts. Their glyphs,
character mappings, internal names and outlines have not been edited. The two
actual character maps together cover `超级相册`, `日々のアルバム`,
`日期待补充`, `0123456789`, `年` and `月`. They remain small title subsets;
newly configured characters outside these maps use the broader self-hosted
text-font pack below; only rare unsupported characters keep a system fallback.

The main title and date can use these CSS aliases without altering either font:

```css
@font-face {
  font-family: "Shiratsume Album Display";
  src: url("./assets/fonts/dela-gothic-one-album.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Shiratsume Album CJK";
  src: url("./assets/fonts/noto-sans-sc-album-black.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
/* The second alias selects the already-black 900 glyph outlines at the same
   CSS weight as Dela's inherently heavy regular face. No synthetic bold is used. */
.album-title, .album-date-mark {
  font-family: "Shiratsume Album Display", "Shiratsume Album CJK", var(--display-strong);
  font-weight: 400;
  font-style: normal;
  font-synthesis: none;
}
```

Resolve the URLs relative to the HTML or final stylesheet as described above.
Keep these aliases scoped to the album so the first two pages remain unchanged.

### Album subset sources and verification

- Dela source: [Google Fonts title-subset request](https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap&text=%E8%B6%85%E7%BA%A7%E7%9B%B8%E5%86%8C%E6%97%A5%E3%80%85%E3%81%AE%E3%82%A2%E3%83%AB%E3%83%90%E3%83%A0%E6%97%A5%E6%9C%9F%E5%BE%85%E8%A1%A5%E5%85%850123456789%E5%B9%B4%E6%9C%88), version 19, with a current Chromium user agent to request WOFF2.
- Dela SHA-256: `0eb7c2e3b1b7ad8b6bab92fa303db5983b00a58acccb1b2c41342d0ebeedb932`.
- Dela actual code points: `U+0020, U+0030–0039, U+3005, U+306E, U+3099, U+30A2, U+30CF–30D0, U+30E0, U+30EB, U+5145, U+518C, U+5E74, U+5F85, U+65E5, U+6708, U+671F, U+76F8, U+8D85`.
- Noto source: [Google Fonts Chinese black subset request](https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@900&display=swap&text=%E8%B6%85%E7%BA%A7%E7%9B%B8%E5%86%8C%E6%97%A5%E6%9C%9F%E5%BE%85%E8%A1%A5%E5%85%85%E5%B9%B4%E6%9C%88), version 41.
- Noto SHA-256: `2ad9d38be750f27f1f8f0cb1c4113b6f07eeb66a0f7025a40d3eb47b13311568`.
- Noto actual code points: `U+0020, U+5145, U+518C, U+5E74, U+5F85, U+65E5, U+6708, U+671F, U+76F8, U+7EA7, U+8865, U+8D85`.
- FontTools WOFF2 decoding verified both actual `cmap` tables and the 400/900 source weight metadata. `fc-scan` independently recognized Dela's family and character coverage. In particular, verification checks the downloaded font data rather than trusting Google's CSS `unicode-range`, which can list a requested character absent from the actual Dela font.
- Dela's existing [SIL OFL license](./OFL-DelaGothicOne.txt) also covers the new subset.
- Noto is distributed under SIL OFL 1.1, with its complete license in [OFL-NotoSansSC.txt](./OFL-NotoSansSC.txt), obtained from the [Google Fonts source](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt). No font files require a runtime connection to Google Fonts.


## Broad self-hosted body font — 2026-11-17

The small display subsets above are intentionally retained. Ordinary Chinese and
Japanese text, captions, names and future CMS content now have a separate broad
web font: **Noto Sans SC**, exposed through the CSS alias **Shiratsume Text**.
Link `./assets/fonts/text-fonts.css` directly from the HTML. Every URL inside that
stylesheet is relative to the same directory, so source preview, GitHub project
Pages and another domain use identical files without rewriting URLs. It contains
no `local()` lookups and no runtime Google Fonts requests.

This is the source font's entire actual Unicode character map, split into nine
non-overlapping WOFF2 packages with exact `unicode-range` declarations. It is not
a subset of just the current website text. The browser fetches packages only when
it encounters one of their characters and then caches the fingerprinted files.
The current Chinese and Japanese interface normally uses the core and common
packages, approximately **1.51 MiB** in total, rather than downloading all packs.

| Pack | Code points | WOFF2 bytes |
| --- | ---: | ---: |
| Core: Latin, punctuation, kana and other source symbols | 3,332 | 554,504 |
| Common: GB2312 level one and the current interface | 3,800 | 1,024,412 |
| Additional GB2312 / JIS common characters | 5,988 | 1,836,056 |
| Extended basic Han 1 | 2,797 | 785,212 |
| Extended basic Han 2 | 2,797 | 854,704 |
| Extended basic Han 3 | 2,797 | 897,544 |
| Extended basic Han 4 | 2,797 | 921,324 |
| CJK Extension A 1 | 3,291 | 993,800 |
| CJK Extension A 2 | 3,291 | 1,106,536 |
| **Total** | **30,890** | **8,974,092** |

The actual WOFF2 `cmap` of every package was decoded with FontTools. Their union
matches the original font's 30,890 mapped characters exactly, and no code point
belongs to two packages. All packages retain the real variable `wght` axis from
100 through 900, layout/vertical features and required glyph closures. No glyph
outlines, characters or character substitutions were drawn or replaced.

The package does not cover all Unicode. The source's rare missing characters
(such as the Japanese name variant `𠮷`, U+20BB7) and emoji can still use an
appropriate final system fallback. Common simplified and traditional Chinese,
modern Japanese kana and the site's Japanese text were checked explicitly. This
is the SC regional design, so it provides readable Japanese text with Chinese
regional glyph forms rather than pretending to be a separate JP regional face.

### Pinned source, license and reproduction

- Source: [Google Fonts Noto Sans SC variable TTF at commit
  `2894aab31764f10f29c421bdfd2340d3b382d384`](https://raw.githubusercontent.com/google/fonts/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf).
- Upstream source size: **17,772,300 bytes**.
- Source SHA-256: `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`.
- Source Git blob: `fb0637bafbcd804fe32152370a1225990745b4bc`, also verified against the pinned GitHub tree.
- License: the existing complete [SIL OFL 1.1 license](./OFL-NotoSansSC.txt)
  travels with all generated Noto packages. The original Noto names and copyright
  remain in the font metadata; the reserved name `Source` is not used as a new
  font family name.
- Machine-readable hashes, filenames, exact Unicode ranges, sizes, axis details
  and verified sample strings: [text-fonts-manifest.json](./text-fonts-manifest.json).
- Offline rebuild helper: [rebuild-text-fonts.py](./rebuild-text-fonts.py).
  Use **FontTools 4.61.1** and **Brotli 1.2.1** with the pinned source file:

  ```sh
  python assets/fonts/rebuild-text-fonts.py /path/to/NotoSansSC-variable.ttf --output /tmp/rebuilt-fonts
  ```

  Font timestamps are preserved. The helper refuses a different source hash,
  verifies each rebuilt WOFF2 hash and actual character map, and never downloads
  resources. Normal `npm run build` only copies the already committed assets.
