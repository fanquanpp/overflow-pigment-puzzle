/**
 * Localisation.
 *
 * Two lookups, deliberately:
 *
 *   t(key)          UI chrome — short, reused, stable keys ('hud.moves').
 *   tSource(text)   Content that lives in the data files (level and chapter names,
 *                   album blurbs). Keyed by the English source string, so level
 *                   data never has to know about locales and a missing translation
 *                   degrades to readable English rather than to a raw key.
 *
 * Both fall back to English, then to the key itself. Nothing here throws on a
 * missing string: a missing string should never be able to break the UI.
 */

export const LOCALES = [
  { code: 'auto', label: 'Auto' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
];

const EN = {
  // ---- landing page ------------------------------------------------------
  'home.page.start': 'Start',
  'home.page.mixing': 'Mixing',
  'home.page.grids': 'Grids',
  'home.page.inks': 'Inks',
  'home.page.content': 'Contents',
  'home.hero.lede': 'Flood a board with colour. Every move spreads one pigment through a connected region — and the pigments really mix, because the mixing is a physical model rather than a lookup table.',
  'home.eyebrow': 'A puzzle about mixing pigment',
  'home.mix.title': 'The mixing is real',
  'home.mix.body': 'A colour is the *set* of pigments in it, and a move adds one. Pigments are modelled by what they reflect, and mixing uses Kubelka–Munk — the standard approximation for how pigments in a layer combine. That is why cyan and yellow give a clean green, and why red and blue give a dull brown: red pigment absorbs blue and blue pigment absorbs red, so a red-blue mix loses both. The board is the only place in this interface where many colours appear, because telling them apart is the game.',
  'home.mix.c1': 'cyan + yellow',
  'home.mix.c2': 'magenta + yellow',
  'home.mix.c3': 'magenta + cyan',
  'home.mix.c4': 'vermilion + indigo',
  'home.mix.c4note': 'muddy on purpose',

  'home.grids.title': 'Four grids, four problems',
  'home.grids.body': 'The shape is not decoration. A square tile has four neighbours, a hexagon six, a triangle three. More neighbours means a region grows faster and boards come apart more easily; fewer means they are stringier and take more deliberate work. The diamond board is a square grid seen at an angle, so the tiles that look diagonally adjacent are not — which players misjudge, deliberately.',
  'home.grid.square': 'Square',
  'home.grid.square.d': 'The classic. Four neighbours, neutral character, and the only board where the grid you see is the grid you get.',
  'home.grid.hex': 'Hexagon',
  'home.grid.hex.d': 'Six neighbours. The best boundary-to-area ratio of any tiling, so regions converge fast and boards feel generous.',
  'home.grid.diamond': 'Diamond',
  'home.grid.diamond.d': 'A square grid at an angle. Adjacency is unchanged, which is exactly why it misleads.',
  'home.grid.triangle': 'Triangle',
  'home.grid.triangle.d': 'Three neighbours, and bipartite: every triangle only ever touches the opposite orientation. Brittle and stringy.',
  'home.grid.deg4': '4 neighbours',
  'home.grid.deg6': '6 neighbours',
  'home.grid.deg3': '3 neighbours',

  'home.inks.title': 'Six albums, six print processes',
  'home.inks.body': 'Each album is a different set of pigments and a different stock and ink. The bar is the album\u2019s whole colour volume, interpolated in OKLab — the same space the board animates colours through — and the ticks are the mixtures the board can actually reach.',
  'home.inks.reach': '{n} mixtures',

  'home.content.title': 'What is in it',
  'home.stat.boards': 'boards',
  'home.stat.albums': 'albums',
  'home.stat.palettes': 'palettes',
  'home.stat.grids': 'grids',
  'home.stat.moves': 'moves of content',
  'home.stat.hardest': 'hardest board',
  'home.foot': 'Every board\u2019s difficulty was measured, not guessed: the generator builds a pool, measures each candidate with the same analyser the validator uses, and fills six difficulty bands with the closest fits. Every board\u2019s move budget is one a solver actually walked, so it is always winnable.',

  'home.jump.boards': '108 boards',
  'home.jump.mix': 'real pigment mixing',

  // ---- document ----------------------------------------------------------
  'doc.title': 'OVERFLOW — a pigment-mixing puzzle',

  // ---- boot --------------------------------------------------------------
  'boot.subtitle': 'a pigment-mixing puzzle',
  'boot.loading': 'loading {label}…',
  'boot.ready': 'ready',
  'boot.failed': 'failed to start: {msg}',
  'boot.noWebgl': 'This browser has no WebGL2. / 此浏览器不支持 WebGL2。',

  // ---- hud ---------------------------------------------------------------
  'hud.moves': 'Moves left',
  'hud.moves.short': 'moves',
  'hud.done': 'Settled',
  'hud.chapter': 'Chapter',
  'hud.undo': 'Undo',
  'hud.recentre': 'Recentre',
  'hud.reset': 'Reset',
  'hud.hint': 'Hint',
  'hud.menu': 'Menu',
  'hud.pause': 'Pause',
  'hud.mute': 'Mute',
  'hud.palette': 'Pigments',
  'hud.selected': 'Armed',
  'hud.none': 'none',
  'hud.pick': '1 · pick a pigment   2 · click a tile',
  'hud.pickPigment': 'pick a pigment first',
  'hud.target': 'Goal',
  'hud.goalUnify': 'One colour everywhere',
  'hud.goalRecipe': 'Settle the marked tiles',
  'hud.over': 'Out of moves',
  'hud.stuck': 'This mixture cannot be undone',
  'hud.won': 'Settled',

  // ---- pigment dock hints ------------------------------------------------
  'dock.noop': 'Already in that mixture',
  'dock.notNeeded': 'Not needed for this goal',
  'dock.pick': 'Selected {name} — click a tile',
  'dock.mixed': '{from} + {name} → {to}',
  'dock.hoverRegion': '{n} tiles in this region',
  'dock.hoverRegionOne': '1 tile in this region',
  'dock.offGoal': 'That would put {n} tiles past the goal',

  // ---- title -------------------------------------------------------------
  'title.eyebrow': 'A puzzle about mixing pigment',
  'title.lede': 'Flood a board with colour. Every move spreads a pigment through one connected region — and the pigments really mix: cyan and yellow make green, magenta and yellow make red, and red and blue make the brown that red and blue actually make.',
  'title.lede2': 'Six albums, six palettes, four grid shapes. 108 boards, each one measured rather than guessed.',
  'title.chip.albums': '6 albums',
  'title.chip.boards': '108 boards',
  'title.chip.grids': '4 grid shapes',
  'title.chip.mix': 'real pigment mixing',
  'title.play': 'Play',
  'title.continue': 'Continue',
  'title.albums': 'Albums',
  'title.howto': 'How to play',
  'title.lab': 'Mixing lab',
  'title.settings': 'Settings',
  'title.credits': 'Credits',

  // ---- albums ------------------------------------------------------------
  'albums.eyebrow': 'Choose an album',
  'albums.title': 'Six <span class="accent">palettes</span>',
  'albums.lede': 'Each album is a different set of pigments and a different material world. Progress is kept per album; a chapter unlocks when the one before it is settled.',
  'albums.stat.boards': 'boards',
  'albums.stat.hardest': 'hardest',
  'albums.stat.moves': 'moves',
  'albums.progress': '{done} / {total} settled',
  'albums.back': 'Back to title',

  // ---- level select ------------------------------------------------------
  'levels.eyebrow': 'Chapters',
  'levels.title': 'Boards',
  'levels.locked': 'Locked',
  'levels.settled': 'Settled',
  'levels.best': 'Best',
  'levels.chapter': 'Chapter {n}',
  'levels.unlock': 'Settle the previous board to unlock',
  'levels.back': 'Back to albums',

  // ---- board badges ------------------------------------------------------
  'badge.square': 'Square',
  'badge.hex': 'Hex',
  'badge.diamond': 'Diamond',
  'badge.triangle': 'Triangle',
  'badge.mix': 'Mix',
  'badge.replace': 'Replace',
  'badge.recipe': 'Recipe',

  // ---- bands -------------------------------------------------------------
  'band.gentle': 'Gentle',
  'band.steady': 'Steady',
  'band.tricky': 'Tricky',
  'band.severe': 'Severe',

  // ---- result ------------------------------------------------------------
  'result.won': 'Settled',
  'result.wonBody': 'Every tile is on the goal colour, in {moves} moves. The board was measured at {par} moves, so you had {slack} to spare.',
  'result.perfect': 'Settled exactly on par — no moves wasted.',
  'result.lost': 'Out of moves',
  'result.lostBody': 'The board needed {par} moves and you had {budget}. Try again, or take a hint.',
  'result.stuck': 'That mixture is spent',
  'result.stuckBody': 'A tile picked up a pigment its goal does not contain, and mixing can only add. Undo, or reset the board.',
  'result.next': 'Next board',
  'result.retry': 'Try again',
  'result.undo': 'Undo the last move',
  'result.back': 'Back to chapters',
  'result.showSolution': 'Show a solution',
  'result.hideSolution': 'Hide',
  'result.par': 'Par',
  'result.yourMoves': 'Your moves',
  'result.bestEver': 'Best so far',

  // ---- solution ----------------------------------------------------------
  'solution.title': 'A solution in {n} moves',
  'solution.note': 'Found by beam search, so it is a real path and not an estimate. It may not be the shortest — flood-fill puzzles are NP-hard, so a provable minimum is out of reach at this size.',
  'solution.step': 'Step {n}',
  'solution.applies': 'apply {pigment} to {n} tiles',
  'solution.play': 'Replay it',
  'solution.playing': 'Replaying…',
  'solution.stop': 'Stop',

  // ---- how to play -------------------------------------------------------
  'howto.eyebrow': 'How to play',
  'howto.title': 'Mixing, spreading, settling',
  'howto.s1.title': '1 · Pick a pigment',
  'howto.s1.body': 'The dock along the bottom holds the pigments this album uses. Click one to select it.',
  'howto.s2.title': '2 · Click a tile',
  'howto.s2.body': 'The whole connected region of same-coloured tiles around it takes the mixture of its colour and the pigment. One move, however many tiles that is.',
  'howto.s3.title': '3 · Merge before you unify',
  'howto.s3.body': 'Two regions can only be joined by making them the same colour. The cheapest solutions merge regions first and finish them together, rather than fixing tiles one at a time.',
  'howto.s4.title': '4 · Settle the goal',
  'howto.s4.body': 'The goal is shown in the HUD. Most boards want one colour everywhere; some mark individual tiles that must hold particular pigments.',
  'howto.grids.title': 'Four grid shapes',
  'howto.grids.body': 'A square tile has four neighbours, a hexagon six, a triangle three. More neighbours means regions grow faster and boards come apart more easily; fewer means they are stringier and take more deliberate work. The diamond board is a square grid seen at an angle — the tiles that look diagonally adjacent are not.',
  'howto.mix.title': 'The mixing is real',
  'howto.mix.body': 'Pigments are modelled by what they reflect, and mixing uses Kubelka–Munk — the standard approximation for how pigments in a layer combine. That is why cyan and yellow give a clean green, and why red and blue give a dull brown: red pigment absorbs blue and blue pigment absorbs red, so a red-blue mix loses both.',
  'howto.access.title': 'Colour-blind support',
  'howto.access.body': 'Every palette colour carries a glyph and a pattern, so the board is readable with colour ignored. Turn the pattern overlay on in Settings to see it on the tiles.',
  'howto.controls': 'Controls',
  'howto.key.pick': 'select pigment',
  'howto.key.click': 'apply to a tile',
  'howto.key.undo': 'undo',
  'howto.key.reset': 'reset the board',
  'howto.key.hint': 'show a solution',
  'howto.key.drag': 'drag to orbit · wheel to zoom · right-drag to pan',
  'howto.key.recentre': 'return to the front',
  'howto.key.pause': 'pause',
  'howto.back': 'Back',

  // ---- settings ----------------------------------------------------------
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.language.help': 'Interface and level names.',
  'settings.audio': 'Sound',
  'settings.music': 'Music',
  'settings.sfx': 'Effects',
  'settings.access': 'Accessibility',
  'settings.patterns': 'Colour-blind patterns',
  'settings.patterns.help': 'Overlay a glyph pattern on every tile so mixtures can be told apart without colour.',
  'settings.reducedMotion': 'Reduce motion',
  'settings.reducedMotion.help': 'Shorten transitions and stop the camera parallax and the grain.',
  'settings.quality': 'Quality',
  'settings.quality.help': 'Bloom is the most expensive effect. Drop it if the board stutters.',
  'settings.quality.high': 'High',
  'settings.quality.medium': 'Medium',
  'settings.quality.low': 'Low',
  'settings.reset': 'Erase progress',
  'settings.reset.help': 'Clears every settled board and best score on this device.',
  'settings.reset.confirm': 'Erase all progress?',
  'settings.reset.yes': 'Erase',
  'settings.reset.no': 'Keep',
  'settings.back': 'Back',
  'settings.on': 'On',
  'settings.off': 'Off',

  // ---- lab ---------------------------------------------------------------
  'lab.eyebrow': 'No puzzle, just the model',
  'lab.title': 'Mixing lab',
  'lab.lede': 'Add pigments to the pot and watch what they make. The numbers are the reflectance the model actually stores; the swatch is what that reflectance looks like on screen.',
  'lab.pot': 'The pot',
  'lab.empty': 'empty',
  'lab.add': 'Add',
  'lab.clear': 'Empty the pot',
  'lab.reflectance': 'reflectance (R, G, B)',
  'lab.allMixes': 'Every mixture in this palette',
  'lab.palette': 'Palette',
  'lab.back': 'Back',

  // ---- credits -----------------------------------------------------------
  'credits.title': 'Credits',
  'credits.engine': 'Engine',
  'credits.engineBody': 'three.js, MIT licence, vendored into vendor/three.',
  'credits.colour': 'Colour science',
  'credits.colourBody': 'OKLab by Björn Ottosson. Kubelka–Munk for pigment mixing. Belcour &amp; Barla thin-film iridescence, as implemented in three.js.',
  'credits.grids': 'Grid geometry',
  'credits.gridsBody': 'Hexagonal coordinates follow the conventions documented by Red Blob Games. The triangle tiling was derived from the geometry and checked by tools/validate-grid.mjs.',
  'credits.type': 'Type',
  'credits.typeBody': 'System font stack, with Noto Sans SC for Simplified Chinese.',
  'credits.audio': 'Audio',
  'credits.audioBody': 'Every sound is generated at runtime with WebAudio. There are no audio files.',
  'credits.note': 'No assets were copied from any game. The puzzle genre is old and shared; the pigments, the boards and the words are this project’s own.',

  // ---- pause -------------------------------------------------------------
  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.restart': 'Restart board',
  'pause.quit': 'Quit to chapters',
  'pause.settings': 'Settings',

  // ---- misc --------------------------------------------------------------
  'misc.close': 'Close',
  'misc.back': 'Back',
  'misc.next': 'Next',
  'misc.of': 'of',
};

const ZH = {
  'doc.title': '溢彩 OVERFLOW — 颜料混合解谜',
  'home.eyebrow': '一个关于调色的解谜',
  'home.page.start': '开始',
  'home.page.mixing': '混合',
  'home.page.grids': '网格',
  'home.page.inks': '印法',
  'home.page.content': '内容',
  'home.hero.lede': '把颜色铺满棋盘。每一步让一种颜料在某个连通区域内扩散——而颜料是真的会混合的，因为混合是一个物理模型，不是一张查表。',
  'home.mix.title': '混合是真的',
  'home.mix.body': '一格的颜色就是它含有的**颜料集合**，而一步操作是往里加一种颜料。颜料用它的反射率来建模，混合用 Kubelka–Munk——颜料层混合的标准近似。所以青加黄是干净的绿，而红加蓝是浑褐：红颜料吸收蓝、蓝颜料吸收红，红蓝混在一起两边都丢了。棋盘是整个界面里唯一出现大量颜色的地方，因为分辨颜色就是这个游戏本身。',
  'home.mix.c1': '青 + 藤黄',
  'home.mix.c2': '品红 + 藤黄',
  'home.mix.c3': '品红 + 青',
  'home.mix.c4': '朱砂 + 花青',
  'home.mix.c4note': '浑是故意的',

  'home.grids.title': '四种网格，四个问题',
  'home.grids.body': '形状不是装饰。方格有四个邻居，六边形六个，三角形三个。邻居越多，区域扩散越快、棋盘越容易碎开；越少则越细长，需要更刻意的规划。菱形棋盘其实是斜着看的方格，所以看起来"斜对角相邻"的两格并不相邻——玩家会看错，而这是刻意的。',
  'home.grid.square': '方格',
  'home.grid.square.d': '最经典的一种。四邻居，性格中性，也是唯一一种你看到的网格就是真实网格的棋盘。',
  'home.grid.hex': '六边形',
  'home.grid.hex.d': '六邻居。在所有正铺砌里边界与面积之比最优，所以区域收敛快、棋盘显得宽裕。',
  'home.grid.diamond': '菱形',
  'home.grid.diamond.d': '斜着看的方格。邻接关系完全没变，而这正是它会误导人的原因。',
  'home.grid.triangle': '三角形',
  'home.grid.triangle.d': '三邻居，而且是二分图：每个三角形只和相反朝向的三角形相邻。脆弱、细长。',
  'home.grid.deg4': '4 邻居',
  'home.grid.deg6': '6 邻居',
  'home.grid.deg3': '3 邻居',

  'home.inks.title': '六个画册，六种印法',
  'home.inks.body': '每个画册是一组不同的颜料，也是一种不同的纸与墨。这条色带是该画册的整个色彩体积，在 OKLab 里插值——也就是棋盘上颜色过渡走的同一个空间——上面的刻度是棋盘真正能够到达的那些混合。',
  'home.inks.reach': '{n} 种混合',

  'home.content.title': '里面有什么',
  'home.stat.boards': '个棋盘',
  'home.stat.albums': '个画册',
  'home.stat.palettes': '套调色板',
  'home.stat.grids': '种网格',
  'home.stat.moves': '步内容',
  'home.stat.hardest': '最难棋盘',
  'home.foot': '每一个棋盘的难度都是量出来的，不是猜的：生成器先造候选池，用校验器用的同一个分析器逐个测量，再用最接近的候选填满六个难度档。每一个棋盘的步数预算都来自求解器真正走过的一条解，所以一定可解。',

  'home.jump.boards': '108 个棋盘',
  'home.jump.mix': '真实颜料混合',

  'boot.subtitle': '颜料混合解谜',
  'boot.loading': '正在载入 {label}…',
  'boot.ready': '就绪',
  'boot.failed': '启动失败：{msg}',
  'boot.noWebgl': '此浏览器不支持 WebGL2。',

  'hud.moves': '剩余步数',
  'hud.moves.short': '步',
  'hud.done': '已归位',
  'hud.chapter': '章节',
  'hud.undo': '撤销',
  'hud.recentre': '回到正面',
  'hud.reset': '重置',
  'hud.hint': '提示',
  'hud.menu': '菜单',
  'hud.pause': '暂停',
  'hud.mute': '静音',
  'hud.palette': '颜料',
  'hud.selected': '当前颜料',
  'hud.none': '未选',
  'hud.pick': '① 选一种颜料　② 点一个色块',
  'hud.pickPigment': '请先选择一种颜料',
  'hud.target': '目标',
  'hud.goalUnify': '全盘统一为一色',
  'hud.goalRecipe': '让标记格达到要求',
  'hud.over': '步数用尽',
  'hud.stuck': '这个混合无法挽回',
  'hud.won': '已归位',

  'dock.noop': '这个混合里已经有了',
  'dock.notNeeded': '本关目标不需要它',
  'dock.pick': '已选 {name} —— 点击色块',
  'dock.mixed': '{from} + {name} → {to}',
  'dock.hoverRegion': '该区域有 {n} 格',
  'dock.hoverRegionOne': '该区域有 1 格',
  'dock.offGoal': '这一步会让 {n} 格越过目标',

  'title.eyebrow': '一个关于调色的解谜',
  'title.lede': '把颜色铺满棋盘。每一步让一种颜料在某个连通区域内扩散——而颜料是真的会混合的：青加黄得到绿，品红加黄得到红，红加蓝得到红与蓝真正会得到的那种浑褐。',
  'title.lede2': '六个画册、六套调色板、四种网格形状。108 个棋盘，每一个的难度都是量出来的，不是猜出来的。',
  'title.chip.albums': '6 个画册',
  'title.chip.boards': '108 个棋盘',
  'title.chip.grids': '4 种网格',
  'title.chip.mix': '真实颜料混合',
  'title.play': '开始',
  'title.continue': '继续',
  'title.albums': '画册',
  'title.howto': '怎么玩',
  'title.lab': '调色实验室',
  'title.settings': '设置',
  'title.credits': '制作说明',

  'albums.eyebrow': '选择一个画册',
  'albums.title': '六套<span class="accent">调色板</span>',
  'albums.lede': '每个画册是一组不同的颜料，也是一个不同的材质世界。进度按画册保存；完成前一章即可解锁下一章。',
  'albums.stat.boards': '个棋盘',
  'albums.stat.hardest': '最难',
  'albums.stat.moves': '步数合计',
  'albums.progress': '已归位 {done} / {total}',
  'albums.back': '返回标题',

  'levels.eyebrow': '章节',
  'levels.title': '棋盘',
  'levels.locked': '未解锁',
  'levels.settled': '已归位',
  'levels.best': '最好',
  'levels.chapter': '第 {n} 章',
  'levels.unlock': '完成上一盘即可解锁',
  'levels.back': '返回画册',

  'badge.square': '方格',
  'badge.hex': '六边',
  'badge.diamond': '菱形',
  'badge.triangle': '三角',
  'badge.mix': '混合',
  'badge.replace': '替换',
  'badge.recipe': '配方',

  'band.gentle': '舒缓',
  'band.steady': '平稳',
  'band.tricky': '棘手',
  'band.severe': '严峻',

  'result.won': '已归位',
  'result.wonBody': '每一格都到了目标色，用了 {moves} 步。这个棋盘测得的标准步数是 {par} 步，你多出了 {slack} 步。',
  'result.perfect': '刚好用满标准步数——一步都没浪费。',
  'result.lost': '步数用尽',
  'result.lostBody': '这个棋盘需要 {par} 步，而你只有 {budget} 步。再试一次，或者看一个解法。',
  'result.stuck': '这个混合已经废了',
  'result.stuckBody': '有一格沾上了它目标里没有的颜料，而混合只能做加法。撤销，或者重置棋盘。',
  'result.next': '下一盘',
  'result.retry': '重试',
  'result.undo': '撤销上一步',
  'result.back': '返回章节',
  'result.showSolution': '看一个解法',
  'result.hideSolution': '收起',
  'result.par': '标准步数',
  'result.yourMoves': '你的步数',
  'result.bestEver': '历史最好',

  'solution.title': '{n} 步的一个解法',
  'solution.note': '由束搜索找到，是一条真实可行的路径，不是估算。它未必是最短的——泛洪填色类谜题是 NP-hard 的，这个规模下无法给出可证明的最优解。',
  'solution.step': '第 {n} 步',
  'solution.applies': '把 {pigment} 加到 {n} 格上',
  'solution.play': '演示一遍',
  'solution.playing': '演示中…',
  'solution.stop': '停止',

  'howto.eyebrow': '怎么玩',
  'howto.title': '调色、扩散、归位',
  'howto.s1.title': '1 · 选一种颜料',
  'howto.s1.body': '底部的调色坞里是本画册用到的颜料。点一个选中它。',
  'howto.s2.title': '2 · 点一个色块',
  'howto.s2.body': '它周围同色的整片连通区域，会变成"它原来的颜色"与"这种颜料"的混合。一次操作，不管涉及多少格。',
  'howto.s3.title': '3 · 先合并，再统一',
  'howto.s3.body': '两片区域只有变成同一个颜色才能合并。最省的解法总是先把区域并起来、再一起收尾，而不是一格一格地补。',
  'howto.s4.title': '4 · 达成目标',
  'howto.s4.body': '目标显示在顶部。多数棋盘要求全盘统一为一色；也有一些会标出特定格子，要求它们含有指定的颜料。',
  'howto.grids.title': '四种网格形状',
  'howto.grids.body': '方格有四个邻居，六边形六个，三角形三个。邻居越多，区域扩散越快、棋盘越容易碎开；越少则越细长，需要更刻意的规划。菱形棋盘其实是斜着看的方格——看起来"斜对角相邻"的两格并不相邻。',
  'howto.mix.title': '混合是真的',
  'howto.mix.body': '颜料用它的反射率来建模，混合用 Kubelka–Munk——颜料层混合的标准近似。所以青加黄是干净的绿，而红加蓝是浑褐：红颜料吸收蓝、蓝颜料吸收红，红蓝混在一起两边都丢了。',
  'howto.access.title': '色盲支持',
  'howto.access.body': '每个调色板颜色都带一个符号和一种纹理，忽略颜色也能读懂棋盘。在设置里打开纹理叠加就能在色块上看到。',
  'howto.controls': '操作',
  'howto.key.pick': '选择颜料',
  'howto.key.click': '作用到一个色块',
  'howto.key.undo': '撤销',
  'howto.key.reset': '重置棋盘',
  'howto.key.hint': '看一个解法',
  'howto.key.drag': '拖拽环绕 · 滚轮缩放 · 右键拖拽平移',
  'howto.key.recentre': '回到正面',
  'howto.key.pause': '暂停',
  'howto.back': '返回',

  'settings.title': '设置',
  'settings.language': '语言',
  'settings.language.help': '界面与关卡名称。',
  'settings.audio': '声音',
  'settings.music': '音乐',
  'settings.sfx': '音效',
  'settings.access': '无障碍',
  'settings.patterns': '色盲纹理',
  'settings.patterns.help': '给每个色块叠加符号纹理，不用颜色也能区分各种混合。',
  'settings.reducedMotion': '减弱动效',
  'settings.reducedMotion.help': '缩短转场，并停止相机视差与颗粒。',
  'settings.quality': '画质',
  'settings.quality.help': '辉光是最贵的效果。如果画面卡顿就调低。',
  'settings.quality.high': '高',
  'settings.quality.medium': '中',
  'settings.quality.low': '低',
  'settings.reset': '清除进度',
  'settings.reset.help': '清除本设备上所有已归位的棋盘与最好成绩。',
  'settings.reset.confirm': '确定清除全部进度？',
  'settings.reset.yes': '清除',
  'settings.reset.no': '保留',
  'settings.back': '返回',
  'settings.on': '开',
  'settings.off': '关',

  'lab.eyebrow': '没有谜题，只有模型',
  'lab.title': '调色实验室',
  'lab.lede': '往罐子里加颜料，看它们混成什么。下面列的是模型实际存下的反射率；色卡是那个反射率在屏幕上的样子。',
  'lab.pot': '罐子里',
  'lab.empty': '空',
  'lab.add': '加入',
  'lab.clear': '倒空',
  'lab.reflectance': '反射率（R、G、B）',
  'lab.allMixes': '这套调色板的全部混合',
  'lab.palette': '调色板',
  'lab.back': '返回',

  'credits.title': '制作说明',
  'credits.engine': '引擎',
  'credits.engineBody': 'three.js，MIT 许可，已 vendor 到 vendor/three。',
  'credits.colour': '色彩科学',
  'credits.colourBody': 'OKLab 由 Björn Ottosson 提出。颜料混合用 Kubelka–Munk。薄膜虹彩用 Belcour &amp; Barla 的近似，即 three.js 中的实现。',
  'credits.grids': '网格几何',
  'credits.gridsBody': '六边形坐标沿用 Red Blob Games 记录的约定。三角网格是从几何推导出来的，并由 tools/validate-grid.mjs 校验。',
  'credits.type': '字体',
  'credits.typeBody': '系统字体栈，简体中文使用 Noto Sans SC。',
  'credits.audio': '音频',
  'credits.audioBody': '所有声音都由 WebAudio 在运行时生成，没有任何音频文件。',
  'credits.note': '没有从任何游戏里复制素材。解谜这个类型很老、属于所有人；但颜料、棋盘和这些文字都是本项目自己的。',

  'pause.title': '已暂停',
  'pause.resume': '继续',
  'pause.restart': '重开这一盘',
  'pause.quit': '退出到章节',
  'pause.settings': '设置',

  'misc.close': '关闭',
  'misc.back': '返回',
  'misc.next': '下一个',
  'misc.of': '/',
};

const TABLES = { en: EN, zh: ZH };

let locale = 'en';

/** Resolve a locale setting ('auto' | 'en' | 'zh') to a concrete code. */
export function resolveLocale(setting) {
  if (setting === 'en' || setting === 'zh') return setting;
  const langs = typeof navigator !== 'undefined'
    ? [...(navigator.languages ?? []), navigator.language ?? '']
    : [];
  for (const l of langs) {
    if (!l) continue;
    if (/^zh/i.test(l)) return 'zh';
    if (/^en/i.test(l)) return 'en';
  }
  return 'en';
}

export function setLocale(setting) {
  locale = resolveLocale(setting);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en';
    document.title = t('doc.title');
  }
  return locale;
}

export function getLocale() { return locale; }

/** Interpolate {placeholders}. Missing values are left as the raw placeholder. */
function fill(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

/** UI chrome lookup. */
export function t(key, vars) {
  const table = TABLES[locale] ?? EN;
  const str = table[key] ?? EN[key] ?? key;
  return fill(str, vars);
}

/**
 * Content lookup, keyed by the English source string. Used for level, chapter and
 * album names that live in the generated data files.
 */
export function tSource(text, vars) {
  if (text === undefined || text === null) return '';
  if (locale === 'en') return fill(String(text), vars);
  const table = TABLES[locale] ?? EN;
  const str = table[`src.${text}`] ?? text;
  return fill(str, vars);
}

/**
 * Pick the localised field off a data record. Records from the level file carry
 * `name`/`nameZh` style pairs, so this keeps the choice in one place instead of
 * sprinkling `locale === 'zh' ? x.nameZh : x.name` through the UI.
 */
export function pick(record, base) {
  if (!record) return '';
  if (locale === 'zh') return record[`${base}Zh`] ?? record[base] ?? '';
  return record[base] ?? record[`${base}Zh`] ?? '';
}

export const isZh = () => locale === 'zh';
