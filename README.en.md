[中文](README.md) · **English**

# OVERFLOW · 溢彩

**▶ Play online <https://fanquanpp.github.io/overflow-pigment/>** · ~20 minutes · bilingual Chinese/English · no build step, zero dependencies

**A pigment-mixing puzzle game** · six albums · 108 boards

A complete puzzle game written with three.js. The boards are uniformly square tilings, and silhouettes (ring, hourglass, cross, lozenge, …) are what change the board's shape; each move spreads one pigment through a connected region of the same colour, driving the whole board toward a target colour.

The key point is that **the mixing is real**:

```
cyan + gamboge = green          magenta + gamboge = red          magenta + cyan = purple
vermilion + indigo = muddy green (real red plus blue is exactly like this; the model does not hide it)
```

This is not a palette lookup table, and not RGB interpolation. Pigments are modelled with **reflectance curves**, and mixing uses **Kubelka–Munk** — the standard approximation for mixing pigment layers. That is why cyan plus yellow is a clean green, while red plus blue is a muddy brown: the red pigment absorbs blue and the blue pigment absorbs red, so both lose. This is the one part of the mechanism that cannot be replaced.

```bash
cd color
node tools/serve.mjs          # → http://127.0.0.1:8080/
```

It must be opened over HTTP. The project uses ES modules + an import map, which the browser blocks under `file://`.

The live version is served from `https://fanquanpp.github.io/overflow-pigment/` — static files in the repository root, hosted directly by GitHub Pages. There is no build step, so deploying is just pushing. `npm run serve:prefix` reproduces the same directory structure locally under the `/overflow-pigment/` subpath, specifically to catch ahead of time errors such as "paths starting with a bare `/`" that only surface on Pages.

```bash
npm run assets       # optional: download the Inter font (118 KB). The game runs without it
npm run check        # everything: grid geometry, colour model, all 108 levels, pipeline smoke test
npm run levels       # regenerate level content (~5 minutes)
npm run validate     # validate only the committed levels
```

---

## Contents

- [How to play](#how-to-play) · [Visual design](#visual-design) · [How to run](#how-to-run)
- [Project structure](#project-structure) · [Core mechanics](#core-mechanics)
- [Engineering notes](#engineering-notes)
- [How the levels are made](#how-the-levels-are-made) · [Accessibility](#accessibility)
- [License](#license)

---

## How to play

The palette dock along the bottom holds the pigments used by this album, each with a number, a symbol, and **the number of cells that still need it** — not how many are on the board, but how many are still missing it. That number is the remaining work on the board: it falls as you solve, pigments the target does not use stay at 0 (so they grey out and are no longer a legal choice), and you can see at a glance which colour is the bottleneck.

Pick a pigment, click a tile. **The entire connected region of the same colour around it** turns into the mix of "its current colour + this pigment" in one move — no matter how many cells are involved.

Two kinds of goal:

- **Unify**: collapse the whole board to a single mixed colour. You are given only the pigments contained in the target colour, so dead ends are impossible and all the tension lives in the move budget.
- **Recipe**: certain cells on the board are marked, each requiring a specified pigment, while the rest are free. Free cells score nothing, sit in the way, and are the only material that can join two marked cells into one region so a single move satisfies both.

Three rule sets:

| | Move effect | Goal | Why it is always solvable |
|---|---|---|---|
| `mix` | region colour = current ∪ pigment | equality | every cell starts ⊆ the target, and union only adds |
| `replace` | region colour = that pigment | equality | overwriting does not accumulate; just paint each region to the target |
| `recipe` | region colour = current ∪ pigment | containment | adding pigment cannot "overshoot", so a board can never be ruined |

The core strategy is **merge first, then unify**: two regions can only join once they are the same colour, so the cheapest solution always grows regions into big blocks first and finishes them together, rather than patching cell by cell.

**Practice room**: the "Practice" entry on the home page hands you an 8×8 random board on demand — built with the same generation pipeline and the same analyser as the albums, at medium difficulty. It keeps no progress and shows no result card; when you finish it gives you a single hint and an "Another board" button. Use it to feel out a palette's temperament, or just to zone out.

---

## Visual design

**Russian Constructivism + Swiss International Style.** Not a quotation of them, but doing things the way each side did:

The Swiss half provides the **system** — a strict grid, body text flush left and ragged right, four type sizes instead of ten, hairline rules used as structure (rather than boxes and shadows), white ground, no rounded corners, no gradients, no transparency, no blur. Each of those last ones is a way of avoiding a decision about the grid.

The Constructivist half provides the **voice** — the single streak of signal red between paper white and ink black, oversized numerals used as compositional elements rather than as data, diagonals that appear only when there is a reason, hard offset shadows (like one printed sheet pressing on another).

The part both sides genuinely share is the useful part: a limited palette, one grid, and the assumption that the reader is smart.

The board is the single exception, and deliberately so: it is the only place in the whole interface where a lot of colour appears, because telling colours apart is the game itself. A strict monochrome frames the one field of colour — that is both the Swiss idea and the only honest way to present a colour puzzle.

**Structurally, the interface has a single content column.** Content is centred and capped at a comfortable line length (~1020px), and the space left on either side is where the board lives — it exists as a background rather than taking a column and competing with the text. Three "volumes":

| State | Board | Where it is used |
|---|---|---|
| `focus` | fills the screen, yielding only to the HUD's two rules lines | playing |
| `hero` | the lower half of the first screen, full width, with the title card floating above it | home page, page 1 |
| `ambient` | recedes into the background at 0.34 opacity | every other page |

**The home page is paginated, not one long scroll.** Five switchable pages — Start / Mixing / Ripples / Print / Content — each exactly one screen, no scrolling needed. The long vertical panel was rejected for a straightforward reason: it flattens the argument, the grid, the print processes and the data into one level-less paper ribbon, and to keep the board always visible it would have to occupy a column permanently.

**The palette is shown as a continuous gradient, not as swatches.** The band interpolates in OKLab — the same space the colour transitions on the board use — so it shows the album's true colour volume rather than seven hard steps; the ticks on the band are the mixes the board can actually reach. The three bands in the mixing demo are three-stop gradients of "pigment → mixed colour → another pigment", and the middle stop is the result the model computed.

**The six albums share one print language** (offset lithography: coated white card, neutral ink, crisp edges) — what changes between albums is the **pigment** (each has its own palette), not the paper and ink. The plan was once to give each album its own print process; in reality the theme table never had a key for it, and all six fell back to the same theme. This version formalises that fact: one language, and the effort saved went into the ripples and the practice room.

How the five effects map onto that language:

- **Fold** — the crease in the paper. Tiles flip about their own hinge line, revealing the back of the paper (not more ink). Each tile's hinge direction is pseudo-random, so a region folding at once looks like a tiled roof, not a single sheet.
- **Signal** — that one streak of signal red. On hover the whole region lights up with a red edge (because a move acts on a region), and a freshly placed tile flashes a red edge once. All flat fills, no glow: a signal that glows is no longer a signal, just an effect.
- **Reflection** — the sheet's own impression. A hard-edged, offset, darkened copy laid on the paper. An earlier version drew a mirror reflection, which belongs to a different visual language.
- **Ripples** — a move is not applied all at once. The change starts at the clicked cell and unfolds ring by ring in BFS layers (~55ms per ring), like ink on wet paper; undo and reset snap the whole region back at once, because those are corrections, not events.
- **Colour transition** — two colours travel through OKLab. Straight sRGB interpolation collapses blue→yellow into grey halfway, and the entire difficulty of this game is telling two colours apart; a transition that passes through mud would make the target hard to read exactly at the moment the player is checking it.

**Colour fidelity is a correctness requirement, not a preference.** The renderer uses `NoToneMapping`, and the lights sum to roughly 1, so a matte surface reproduces its albedo almost exactly — the colour the mixing model computes is the colour on screen. For the same reason, glow was removed entirely: glow bleeds one bright colour into its neighbours, and the question this game asks is precisely "are these two cells the same colour?"

---

## How to run

Node 18+ is required, only to run the static server.

```bash
node tools/serve.mjs                    # defaults to 8080
node tools/serve.mjs --prefix=color      # emulate the GitHub Pages subpath
```

Why `--prefix` exists: project sites are served from `https://<user>.github.io/<repo>/`, where any path starting with a bare `/` 404s. Running it locally first catches this ahead of time.

Once the page is open: click a numbered swatch at the bottom to choose a pigment → click a cell on the board → the whole connected region changes its mixed colour.

Keyboard: `1`–`5` choose a pigment, `Z` undo, `R` reset, `H` show a solution, `Esc` pause.

---

## Project structure

```
index.html                  import map + four layers (canvas / hud / screens / boot)
styles.css                  the whole interface. See the design notes at the top of the file
src/
  main.js                   startup and wiring: the only place that knows about every module
  color/
    color.js                sRGB ↔ linear ↔ OKLab/OKLCh, gamut mapping, perceptual distance
    pigment.js              pigment catalogue, Kubelka–Munk mixing, palette construction, accessibility symbols
  grid/
    grid.js                 square tiling: coordinates, adjacency, tile polygons, analytic picking
    polygon.js              polygon inset (pure maths, so it can be tested under Node)
  puzzle/
    rules.js                rules engine: region spread, mixing, goal checks, dead ends, undo
    solve.js                beam-search solver + provable lower bound + difficulty scoring
    generate.js             board generation (partition + colouring)
    levels.js               the 108 boards. Generated by tools/generate-levels.mjs
  render/
    themes.js               the single print theme: paper, ink, halftone dots, overprint offset, plate thickness, ripple delay
    materials.js            tile materials (matte plate + key line + fold + signal red)
    tiles.js                InstancedMesh tile field + impressions + analytic picking
    stage.js                renderer, camera framing, lights, paper, print post-processing
  game/
    play.js                 glue layer: rules ↔ rendering ↔ audio ↔ input
  ui/
    dom.js  hud.js  screens.js
  core/
    i18n.js  save.js  input.js  audio.js
tools/
  serve.mjs                 zero-dependency static server
  vendor-three.mjs          recursively vendor three.js along the import graph
  generate-levels.mjs       generate level content
  validate-grid.mjs         prove the square tiling (with silhouette masks) really tiles
  validate-color.mjs        prove the pigment model really behaves like pigment
  validate-levels.mjs       replay a solution for every level
  fetch-assets.mjs          optional fonts
  smoke.mjs                 end-to-end pipeline smoke test
vendor/three/               three.js 0.186.1 + the addons actually used (18 files)
assets/fonts/               fonts.css (a placeholder that is always present) + optional fonts
assets/CREDITS.md           licences and credits
```

---

## Core mechanics

### Colour state is a set of pigments

A cell's colour is **which pigments it contains** — a bitmask — and a move is "add pigment P". This makes the operation:

- **Closed**: a union is still a set, so the palette can never escape the model
- **Commutative**: the order in which pigments are added does not matter
- **Associative**: how you group the additions does not matter
- **Idempotent**: adding a pigment it already has does nothing

The first three make it possible for a player to reason about a mix; the fourth lets a redundant move be detected and rejected instead of silently eating a turn.

Because of closure, a three-pigment album has exactly seven colours, and seven is already close to the ceiling for a puzzle whose entire difficulty is telling colours apart. Four pigments give fifteen mixes, but they have to squeeze into the same colour volume, and pairs of colours start falling within a just-noticeable difference. This is not a feeling — `tools/validate-color.mjs` measures the minimum OKLab distance of every palette, and only those marked `ship` are used as level content. There is no "warm-toned" palette in the catalogue, because when three pigments crowd into the same patch of hue they simply cannot produce seven distinguishable colours.

### What a move does on screen

Feedback is layered, so a player can tell what happened without reading the HUD:

| Layer | Effect |
|---|---|
| Fold | changed tiles flip over, hinge direction pseudo-random per tile |
| Colour | travels to the new mixed colour through OKLab without losing chroma on the way |
| Signal | the edge flashes signal red — a flat fill, printed on the paper via halftone dots |
| Sound | the region's own pitch + the pigment's own pitch, **the interval is the feedback** |

The sound layer deserves a note of its own: a pigment has a pitch, and a mixed colour has the average of its pigments' pitches, so adding a pigment to a region that already contains it is a unison (it sounds like nothing happened), while merging two regions is a fifth or an octave (it sounds like a resolution). The player hears the difference between a good move and a wasted one before reading the HUD. The scale is a major pentatonic, so no ordering can sound bad.

### Hovering

Hovering a cell lights up **the entire region**, because a move acts on a region and the player is choosing a region, not a cell. It also shows a preview: current colour + selected pigment → resulting colour, and "how many cells this move will overshoot the goal".

---

## Engineering notes

### Analytic picking, not raycasting

`InstancedMesh.raycast` walks every instance and tests its geometry. Triangular tiles are thin and pointed, which makes that both slow and inaccurate at the seams. Instead the pointer ray is intersected with the board plane and resolved analytically by `grid.pickAt` — an approximate cell plus an exact containment test, the same maths `validate-grid.mjs` verifies, so a click can never land on a tile that does not exist.

The board tilts under the mouse, at which point the world-space `y = 0` plane is no longer where the tiles are, so the ray is first moved into the board's **local space** and intersected there. This is exact at any tilt.

### Framing is a projection fit, not a bounding circle

Fitting the board's **bounding circle** into the field of view is the most natural thing to do, and it frames poorly: the board is a plane seen from fifty degrees above, so its near half is magnified and its far half shrunk, projecting into a trapezoid whose centre sits noticeably below the centre of the screen. The bounding circle cannot see this, because it never projects anything.

So this actually projects: place the camera, project the board's corners (plus the corners of its impression, plus the board's corners at maximum tilt) into screen space, measure the true bounding box, and correct. The correction has to split into two paths — **distance** moves the camera along its orbit (changing only scale), and a **frustum offset** shifts the framing (changing only position). Separating them is the whole trick: the first time I wrote it, I moved the camera and its look-at point together to re-centre, which is not linear in projection — it overshoots, it diverges, and the fit ended up on a look-at point sixteen units away from the board.

### State events are self-describing

The state events `play` emits carry everything the HUD needs, rather than assuming the HUD has already been told about the level. A state event that "only works if you call something else first" is a state event with hidden preconditions — and that is exactly what made the first frame of every board crash.

### No build step

`vendor/three.mjs` starts from the few entry points the game actually imports and walks the dependency closure along every relative `from './x.js'`. An addon's dependency set is not recorded anywhere, and copying files by hand is a reliable way to guarantee 404s. The bare specifier `three` is deliberately skipped — it is resolved by the import map.

---

## How the levels are made

The 108 boards were not hand-written, and they are not scattered at random.

**The difficulty curve is measured, not written down.** The generator first builds a candidate pool whose parameters span board size, silhouette mask, rule set and degree of fragmentation; measures every one of them with the same analyser the validator uses; then fills six difficulty tiers with the candidates closest to each target value.

Doing it the other way round — fixing a chapter's parameters first and then hoping they produce the difficulty written on the label — does not survive contact with the boards: the same fragmentation count is easy on a full rectangular board and vicious on a ring silhouette; and a `replace` board needs an order of magnitude more regions than a `mix` board to reach the same length. Measuring first makes the labels true, and makes a hole in the curve show up as a tier that cannot be filled rather than as a level quietly easier than its name.

**Board generation is construction, not search.** First the board is cut into organic connected blocks by random multi-source growth (the frontier pops from random positions rather than in order — sequential BFS gives you round territories, random popping gives you the jagged interlock of a hand-drawn puzzle), then each block is assigned a **partial** mix of the target colour. The safety property then holds automatically: every cell starts as a subset of the target and union only adds, so every cell can reach the target independently without overshooting.

**The move budget is a safe envelope.** Beam search is heuristic and its result is **not monotonic** in beam width — a narrow beam may happen to find a solution at a shallower depth. So the budget is taken from the widest measurement plus a margin, and the validator replays a solution to confirm it really does finish within the budget.

**A provably optimal solution is out of reach.** Flood-fill puzzles are NP-hard, and three colours is already enough. So what is provided is: a solution that was actually walked and can be replayed (so the budget is definitely reachable), and an admissible lower bound. Both are printed on the solution panel, and the gap between them is visible at a glance.

---

## Accessibility

- **Colour blindness**: every palette colour carries a symbol and a texture, so the board can be read with colour ignored. Symbols are indexed by the **rank** of the subset rather than by the bitmask, so ranks are dense — a four-pigment album's fifteen entries get fifteen different symbols instead of colliding on the shared bits of a bitmask. The textures can be overlaid on the tiles in the settings.
- **Pattern is a native element of this visual language**: halftone dots, line screens, cross-hatching — the printing industry solved this problem first.
- **Contrast**: every tile has an ink key line, and the key line follows the tile's real outline, so adjacent tiles never rely on a colour difference to be told apart.
- **Lightness banding**: the displayed palette colours are compressed into a lightness band and given a minimum chroma, so no cell is as dark as the background and none is so bright it disappears.
- **Reduced motion**: transitions are shortened, camera parallax and board tilt stop, and the paper grain is turned off. Note that motion is shortened, not removed — a puzzle with no confirmation feedback is unplayable.
- **Quality**: glow is already gone, so the quality tiers control the pixel ratio and how much print simulation is applied (halftone dots, overprint offset, paper grain).

---

## Known limitations

- **The budget is based on heuristic measurements**, not on an optimal solution. A clever enough player may find a shorter path than the "par" move count, in which case that board's label is too high. The longer the level, the more likely this is.
- **Beam search grows with the board.** The largest board (9×9, 81 cells) takes a few hundred milliseconds at a wide beam; this happens at generation time and on the hint button, not in the render loop.
- **The paper grid is a world-space pattern, not a screen-space one**, so at extreme tilt you can tell it is stuck on the plane rather than being a texture of the paper itself.
- In several of the six albums, some chapter-six boards do not hit their target difficulty (the candidate pool ran out of hard-enough boards). The validator reports these rather than papering over them.

---

## License

Code and level content: **MIT**.

three.js is MIT and is vendored into `vendor/three/`. Inter and Noto Sans SC are OFL-1.1. See [assets/CREDITS.md](assets/CREDITS.md) for details.

No assets were copied from any game. The puzzle genre is old and belongs to everyone; but the pigment model, the boards, the print processes, the layout and these words are this project's own.
