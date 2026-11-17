/**
 * 通用谜题应用 —— 主逻辑
 *
 * 布局 / 会话 / 撤销重做 / 题库 / 自定义题板 / 逻辑回放 / 缩放平移 / 快捷键
 * 全部由本文件提供，只依赖 GameAdapter 契约。
 *
 * 新游戏入口：src/main.ts 里 `createApp(document.querySelector('#app'), adapter)`。
 */

import './styles.css'
import type { GameAdapter, GameState, HitTarget, Move, Puzzle } from './types'
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
        : '<kbd>左键</kbd> 循环标记 · <kbd>右键</kbd> 直接标排除')

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
        <div><kbd>数字面板</kbd> 选一个数字后点格直接填数 · 再点一次回到循环模式</div>
        <div><kbd>按住拖拽</kbd> 连续涂写 · <kbd>中键/拖拽</kbd> 平移画布</div>
        <div><kbd>滚轮</kbd> 缩放 · <kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> 放大/缩小/复位</div>
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
      <div class="value-palette" id="value-palette" hidden></div>
      <div id="board"></div>
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
  /** 键盘操作当前锁定的格子（点击格子后锁定） */
  let cursor: number | null = null
  /** 数字面板：已选中的值（null = 清除模式）；paletteActive=false 表示循环模式 */
  let paletteActive = false
  let paletteValue: number | null = null

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
    const values: Array<number | null> = [...Array.from({ length: n }, (_, i) => i + 1), null]
    el.innerHTML = values
      .map((v) => {
        const active = paletteActive && paletteValue === v
        const cls = `palette-btn${active ? ' active' : ''}${v === null ? ' clear' : ''}`
        return `<button class="${cls}" type="button" data-value="${v === null ? 'clear' : v}">${paletteLabel(v)}</button>`
      })
      .join('')
    el.querySelectorAll<HTMLButtonElement>('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.value
        const v = raw === 'clear' ? null : Number(raw)
        if (paletteActive && paletteValue === v) {
          paletteActive = false
          paletteValue = null
        } else {
          paletteActive = true
          paletteValue = v
        }
        renderPalette()
      })
    })
  }

  /** 选中格子（只更新高亮，不重绘整盘） */
  function setCursor(index: number | null): void {
    cursor = index
    const board = document.getElementById('board')
    board?.querySelectorAll('.cell-hit.selected').forEach((el) => el.classList.remove('selected'))
    if (index !== null) {
      board?.querySelector(`.cell-hit[data-index="${index}"]`)?.classList.add('selected')
    }
  }

  /** 点击一格时该写入的值：面板选中值优先，否则沿用点击循环 */
  function valueForClick(hit: HitTarget): number {
    if (!session) return 0
    if (paletteActive) return paletteValue ?? 0
    return adapter.cycleValue(session.state, hit)
  }

  /** 直接给某格写值（键盘 / 数字面板用） */
  function writeCell(index: number, value: number): void {
    if (!session) return
    const before = adapter.valueAt(session.state, index)
    if (before === value) return
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
    renderPalette()
    renderBoardOnly()
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
    paletteActive = false
    paletteValue = null
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
    let dragMoved = false
    let lastClient = { x: 0, y: 0 }
    let pending: { index: number } | null = null
    let painting: { kind: 'cycle' | 'force'; to: number } | null = null
    let painted = new Set<number>()

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
        dragMoved = true
        painting = null
        pending = null
        lastClient = { x: e.clientX, y: e.clientY }
        svg.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 2) {
        const hit = hitAt(e)
        if (hit) {
          if (!session) return
          setCursor(hit.index)
          const to = adapter.rightClickValue(session.state, hit)
          const from = adapter.valueAt(session.state, hit.index)
          if (from !== to) {
            pushMove({ index: hit.index, from, to })
            refresh()
          }
        }
        return
      }
      if (e.button !== 0) return

      lastClient = { x: e.clientX, y: e.clientY }
      dragging = true
      dragMoved = false
      painted = new Set()
      const hit = hitAt(e)
      if (hit) {
        if (!session) return
        setCursor(hit.index)
        const from = adapter.valueAt(session.state, hit.index)
        const to = valueForClick(hit)
        painting = from === to ? null : { kind: paletteActive ? 'force' : 'cycle', to }
        pending = hit
      } else {
        setCursor(null)
        painting = null
        pending = null
      }
      svg.setPointerCapture(e.pointerId)
    })

    svg.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const dx = e.clientX - lastClient.x
      const dy = e.clientY - lastClient.y
      if (!dragMoved && Math.hypot(dx, dy) < 6) return
      dragMoved = true
      if (painting) {
        // 拖拽涂写：沿途命中即落子
        const hit = hitAt(e)
        if (hit && !painted.has(hit.index)) {
          if (!session) return
          painted.add(hit.index)
          setCursor(hit.index)
          const from = adapter.valueAt(session.state, hit.index)
          const to =
            painting.kind === 'force' ? painting.to : adapter.cycleValue(session.state, hit)
          if (from !== to) {
            pushMove({ index: hit.index, from, to })
            refresh()
          }
        }
        return
      }
      // 平移
      const rect = svg.getBoundingClientRect()
      view.panBy(dx, dy, svg, rect.width, rect.height)
      lastClient = { x: e.clientX, y: e.clientY }
    })

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      try {
        svg.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (!dragMoved && pending && painting) {
        if (!session) return
        const from = adapter.valueAt(session.state, pending.index)
        const to = painting.to
        if (from !== to) {
          pushMove({ index: pending.index, from, to })
          refresh()
        }
      }
      pending = null
      painting = null
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

    // 棋盘键盘输入：数字 / Shift+字母 / 退格 / 方向键（需先点选格子）
    if (session && cursor !== null) {
      const w = session.puzzle.width
      const size = session.puzzle.width * session.puzzle.height
      const n = Math.max(1, Math.min(36, Math.max(session.puzzle.width, session.puzzle.height)))
      const single = e.key.length === 1
      if (single && e.key >= '1' && e.key <= '9' && Number(e.key) <= n) {
        e.preventDefault()
        writeCell(cursor, Number(e.key))
        return
      }
      if (single && e.shiftKey && e.key >= 'A' && e.key <= 'Z') {
        const v = 10 + (e.key.charCodeAt(0) - 65)
        if (v <= n) {
          e.preventDefault()
          writeCell(cursor, v)
          return
        }
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        writeCell(cursor, 0)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        writeCell(cursor, 0)
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