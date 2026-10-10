# Credits and licences

Everything in this project is either written here or fetched by
`tools/fetch-assets.mjs` from a pinned source. Nothing was copied from another
game.

## What is *not* here, and why

There are no textures, no models, no environment maps and no audio files. The board
geometry is generated from the grid definitions, the colours come out of a pigment
mixing model, the reflections come from three.js's procedural `RoomEnvironment`, and
every sound is synthesised at runtime with WebAudio. That is not minimalism for its
own sake — it means the project has no asset pipeline to go stale, no licence to
track per file, and no download required to run it.

## Fetched assets

### Inter — OFL-1.1

- Source: `https://cdn.jsdelivr.net/npm/@fontsource/inter@5.3.0` (Fontsource mirror
  of the upstream Inter release)
- Upstream: Rasmus Andersson, <https://rsms.me/inter/>
- Files: `assets/fonts/inter-latin-{400,600,700,800,900}-normal.woff2`
- Used for: the whole interface. A neutral grotesque is what the Swiss half of the
  visual language is set in, and Inter is the closest well-hinted open face to
  Helvetica/Akzidenz-Grotesk.
- Licence: SIL Open Font License 1.1 — redistribution permitted, including in a
  repository.

### Noto Sans SC — OFL-1.1 *(optional, `npm run assets -- --cjk`)*

- Source: `https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0`
- Upstream: Google Noto, <https://fonts.google.com/noto>
- Files: ~200 `unicode-range` subsets across weights 400 and 700, ~7 MB
- Used for: Simplified Chinese, on systems that have no CJK face. The subsets are
  split by unicode range so a page only downloads the few it renders.
- Licence: SIL Open Font License 1.1.

Without either face the interface falls back to a system grotesque stack
(`Helvetica Neue`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, …), which is a
deliberate fallback and not a degraded state.

## Libraries

### three.js — MIT

- Version 0.186.1, vendored into `vendor/three/` by `tools/vendor-three.mjs`
- <https://threejs.org/>
- The vendoring script walks the addon import graph from the entry points the game
  uses, so exactly the needed files are present: the build, the post-processing
  chain (`EffectComposer`, `RenderPass`, `ShaderPass`, `OutputPass` and their
  shaders), `RoomEnvironment`, and `OrbitControls` for development.
- No bloom pass is vendored into use: the board is a printed sheet, not a lit object,
  and an Unreal bloom would bleed one tile's colour into its neighbour — which is
  precisely the distinction the puzzle asks the player to make.

## Techniques, with their sources

### Colour

- **OKLab** — Björn Ottosson, *A perceptual color space for image processing*,
  <https://bottosson.github.io/posts/oklab/>. The matrices in
  `src/color/color.js` are his published constants, used for interpolation and for
  measuring whether two palette colours are far enough apart to tell apart.
- **Kubelka–Munk** — the one-constant approximation of pigment mixing, used in
  `src/color/pigment.js`. `K/S = (1−R)²/2R`, absorption sums, and the inverse
  `R = 1 + K/S − √((K/S)² + 2K/S)`. This is why cyan plus yellow is green and why
  red plus blue is mud: the model works from reflectance curves, not from RGB
  triples, so it knows that red pigment absorbs blue and blue pigment absorbs red.
- **Pigment primaries.** The reflectances are eyeballed against real pigments
  (phthalo, crimson, gamboge, ultramarine, indigo, vermilion, malachite) rather than
  measured. The three-pigment sets that ship were chosen by scoring every
  combination in the catalogue for minimum perceptual separation —
  `tools/validate-color.mjs` prints the table, and it is why there is no
  "warm colours" palette: three pigments in the same hue region cannot produce seven
  colours anyone can tell apart.
- **Thin-film iridescence** — Belcour & Barla, *A Practical Extension to Microfacet
  Theory for the Modeling of Varying Iridescence*, SIGGRAPH 2017. three.js implements
  it; this project used it in an earlier pass and removed it, because a glossy
  iridescent board fights a printed one.

### Grids

- **Hexagonal coordinates** follow the conventions documented by Red Blob Games,
  <https://www.redblobgames.com/grids/hexagons/> — odd-r offset storage, the
  six-neighbour table, and the cube-rounding rule used when resolving a pointer to a
  cell.
- **The triangular tiling** was derived from the geometry rather than transcribed:
  a triangle is `(col, row)` and points up when `(col + row)` is even, and its three
  neighbours are the two in its row plus the one across its horizontal edge. The
  derivation, and the fact that the result is a bipartite graph, are checked by
  `tools/validate-grid.mjs`, which proves the four tilings really tile — no gaps, no
  overlaps, symmetric adjacency, and a pointer-to-cell map that agrees with brute
  force.
- **Flood-fill complexity.** Free-Flood-It is NP-hard even with three colours
  (Clifford, Jalsenius, Montanaro & Sach, *The Complexity of Flood Filling Games*,
  FUN 2012 / Theory of Computing Systems 52, 2013). That is why this project ships a
  beam search and a provable lower bound rather than claiming an optimal solver, and
  why the move budget is derived from a solution the search actually walked.

### Typography and layout

- **Swiss International Style** — the grid, the flush-left ragged-right setting, the
  hairline rules and the single-accent palette follow the practice documented by
  Josef Müller-Brockmann in *Grid Systems in Graphic Design* and by Karl Gerstner in
  *Designing Programmes*.
- **Russian Constructivism** — the red/black/paper palette, the oversized index
  numerals and the hard offset shadow are in the register of El Lissitzky, Alexander
  Rodchenko and Gustav Klutsis.

Neither is quoted directly; both are public domain in the sense that a way of
setting type cannot be owned, and no work by either is reproduced.

## Audio

Every sound is generated in `src/core/audio.js` with WebAudio oscillators, filtered
noise and a short convolution tail built from a decaying noise burst. The move sound
is derived from the puzzle itself: a pigment has a pitch, a mixture has the average
of its pigments' pitches, so adding a pigment the region already holds sounds as a
unison and merging two regions sounds as a resolved interval. The scale is a major
pentatonic, so no order of play can sound wrong.

## Level content

The 108 boards were generated by `tools/generate-levels.mjs` from the grid and
colour definitions in this repository. They are not derived from any other game's
levels. The chapter names are original.
