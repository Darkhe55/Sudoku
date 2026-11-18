/**
 * 通用谜题应用 —— 主逻辑
 *
 * 布局 / 会话 / 撤销重做 / 题库 / 自定义题板 / 逻辑回放 / 缩放平移 / 快捷键
 * 全部由本文件提供，只依赖 GameAdapter 契约。
 *
 * 新游戏入口：src/main.ts 里 `createApp(document.querySelector('#app'), adapter)`。
 */

import './styles.css'
import type { GameAdapter, GameState, Move, Puzzle } from './types'
import { $, on } from './ui'
import { ViewController, clientToViewBox } from './view'
import { LogicPlayer } from './playback'
import { CustomEditor } from './custom'
import { flashForMove } from './fx'
import { isMuted, resumeAudio, setMuted } from './audio'
import {
  loadSavedPuzzles,
  removeSavedPuzzle,
  savePuzzleToLibrary,
  type PuzzleCodec,
} from './library'
import {
  clearProgress,
  initStore,
  readLastPuzzle,
  readProgress,
  storeInProject,
  storeLocationLabel,
  writeLastPuzzle,
  writeProgress,
  type ProgressEntry,
} from './store'

interface Session {
  puzzle: Puzzle
  state: GameState
  undo: Move[]
  redo: Move[]
}

export function createApp(root: HTMLElement, adapter: GameAdapter) {
  const meta = adapter.meta
  const customMode = adapter.custom.mode ?? 'cell'
  const interactionHint =
    meta.interactionHint ??
    (meta.targetKind === 'edge'
      ? '<kbd>左键</kbd> 画边 · <kbd>右键</kbd> 清除'
      : meta.targetKind === 'vertex'
        ? '<kbd>左键</kbd> 标记顶点 · <kbd>右键</kbd> 清除'
        : '<kbd>左键</kbd> 选中格子 · <kbd>数字/面板</kbd> 填入选中格')

  /* ———————————————————— 静态 DOM ———————————————————— */

  root.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>${meta.title}</h1>
      <p>${meta.tagline}</p>
    </div>
  </header>

  <div class="layout">
    <aside class="panel">
      <h2>题面</h2>
      <div class="toolbar" style="margin-top:0">
        <button class="btn" id="btn-random" type="button">随机抽题</button>
        <button class="btn" id="btn-custom" type="button">自定义</button>
        <button class="btn" id="btn-mute" type="button">音效：开</button>
      </div>
      <div class="puzzle-list" id="puzzle-list"></div>

      <div class="custom-editor" id="custom-editor" hidden>
        <h2>自定义题板</h2>
        <div class="custom-row">
          <label>宽 <input id="custom-w" type="number" min="${meta.customMinW}" max="${meta.customMaxW}" value="${Math.max(meta.customMinW, Math.min(meta.customMaxW, 9))}" /></label>
          <label>高 <input id="custom-h" type="number" min="${meta.customMinH}" max="${meta.customMaxH}" value="${Math.max(meta.customMinH, Math.min(meta.customMaxH, 9))}" /></label>
          <button class="btn" id="custom-regen" type="button">生成网格</button>
        </div>
        <div class="custom-hint" id="custom-hint"></div>
        <div class="custom-grid" id="custom-grid"></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn primary" id="custom-apply" type="button">载入题板</button>
          <button class="btn" id="custom-save" type="button">保存到题库</button>
          <button class="btn" id="custom-solve" type="button">求解</button>
          <button class="btn" id="custom-logic" type="button">逻辑解题</button>
          <button class="btn danger" id="custom-close" type="button">关闭</button>
        </div>
        <div class="custom-msg" id="custom-msg"></div>
      </div>

      <div class="toolbar">
        <button class="btn primary" id="btn-check" type="button">检查</button>
        <button class="btn" id="btn-undo" type="button">撤销</button>
        <button class="btn" id="btn-redo" type="button">重做</button>
        <button class="btn" id="btn-hint" type="button">提示一格</button>
        <button class="btn" id="btn-logic" type="button">逻辑解题</button>
        <button class="btn" id="btn-solve" type="button">显示解</button>
        <button class="btn danger" id="btn-clear" type="button">清空</button>
      </div>

      <div class="status" id="status">选择左侧题目开始。</div>

      <div class="legend">
        <div>${interactionHint}</div>
        <div><kbd>数字面板</kbd> 先选格，再点数字写入 · 「清除」清空 · 「笔记」切换候选数（<kbd>N</kbd>）</div>
        <div><kbd>方向键</kbd> 移动选中格 · 输入后不自动跳格</div>
        <div><kbd>滚轮</kbd> 缩放 · <kbd>中键/空白拖拽</kbd> 平移画布 · <kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> 放大/缩小/复位</div>
        <div><kbd>Z</kbd> / <kbd>Shift+Z</kbd> 撤销 / 重做</div>
        <div><kbd>C</kbd> 检查 · <kbd>Esc</kbd> 清空 · <kbd>L</kbd> 逻辑解题/停止回放 · <kbd>P</kbd> 暂停/继续</div>
        <div><kbd>R</kbd> 随机 · <kbd>M</kbd> 音效开关</div>
      </div>
    </aside>

    <main class="panel board-wrap" id="board-wrap">
      <div class="zoom-bar">
        <button class="btn" id="zoom-out" type="button" title="缩小">−</button>
        <span class="zoom-label" id="zoom-label">100%</span>
        <button class="btn" id="zoom-in" type="button" title="放大">+</button>
        <button class="btn" id="zoom-reset" type="button">复位</button>
      </div>
      <div class="board-stage">
        <div class="value-palette" id="value-palette" hidden></div>
        <div id="board"></div>
      </div>
    </main>
  </div>

  <p class="footer-note">${meta.footerNote}</p>
`

  // 顶栏品牌提示（部分游戏有额外一行）
  const hintEl = document.getElementById('custom-hint')
  if (hintEl) {
    if (customMode === 'none') {
      hintEl.textContent = '本游戏暂不支持自定义题板。'
    } else if (customMode === 'edge') {
      const cycle = (adapter.custom.edgeValueCycle ?? [])
        .map((v) => adapter.custom.edgeLabel?.(v) ?? String(v))
        .join(' → ')
      hintEl.textContent = `点击边循环：${cycle} ｜ ${adapter.custom.hint}`
    } else {
      const cycle = (
        adapter.custom.valueCycleFor?.(meta.customMinW, meta.customMinH) ??
        adapter.custom.valueCycle
      )
      hintEl.textContent = `点击循环：${cycle
        .map((v) => adapter.custom.cellLabel(v))
        .join(' → ')} ｜ ${adapter.custom.hint}`
    }
  }

  if (customMode === 'none') {
    const btn = document.getElementById('btn-custom') as HTMLButtonElement | null
    if (btn) {
      btn.disabled = true
      btn.textContent = '自定义（不支持）'
    }
  }

  /* ———————————————————— 会话 ———————————————————— */

  let session: Session | null = null
  let pendingDeleteId: string | null = null
  let library: Puzzle[] = [...adapter.builtinPuzzles]
  /** 当前选中的格子：左键/右键点格选中；键盘与数字面板都写入这里 */
  let cursor: number | null = null
  /** 笔记（候选数）模式：开启后数字按钮/数字键只切换候选数，不写正式数字 */
  let notesMode = false

  const codec: PuzzleCodec = {
    encode: (p) => adapter.custom.encodePuzzle(p),
    decode: (r) => adapter.custom.decodePuzzle(r),
  }

  function refreshLibrary(): void {
    const saved = loadSavedPuzzles(codec)
    library = [...saved, ...adapter.builtinPuzzles]
  }

  function findPuzzle(id: string): Puzzle | undefined {
    return library.find((p) => p.id === id) || adapter.builtinPuzzles.find((p) => p.id === id)
  }

  function sortedLibrary(): Puzzle[] {
    const rank = (p: Puzzle) => (p.difficulty === 'custom' ? 0 : 1)
    return [...library].sort((a, b) => rank(a) - rank(b))
  }

  function difficultyLabel(d: Puzzle['difficulty']): string {
    return d === 'easy' ? '入门' : d === 'medium' ? '进阶' : d === 'custom' ? '自定义' : '挑战'
  }

  function setStatus(text: string, tone: 'ok' | 'bad' | 'solving' | '' = ''): void {
    const el = $('#status')
    el.textContent = text
    el.className = 'status' + (tone ? ` ${tone}` : '')
  }

  /* ———————————————————— 数字面板 / 光标 ———————————————————— */

  /** 当前题面最大可填值（= max(width, height)） */
  function paletteMax(): number {
    if (!session) return 0
    return Math.max(1, Math.min(36, Math.max(session.puzzle.width, session.puzzle.height)))
  }

  function paletteLabel(v: number | null): string {
    if (v === null) return '清除'
    return v <= 9 ? String(v) : String.fromCharCode(65 + (v - 10))
  }

  /**
   * 数字面板：先选中格子，再点数字按钮直接写入该格；「清除」清空选中格。
   * 「笔记」按钮（或 N 键）切换候选数模式：开启后数字按钮只切换该格候选数。
   * 没有选中格时只提示、不落子（不再有「先选数字再点格」的循环模式）。
   */
  function renderPalette(): void {
    const el = document.getElementById('value-palette')
    if (!el) return
    const n = paletteMax()
    if (!session || n < 1) {
      el.hidden = true
      el.innerHTML = ''
      return
    }
    el.hidden = false
    el.classList.toggle('wide', n > 9)
    const values: Array<number | null> = [...Array.from({ length: n }, (_, i) => i + 1), null]
    const valueButtons = values
      .map((v) => {
        const cls = `palette-btn${v === null ? ' clear' : ''}`
        const label = paletteLabel(v)
        const title =
          v === null
            ? '清空当前选中格（笔记模式下清空候选数）'
            : notesMode
              ? `切换候选数 ${label}`
              : `把 ${label} 写入当前选中格`
        return `<button class="${cls}" type="button" data-value="${v === null ? 'clear' : v}" title="${title}">${label}</button>`
      })
      .join('')
    const notesButton = `<button class="palette-btn notes${notesMode ? ' active' : ''}" type="button" data-value="notes" title="笔记模式：数字只切换候选数（快捷键 N）">笔记</button>`
    el.innerHTML = valueButtons + notesButton
    el.querySelectorAll<HTMLButtonElement>('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        resumeAudio()
        const raw = btn.dataset.value
        if (raw === 'notes') {
          toggleNotesMode()
          return
        }
        if (cursor === null) {
          setStatus('先点选一个格子，再点数字按钮填入。', 'bad')
          return
        }
        const value = raw === 'clear' ? 0 : Number(raw)
        if (notesMode) {
          if (value === 0) clearNotes(cursor)
          else toggleNote(cursor, value)
          return
        }
        writeCell(cursor, value)
      })
    })
    markPaletteCurrent()
  }

  /** 切换笔记（候选数）模式：数字按钮/数字键改为切换候选数 */
  function toggleNotesMode(): void {
    notesMode = !notesMode
    renderPalette()
    setStatus(
      notesMode
        ? '笔记模式：开（数字按钮/数字键切换候选数，N 关闭）'
        : '笔记模式：关（数字按钮/数字键写入正式数字）',
    )
  }

  /** 候选数 v 的 bitmask 位（bit v-1） */
  function noteBit(value: number): number {
    return 2 ** (value - 1)
  }

  /** 切换某格候选数；只对空格生效（given 格/已有正式数字格会忽略） */
  function toggleNote(index: number, value: number): void {
    if (!session) return
    const before = adapter.noteMaskAt(session.state, index)
    const after = before ^ noteBit(value)
    if (before === after) return
    pushMove({ index, from: before, to: after, kind: 'note' })
    if (adapter.noteMaskAt(session.state, index) === before) {
      // 空格以外的格子 applyMove 会忽略，撤销掉这条无效 undo 记录
      session.undo.pop()
      setStatus('候选数只能添加在空格上。', 'bad')
      return
    }
    refresh()
  }

  /** 清空某格候选数（支持撤销 / 重做） */
  function clearNotes(index: number): void {
    if (!session) return
    const before = adapter.noteMaskAt(session.state, index)
    if (before === 0) return
    pushMove({ index, from: before, to: 0, kind: 'note' })
    if (adapter.noteMaskAt(session.state, index) === before) session.undo.pop()
    refresh()
  }

  /** 面板高亮：正式数字模式高亮当前格数字；笔记模式高亮当前格已有候选 */
  function markPaletteCurrent(): void {
    const el = document.getElementById('value-palette')
    if (!el) return
    const current = session && cursor !== null ? adapter.valueAt(session.state, cursor) : 0
    const mask = session && cursor !== null && notesMode ? adapter.noteMaskAt(session.state, cursor) : 0
    el.querySelectorAll<HTMLButtonElement>('.palette-btn').forEach((btn) => {
      const raw = btn.dataset.value
      if (raw === 'notes') {
        btn.classList.toggle('active', notesMode)
        return
      }
      const v = raw === 'clear' ? 0 : Number(raw)
      const active =
        v !== 0 &&
        (notesMode ? Math.floor(mask / noteBit(v)) % 2 === 1 : v === current)
      btn.classList.toggle('active', active)
    })
  }

  /** 选中格子（只更新高亮，不重绘整盘；输入后保持选中、不自动跳格） */
  function setCursor(index: number | null): void {
    cursor = index
    const board = document.getElementById('board')
    board?.querySelectorAll('.cell-hit.selected').forEach((el) => el.classList.remove('selected'))
    if (index !== null) {
      board?.querySelector(`.cell-hit[data-index="${index}"]`)?.classList.add('selected')
    }
    markPaletteCurrent()
  }

  /** 直接给某格写值（键盘 / 数字面板用） */
  function writeCell(index: number, value: number): void {
    if (!session) return
    const before = adapter.valueAt(session.state, index)
    if (before === value) {
      // 重复按「清除」时，把该格残留的候选数也一起清掉
      if (value === 0) clearNotes(index)
      return
    }
    pushMove({ index, from: before, to: value })
    // 预填格 applyMove 会被忽略，撤销掉这条无效 undo 记录
    if (adapter.valueAt(session.state, index) === before) session.undo.pop()
    refresh()
  }

  /* ———————————————————— 题库列表 ———————————————————— */

  function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        default:
          return '&#39;'
      }
    })
  }

    function renderPuzzleList(): void {
    refreshLibrary()
    const list = $('#puzzle-list')
    list.innerHTML = sortedLibrary()
      .map((p) => {
        const active = session?.puzzle.id === p.id ? ' active' : ''
        const isCustom = p.difficulty === 'custom' && p.editable !== false
        const confirming = pendingDeleteId === p.id
        const actions = isCustom
          ? `<button class="puzzle-act" type="button" data-edit="${escapeHtml(p.id)}" title="编辑题面">编辑</button>` +
            `<button class="puzzle-act danger${confirming ? ' confirm' : ''}" type="button" data-del="${escapeHtml(p.id)}" title="${confirming ? '再点一次确认删除' : '从题库删除'}">${confirming ? '确认' : '×'}</button>`
          : ''
        return `
          <div class="puzzle-row">
            <button class="puzzle-item${active}" data-id="${escapeHtml(p.id)}" type="button">
              <span class="title">${escapeHtml(p.name)}</span>
              <span class="meta">${p.width}×${p.height} · ${difficultyLabel(p.difficulty)}</span>
            </button>
            ${actions}
          </div>
        `
      })
      .join('')
    list.querySelectorAll<HTMLButtonElement>('.puzzle-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.id ? findPuzzle(btn.dataset.id) : undefined
        if (p) selectPuzzle(p)
      })
    })
    list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.edit
        if (id) editPuzzle(id)
      })
    })
    list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del
        if (!id) return
        if (pendingDeleteId === id) deletePuzzle(id)
        else {
          pendingDeleteId = id
          renderPuzzleList()
        }
      })
    })
  }


  // 删除二次确认：点击其它位置自动取消，避免误触
  document.addEventListener('click', (e) => {
    if (!pendingDeleteId) return
    const target = e.target as Element | null
    if (target?.closest('[data-del]')) return
    pendingDeleteId = null
    renderPuzzleList()
  })


  /* ———————————————————— 校验与状态 ———————————————————— */

  function currentResult() {
    if (!session) return null
    return adapter.validate(session.state, session.puzzle)
  }

  function renderBoardOnly(): void {
    if (!session) return
    const result = adapter.validate(session.state, session.puzzle)
    const svg = adapter.renderBoard(session.puzzle, session.state, result)
    const board = $('#board')
    board.innerHTML = svg
    bindBoardEvents()
    view.apply(board.querySelector<SVGSVGElement>('svg.board-svg'))
    if (cursor !== null && cursor >= session.puzzle.width * session.puzzle.height) {
      cursor = null
    }
    setCursor(cursor)
  }

  function refresh(): void {
    renderPuzzleList()
    renderBoardOnly()
    renderPalette()
    if (!session) return
    const result = currentResult()
    if (!result) return
    if (result.solved) {
      setStatus('完成！答案完全正确。', 'ok')
      return
    }
    const bits = adapter.statusBits(result)
    setStatus(bits.join(' · ') || '尚未完成')
  }

  /* ———————————————————— 会话控制 ———————————————————— */

  function loadSave(puzzleId: string): GameState | null {
    try {
      const data = readProgress(puzzleId)
      if (!data) return null
      return adapter.deserializeState(data)
    } catch {
      return null
    }
  }

  function saveState(): void {
    if (!session) return
    writeProgress(adapter.serializeState(session.state) as ProgressEntry)
  }

  function selectPuzzle(puzzle: Puzzle): void {
    logicPlayer.stop()
    const saved = loadSave(puzzle.id)
    session = {
      puzzle,
      state: saved ?? adapter.createEmptyState(puzzle),
      undo: [],
      redo: [],
    }
    cursor = null
    notesMode = false
    writeLastPuzzle(puzzle.id)
    view.reset()
    refresh()
    setStatus(`已载入「${puzzle.name}」。`)
  }

  function pushMove(move: Move): void {
    if (!session) return
    adapter.applyMove(session.state, move)
    session.undo.push(move)
    session.redo.length = 0
    saveState()
  }

  /* ———————————————————— 棋盘交互 ———————————————————— */

  function bindBoardEvents(): void {
    const board = $('#board')
    const svg = board.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return

    view.apply(svg)

    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })

    let dragging = false
    /** 本次拖动是否为平移（中键按下，或左键从空白处起拖） */
    let panning = false
    let dragMoved = false
    let lastClient = { x: 0, y: 0 }

    const hitAt = (e: PointerEvent) => {
      if (!session) return null
      const vb = clientToViewBox(svg, e.clientX, e.clientY)
      if (!vb) return null
      const m = adapter.metricsFor(session.puzzle)
      return adapter.hitTest(m, session.puzzle, vb.x, vb.y)
    }

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        const vb = clientToViewBox(svg, e.clientX, e.clientY)
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        view.setZoom(view.zoom * factor, vb ?? undefined)
      },
      { passive: false },
    )

    svg.addEventListener('pointerdown', (e) => {
      resumeAudio()
      if (e.button === 1) {
        // 中键拖动平移（滚轮缩放后也可用）
        e.preventDefault()
        dragging = true
        panning = true
        dragMoved = false
        lastClient = { x: e.clientX, y: e.clientY }
        svg.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 2) {
        // 右键不再是数字输入方式：只选中格子，不写入
        const hit = hitAt(e)
        if (hit) setCursor(hit.index)
        return
      }
      if (e.button !== 0) return

      // 左键：命中格子只选中（不写入、不循环、不拖动涂写）；
      // 点空白处取消选中，并允许从空白处拖动平移
      const hit = hitAt(e)
      lastClient = { x: e.clientX, y: e.clientY }
      dragging = true
      panning = !hit
      dragMoved = false
      setCursor(hit ? hit.index : null)
      svg.setPointerCapture(e.pointerId)
    })

    svg.addEventListener('pointermove', (e) => {
      // 只有平移拖动会响应；左键在格子上拖动不做任何写入
      if (!dragging || !panning) return
      const dx = e.clientX - lastClient.x
      const dy = e.clientY - lastClient.y
      if (!dragMoved && Math.hypot(dx, dy) < 6) return
      dragMoved = true
      const rect = svg.getBoundingClientRect()
      view.panBy(dx, dy, svg, rect.width, rect.height)
      lastClient = { x: e.clientX, y: e.clientY }
    })

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      panning = false
      dragMoved = false
      try {
        svg.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    svg.addEventListener('pointerup', endDrag)
    svg.addEventListener('pointercancel', endDrag)
  }

  /* ———————————————————— 撤销 / 重做 / 清空 ———————————————————— */

  function undo(): void {
    if (!session || !session.undo.length) return
    const move = session.undo.pop()!
    const inv = adapter.invertMove(move)
    adapter.applyMove(session.state, inv)
    session.redo.push(move)
    saveState()
    refresh()
  }

  function redo(): void {
    if (!session || !session.redo.length) return
    const move = session.redo.pop()!
    adapter.applyMove(session.state, move)
    session.undo.push(move)
    saveState()
    refresh()
  }

  function clearBoard(): void {
    if (!session) return
    logicPlayer.stop()
    session.state = adapter.createEmptyState(session.puzzle)
    session.undo = []
    session.redo = []
    saveState()
    refresh()
    setStatus('已清空当前盘面。')
  }

  /* ———————————————————— 检查 / 提示 / 显示解 ———————————————————— */

  function check(): void {
    const result = currentResult()
    if (!session || !result) return
    if (result.solved) {
      setStatus('正确！', 'ok')
    } else {
      const parts = adapter.statusBits(result)
      setStatus(parts.join(' · ') || '还差一点', 'bad')
    }
    refresh()
  }

  function showSolution(): void {
    if (!session) return
    const sol = adapter.getReferenceSolution(session.puzzle.id)
    if (sol) {
      session.state = adapter.cloneState(sol)
      session.undo = []
      session.redo = []
      saveState()
      refresh()
      setStatus('已填入参考解。', 'ok')
      return
    }
    const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
    if (!r.solved || !r.solution) {
      setStatus(r.timedOut ? '求解超时。' : '无解或题面矛盾。', 'bad')
      return
    }
    session.state = adapter.cloneState(r.solution)
    session.undo = []
    session.redo = []
    saveState()
    refresh()
    setStatus('已填入一组可行解。', 'ok')
  }

  function hint(): void {
    if (!session) return
    let sol = adapter.getReferenceSolution(session.puzzle.id)
    if (!sol) {
      const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
      if (!r.solved || !r.solution) {
        setStatus('暂时给不出提示。', 'bad')
        return
      }
      sol = r.solution
    }
    const move = adapter.firstHintMove(session.state, sol)
    if (move) {
      pushMove(move)
      refresh()
      setStatus('已提示一格。', 'ok')
    } else {
      setStatus('当前已与可行解一致，或无未知格可提示。', 'ok')
    }
  }

  /* ———————————————————— 缩放 ———————————————————— */

  const view = new ViewController(
    () => {
      if (!session) return { cell: 48, pad: 16, width: 5, height: 5, svgWidth: 400, svgHeight: 400, k: 1 }
      return adapter.metricsFor(session.puzzle)
    },
    (label) => {
      const el = document.getElementById('zoom-label')
      if (el) el.textContent = label
    },
  )

  /* ———————————————————— 逻辑解题回放 ———————————————————— */

  let logicButtonsDisabled = false

  function setButtonsDisabled(disabled: boolean): void {
    logicButtonsDisabled = disabled
    for (const id of ['btn-check', 'btn-undo', 'btn-redo', 'btn-hint', 'btn-solve', 'btn-clear'] as const) {
      const el = document.getElementById(id) as HTMLButtonElement | null
      if (el) el.disabled = disabled
    }
    const board = document.getElementById('board')
    if (board) board.style.pointerEvents = disabled ? 'none' : ''
    updateLogicButton()
  }

  function updateLogicButton(): void {
    const btn = document.getElementById('btn-logic') as HTMLButtonElement | null
    if (!btn) return
    if (logicPlayer.playing) {
      btn.textContent = '停止回放'
      btn.classList.remove('primary')
      btn.classList.add('danger')
    } else {
      btn.textContent = '逻辑解题'
      btn.classList.add('primary')
      btn.classList.remove('danger')
    }
    btn.disabled = logicButtonsDisabled && !logicPlayer.playing
  }

  function flash(move: Move, streak: number): void {
    if (!session) return
    adapter.playForMove(move, streak)
    const svg = document.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return
    const m = adapter.metricsFor(session.puzzle)
    if (adapter.flashForMove) adapter.flashForMove(svg, move, streak, m)
    else flashForMove(svg, move, streak, m)
  }

  const logicPlayer = new LogicPlayer(adapter, {
    setStatus,
    pushMove,
    render: () => renderBoardOnly(),
    flash,
    samePuzzle: (id) => session?.puzzle.id === id,
    currentPuzzle: () => session?.puzzle ?? null,
    setButtonsDisabled,
    restoreState: (base, moves) => {
      if (!session) return
      session.state = adapter.cloneState(base)
      session.undo = []
      session.redo = []
      for (const move of moves) adapter.applyMove(session.state, move)
      saveState()
      renderBoardOnly()
    },
    onStateChange: () => updateLogicButton(),
    onFinished: (_saturated, frames) => {
      updateLogicButton()
      if (session) {
        const result = currentResult()
        if (result?.solved) setStatus(`逻辑解题完成（${frames} 帧），盘面已解出。`, 'ok')
        else setStatus(`回放完毕（${frames} 帧）。`, 'ok')
      }
    },
  })

  function runLogicSolver(): void {
    if (!session || logicPlayer.playing) return
    const snapshot = adapter.cloneState(session.state)
    void logicPlayer.start(session.puzzle, snapshot)
  }

  function stopLogic(): void {
    logicPlayer.stop()
    updateLogicButton()
  }

  /* ———————————————————— 自定义题板 ———————————————————— */

  const custom = new CustomEditor(adapter, {
    setStatus,
    message: (text, tone = '') => {
      const el = document.getElementById('custom-msg')
      if (!el) return
      el.textContent = text
      el.className = 'custom-msg' + (tone ? ` ${tone}` : '')
    },
    loadPuzzle: (p) => {
      // 载入即入库：稳定 id 保证进度可续
      const saved = savePuzzleToLibrary(p, codec)
      refreshLibrary()
      logicPlayer.stop()
      session = {
        puzzle: saved.find((x) => x.id === p.id) ?? p,
        state: adapter.createEmptyState(p),
        undo: [],
        redo: [],
      }
      writeLastPuzzle(p.id)
      view.reset()
      refresh()
      setStatus(`已载入自定义 ${p.width}×${p.height}，并存入题库（刷新后仍在列表里）。`)
    },
    savePuzzle: (p) => {
      savePuzzleToLibrary(p, codec)
      refreshLibrary()
      renderPuzzleList()
    },
    solveCurrent: () => {
      if (!session || !session.puzzle.id.startsWith(meta.customIdPrefix)) {
        setStatus('请先载入自定义题板。', 'bad')
        return
      }
      const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
      const msg = document.getElementById('custom-msg')
      if (!r.solved || !r.solution) {
        setStatus(r.timedOut ? '求解超时：盘面过大或题面矛盾/无解。' : '无解或题面矛盾。', 'bad')
        if (msg) {
          msg.textContent = r.timedOut ? '求解超时，可先「逻辑解题」再求解。' : '无解或题面矛盾。'
          msg.className = 'custom-msg bad'
        }
        return
      }
      session.state = adapter.cloneState(r.solution)
      session.undo = []
      session.redo = []
      saveState()
      refresh()
      setStatus(`自定义盘已求解（搜索 ${r.nodes} 节点）。`, 'ok')
      if (msg) {
        msg.textContent = `求解成功（搜索 ${r.nodes} 节点）。`
        msg.className = 'custom-msg ok'
      }
    },
    runLogic: () => {
      if (!session) return
      runLogicSolver()
    },
  })

  /* ———————————————————— 自定义题管理 ———————————————————— */

  function editPuzzle(id: string): void {
    const puzzle = findPuzzle(id)
    if (!puzzle || puzzle.difficulty !== 'custom') return
    custom.edit(puzzle)
  }

  function deletePuzzle(id: string): void {
    const puzzle = findPuzzle(id)
    if (!puzzle || puzzle.difficulty !== 'custom') return
    pendingDeleteId = null
    const wasCurrent = session?.puzzle.id === id
    custom.clearEditing(id)
    removeSavedPuzzle(id, codec)
    clearProgress(id)
    refreshLibrary()
    if (wasCurrent) {
      const next = sortedLibrary()[0]
      if (next) {
        selectPuzzle(next)
      } else {
        session = null
        $('#board').innerHTML = ''
        $('#zoom-label').textContent = '100%'
        renderPuzzleList()
      }
    } else {
      renderPuzzleList()
    }
    setStatus(`已删除「${puzzle.name}」。`, 'ok')
  }

  /* ———————————————————— 按钮绑定 ———————————————————— */

  on($('#btn-check'), 'click', check)
  on($('#btn-undo'), 'click', undo)
  on($('#btn-redo'), 'click', redo)
  on($('#btn-clear'), 'click', clearBoard)
  on($('#btn-solve'), 'click', showSolution)
  on($('#btn-hint'), 'click', hint)
  on($('#btn-random'), 'click', pickRandomPuzzle)
  on($('#btn-mute'), 'click', toggleMute)
  on($('#btn-custom'), 'click', () => custom.open())
  on($('#custom-regen'), 'click', () => custom.regen())
  on($('#custom-apply'), 'click', () => custom.load())
  on($('#custom-save'), 'click', () => custom.save())
  on($('#custom-solve'), 'click', () => custom.solve())
  on($('#custom-logic'), 'click', () => custom.logic())
  on($('#custom-close'), 'click', () => custom.close())
  on($('#btn-logic'), 'click', () => {
    resumeAudio()
    if (logicPlayer.playing) stopLogic()
    else runLogicSolver()
  })
  on($('#zoom-in'), 'click', () => view.zoomIn())
  on($('#zoom-out'), 'click', () => view.zoomOut())
  on($('#zoom-reset'), 'click', () => {
    view.reset()
    view.apply(document.querySelector<SVGSVGElement>('svg.board-svg'))
  })

  function pickRandomPuzzle(): void {
    refreshLibrary()
    const cur = session?.puzzle.id
    const pool = cur ? library.filter((p) => p.id !== cur) : library
    const list = pool.length ? pool : library
    const p = list[Math.floor(Math.random() * list.length)]!
    selectPuzzle(p)
    setStatus(`随机抽到「${p.name}」。`)
  }

  function toggleMute(): void {
    const next = !isMuted()
    setMuted(next)
    const btn = document.getElementById('btn-mute')
    if (btn) btn.textContent = next ? '音效：关' : '音效：开'
    if (!next) resumeAudio()
  }

  /* ———————————————————— 快捷键 ———————————————————— */

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    // 待确认删除时，Esc 先取消确认
    if (e.key === 'Escape' && pendingDeleteId) {
      e.preventDefault()
      pendingDeleteId = null
      renderPuzzleList()
      return
    }
    // 自定义题板键盘录入优先
    if (custom.handleKey(e)) return

    // N 键切换笔记（候选数）模式
    if (
      session &&
      !custom.isOpen() &&
      (e.key === 'n' || e.key === 'N') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault()
      toggleNotesMode()
      return
    }

    // 棋盘键盘输入：数字 / Shift+字母 / 退格 / 方向键（需先点选格子）
    if (session && cursor !== null) {
      const w = session.puzzle.width
      const size = session.puzzle.width * session.puzzle.height
      const n = Math.max(1, Math.min(36, Math.max(session.puzzle.width, session.puzzle.height)))
      const single = e.key.length === 1
      if (single && e.key >= '1' && e.key <= '9' && Number(e.key) <= n) {
        e.preventDefault()
        if (notesMode) toggleNote(cursor, Number(e.key))
        else writeCell(cursor, Number(e.key))
        return
      }
      if (single && e.shiftKey && e.key >= 'A' && e.key <= 'Z') {
        const v = 10 + (e.key.charCodeAt(0) - 65)
        if (v <= n) {
          e.preventDefault()
          if (notesMode) toggleNote(cursor, v)
          else writeCell(cursor, v)
          return
        }
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        if (notesMode) clearNotes(cursor)
        else writeCell(cursor, 0)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        if (notesMode) clearNotes(cursor)
        else writeCell(cursor, 0)
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        let next = cursor
        if (e.key === 'ArrowLeft') next = cursor % w === 0 ? cursor : cursor - 1
        else if (e.key === 'ArrowRight') next = cursor % w === w - 1 ? cursor : cursor + 1
        else if (e.key === 'ArrowUp') next = cursor - w >= 0 ? cursor - w : cursor
        else if (e.key === 'ArrowDown') next = cursor + w < size ? cursor + w : cursor
        setCursor(next)
        return
      }
    }

    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault()
      redo()
    } else if (k === 'c') {
      e.preventDefault()
      check()
    } else if (k === 'l') {
      e.preventDefault()
      if (logicPlayer.playing) stopLogic()
      else runLogicSolver()
    } else if (k === 'p') {
      e.preventDefault()
      logicPlayer.togglePause()
    } else if (k === 'r') {
      e.preventDefault()
      pickRandomPuzzle()
    } else if (k === 'm') {
      e.preventDefault()
      toggleMute()
    } else if (k === '+' || k === '=') {
      e.preventDefault()
      view.zoomIn()
    } else if (k === '-' || k === '_') {
      e.preventDefault()
      view.zoomOut()
    } else if (k === '0') {
      e.preventDefault()
      view.reset()
      view.apply(document.querySelector<SVGSVGElement>('svg.board-svg'))
    } else if (k === 'escape') {
      clearBoard()
    }
  })

  /* ———————————————————— 启动 ———————————————————— */

  void (async () => {
    try {
      await initStore({ prefix: meta.storageKeyPrefix })
      refreshLibrary()
      let boot: Puzzle | undefined
      const lastId = readLastPuzzle()
      if (lastId) boot = findPuzzle(lastId)
      if (!boot) boot = sortedLibrary()[0]
      if (boot) selectPuzzle(boot)
      else setStatus('没有可用题面。', 'bad')
      if (storeInProject()) {
        const el = $('#status')
        el.textContent += `（题库/进度：${storeLocationLabel()}）`
      }
      document.title = meta.title
    } catch (err) {
      setStatus(`初始化失败：${err instanceof Error ? err.message : String(err)}`, 'bad')
    }
  })()

  root.setAttribute('data-booted', '1')
  try {
    const url = new URL(location.href)
    if (url.searchParams.has('_r')) {
      url.searchParams.delete('_r')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  } catch {
    /* URL 不可用时忽略 */
  }

  // 便于调试
  ;(window as unknown as Record<string, unknown>).__game = {
    adapter,
    getSession: () => session,
    selectPuzzle,
    setStatus,
  }

  return {
    selectPuzzle,
    getSession: () => session,
    adapter,
  }
}