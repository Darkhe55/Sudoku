/**
 * 数独题面图片导入（全自动识图版）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--size N] [--name 名称] [--series 识图]
 *                                  [--append] [--verify] [--json 输出.json]
 *                                  [--map "x,y=字符,..."] [--charset 123456789ABCDEFG]
 *                                  [--box N] [--dry]
 *
 * 流程：
 *   1. Playwright + Edge 打开图片到 canvas，取灰度像素；
 *   2. 投影暗像素找竖/横网格线，取等距最长序列自动判定 N（9×9 / 16×16 等）；
 *   3. 每格中心裁切、局部自适应二值化，字形归一化后与多字体多字重模板做
 *      平移容差 IoU + 镂空数加权匹配，得到每格候选字符；
 *   4. 自动判定字符集（1-9 / 1-9A-G / 0-9A-F ...），并用行/列/宫互异约束
 *      对低置信度格做小范围一致性修复；
 *   5. 预览识别结果；--verify 调项目 solver 验证唯一解并求参考解；
 *   6. --append 写入 src/game/puzzles-data.ts（只支持当前题库的 9×9；
 *      其他尺寸用 --json 导出，不会被游戏加载）。
 *
 * --map：人工覆盖某格，坐标 0 基（列,行），例如 --map "3,4=G,5,1=7"。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function edgePath() {
  for (const c of EDGE_CANDIDATES) {
    if (c && existsSync(c)) return c
  }
  throw new Error('找不到 Edge 可执行文件，请用 EDGE_PATH 指定')
}

const args = process.argv.slice(2)
function has(flag) {
  return args.includes(flag)
}
function arg(flag, fallback = '') {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback
}
function argEq(flag) {
  for (const a of args) if (a.startsWith(flag + '=')) return a.slice(flag.length + 1)
  return null
}

const imageArg = args.find((a) => !a.startsWith('--') && a !== arg('--map') && a !== arg('--json') && a !== arg('--name') && a !== arg('--series') && a !== arg('--charset'))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--size N] [--name 名称] [--series 识图] [--append] [--verify] [--json out.json] [--map "x,y=字符,..."] [--charset 123456789ABCDEFG] [--box N] [--dry]',
  )
  process.exit(1)
}
const IMAGE = path.resolve(imageArg)
if (!existsSync(IMAGE)) {
  console.error('找不到图片:', IMAGE)
  process.exit(1)
}

const sizeOpt = Number(arg('--size', '0')) || 0
const boxOpt = Number(arg('--box', '0')) || 0
const nameOpt = arg('--name')
const series = arg('--series', '识图')
const jsonOut = arg('--json')
const charsetOverride = arg('--charset')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')

// --map "x,y=ch,x,y=ch"
const manual = new Map()
const mapArg = argEq('--map') ?? arg('--map')
if (mapArg) {
  // 支持 "x,y=字符" 连写，多组之间可用空格/分号/逗号分隔；坐标本身含逗号，故用全局匹配
  const re = /(\d+)\s*,\s*(\d+)\s*=\s*([^\s,;]+)/g
  let matched = 0
  let m
  while ((m = re.exec(mapArg)) !== null) {
    manual.set(Number(m[2]) * 10000 + Number(m[1]), m[3])
    matched++
  }
  const residue = mapArg.replace(re, '').replace(/[\s,;]+/g, '')
  if (!matched || residue) {
    console.error(`--map 格式错误：${mapArg}（应为 x,y=字符，多组用空格或分号分隔）`)
    process.exit(1)
  }
}

// ───────────────────────── 浏览器端识图 ─────────────────────────
const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: edgePath() })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analysis = await page.evaluate(
  async ({ dataUrl, sizeOpt }) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, W, H).data
    const gray = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return 255
      const i = (y * W + x) * 4
      return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    }

    // 1) 网格线：按行/列统计“偏暗”像素，取等距最长序列
    const LINE_T = 225
    const linesOf = (axis) => {
      const counts = new Int32Array(axis === 'x' ? W : H)
      const len = axis === 'x' ? H : W
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (gray(x, y) >= LINE_T) continue
          counts[axis === 'x' ? x : y]++
        }
      }
      const threshold = len * 0.38
      const res = []
      let start = -1
      for (let i = 0; i < counts.length; i++) {
        const on = counts[i] >= threshold
        if (on && start < 0) start = i
        if (!on && start >= 0) {
          res.push((start + i - 1) / 2)
          start = -1
        }
      }
      if (start >= 0) res.push((start + counts.length - 1) / 2)
      return res
    }
    const runs = (lines) => {
      // 枚举所有等距连续序列（容差 15%），按长度降序返回
      const out = []
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const step = (lines[j] - lines[i]) / (j - i)
          if (step < 8) continue
          let end = i
          for (let k = i + 1; k < lines.length; k++) {
            if (Math.abs(lines[k] - (lines[i] + step * (k - i))) > step * 0.15) break
            end = k
          }
          if (end - i >= 1) out.push({ start: i, end, step, count: end - i + 1 })
        }
      }
      out.sort((a, b) => b.count - a.count || a.step - b.step)
      return out
    }
    const xsAll = linesOf('x')
    const ysAll = linesOf('y')
    if (!xsAll.length || !ysAll.length) throw new Error('图片里没有找到网格线')
    const xRuns = runs(xsAll)
    const yRuns = runs(ysAll)
    const pickRun = (list) => {
      if (sizeOpt >= 4) {
        for (const r of list) if (r.count - 1 === sizeOpt) return r
      }
      return list[0] ?? null
    }
    let xr = pickRun(xRuns)
    let yr = pickRun(yRuns)
    if (!xr || !yr) throw new Error('无法确定网格线')
    let xLines = xsAll.slice(xr.start, xr.end + 1)
    let yLines = ysAll.slice(yr.start, yr.end + 1)
    let N = Math.min(xLines.length, yLines.length) - 1
    if (N < 4) throw new Error(`识别到的网格太小：${N}×${N}`)
    if (sizeOpt >= 4 && N !== sizeOpt) {
      throw new Error(`网格尺寸不匹配：识别到 ${N}×${N}，--size ${sizeOpt}；可先不加 --size 预览`)
    }
    if (xLines.length !== yLines.length) {
      const n2 = Math.min(xLines.length, yLines.length)
      xLines = xLines.slice(0, n2)
      yLines = yLines.slice(0, n2)
      N = n2 - 1
    }
    const cellX = (xLines[N] - xLines[0]) / N
    const cellY = (yLines[N] - yLines[0]) / N

    // 2) 字形模板：多字体多字重，归一化 24×24，附带镂空数
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOP'
    const NS = 24
    const SRC = 40
    const normBit = (raw, T) => {
      let x0 = SRC, y0 = SRC, x1 = -1, y1 = -1, ink = 0
      const m = new Uint8Array(SRC * SRC)
      for (let j = 0; j < SRC; j++) {
        for (let i = 0; i < SRC; i++) {
          if (raw[j * SRC + i] >= T) continue
          m[j * SRC + i] = 1
          ink++
          if (i < x0) x0 = i
          if (i > x1) x1 = i
          if (j < y0) y0 = j
          if (j > y1) y1 = j
        }
      }
      if (!ink) return null
      const bw = x1 - x0 + 1
      const bh = y1 - y0 + 1
      const out = new Uint8Array(NS * NS)
      for (let j = 0; j < NS; j++) {
        for (let i = 0; i < NS; i++) {
          out[j * NS + i] = m[(y0 + Math.floor((bh * j) / NS)) * SRC + (x0 + Math.floor((bw * i) / NS))] ? 1 : 0
        }
      }
      return { m: out, ink, bw, bh }
    }
    const holesOf = (m) => {
      const seen = new Uint8Array(NS * NS)
      let holes = 0
      for (let j = 0; j < NS; j++) {
        for (let i = 0; i < NS; i++) {
          if (m[j * NS + i] || seen[j * NS + i]) continue
          let touches = false
          const st = [[i, j]]
          seen[j * NS + i] = 1
          while (st.length) {
            const [x, y] = st.pop()
            if (x === 0 || y === 0 || x === NS - 1 || y === NS - 1) touches = true
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= NS || ny >= NS) continue
              if (seen[ny * NS + nx] || m[ny * NS + nx]) continue
              seen[ny * NS + nx] = 1
              st.push([nx, ny])
            }
          }
          if (!touches) holes++
        }
      }
      return holes
    }
    const tc = document.createElement('canvas')
    tc.width = 120
    tc.height = 120
    const tg = tc.getContext('2d', { willReadFrequently: true })
    const FONTS = [
      '700 84px Arial',
      '400 84px Arial',
      '700 84px "Segoe UI"',
      '400 84px "Segoe UI"',
      '700 84px Verdana',
      '700 84px Tahoma',
      '700 84px Consolas',
      '400 84px Consolas',
      '600 84px "Cascadia Code"',
      '400 84px "Cascadia Code"',
      '400 84px "Microsoft YaHei"',
      '700 84px "Microsoft YaHei"',
      '700 84px "Trebuchet MS"',
    ]
    const templates = {}
    for (const ch of ALPHABET) templates[ch] = []
    for (const font of FONTS) {
      for (const ch of ALPHABET) {
        tg.fillStyle = '#fff'
        tg.fillRect(0, 0, 120, 120)
        tg.fillStyle = '#000'
        tg.font = font
        tg.textAlign = 'center'
        tg.textBaseline = 'middle'
        tg.fillText(ch, 60, 60)
        const data = tg.getImageData(0, 0, 120, 120).data
        const raw = new Float32Array(SRC * SRC)
        for (let j = 0; j < SRC; j++) {
          for (let i = 0; i < SRC; i++) {
            const sx = Math.floor((i * 120) / SRC)
            const sy = Math.floor((j * 120) / SRC)
            raw[j * SRC + i] = data[(sy * 120 + sx) * 4]
          }
        }
        const gl = normBit(raw, 128)
        if (gl) templates[ch].push({ m: gl.m, holes: holesOf(gl.m) })
      }
    }

    // 3) 每格采样 + 模板匹配
    const simShift = (a, b) => {
      let best = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          let inter = 0
          let union = 0
          for (let j = 0; j < NS; j++) {
            const bj = j + dy
            for (let i = 0; i < NS; i++) {
              const av = a[j * NS + i]
              const bi = i + dx
              const bv = bj >= 0 && bj < NS && bi >= 0 && bi < NS ? b[bj * NS + bi] : 0
              if (av && bv) inter++
              if (av || bv) union++
            }
          }
          const s = union ? inter / union : 0
          if (s > best) best = s
        }
      }
      return best
    }
    const cells = []
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const x0 = xLines[col]
        const x1 = xLines[col + 1]
        const y0 = yLines[row]
        const y1 = yLines[row + 1]
        const mx = x0 + (x1 - x0) * 0.13
        const my = y0 + (y1 - y0) * 0.13
        const mw = (x1 - x0) * 0.74
        const mh = (y1 - y0) * 0.74
        const raw = new Float32Array(SRC * SRC)
        for (let j = 0; j < SRC; j++) {
          for (let i = 0; i < SRC; i++) {
            raw[j * SRC + i] = gray(
              Math.round(mx + (mw * i) / (SRC - 1)),
              Math.round(my + (mh * j) / (SRC - 1)),
            )
          }
        }
        const sorted = Array.from(raw).sort((a, b) => a - b)
        const bg = sorted[Math.floor(sorted.length * 0.92)]
        const T = Math.min(190, bg - 45)
        const gl = normBit(raw, T)
        if (!gl || gl.ink < 10 || gl.bw > SRC * 0.92 || gl.bh > SRC * 0.92) {
          cells.push({ empty: true })
          continue
        }
        const holes = holesOf(gl.m)
        const scores = {}
        for (const ch of ALPHABET) {
          let best = 0
          for (const t of templates[ch]) {
            let s = simShift(gl.m, t.m)
            if (t.holes === holes) s += 0.1
            else if (Math.abs(t.holes - holes) >= 2) s -= 0.12
            if (s > best) best = s
          }
          scores[ch] = Number(best.toFixed(4))
        }
        cells.push({ empty: false, ink: gl.ink, bw: gl.bw, bh: gl.bh, holes, scores })
      }
    }
    return {
      W,
      H,
      N,
      xLines: xLines.map((v) => Number(v.toFixed(1))),
      yLines: yLines.map((v) => Number(v.toFixed(1))),
      cellX: Number(cellX.toFixed(2)),
      cellY: Number(cellY.toFixed(2)),
      cells,
    }
  },
  { dataUrl, sizeOpt },
)

await browser.close()

const N = analysis.N
const ALPHABET = '0123456789ABCDEFGHIJKLMNOP'
const cells = analysis.cells

// ───────────────────────── 字符集判定 ─────────────────────────
const letterPool = 'ABCDEFGHIJKLMNOP'
function charsetCandidates(n) {
  const out = []
  if (n <= 9) {
    out.push(Array.from({ length: n }, (_, i) => String(i + 1)))
    return out
  }
  out.push([...'123456789', ...letterPool.slice(0, n - 9)].slice(0, n))
  out.push([...'0123456789', ...letterPool.slice(0, Math.max(0, n - 10))].slice(0, n))
  return out
}
function parseCharset(spec) {
  const chars = [...new Set([...spec])]
  if (chars.length < 4) throw new Error(`--charset 非法：${spec}`)
  return chars
}
let charset
if (charsetOverride) {
  charset = parseCharset(charsetOverride)
} else {
  const cands = charsetCandidates(N)
  const scored = cands.map((cs) => {
    let total = 0
    for (const cell of cells) {
      if (cell.empty) continue
      total += Math.max(...cs.map((ch) => cell.scores[ch] ?? 0))
    }
    return { cs, total }
  })
  scored.sort((a, b) => b.total - a.total)
  charset = scored[0].cs
  if (scored.length > 1) {
    console.log(
      `[import] 字符集判定：${charset.join('')}（候选 ${scored.map((s) => `${s.cs.join('')}:${s.total.toFixed(2)}`).join(' / ')}）`,
    )
  }
}
const csSet = new Set(charset)

// ───────────────────────── 每格 top 候选 ─────────────────────────
function rankedOf(cell) {
  const list = charset.map((ch) => ({ ch, score: cell.scores[ch] ?? 0 }))
  list.sort((a, b) => b.score - a.score)
  return list
}
const best = new Array(N * N).fill(null) // {ch, score, margin}
const warnings = []
for (let i = 0; i < cells.length; i++) {
  const cell = cells[i]
  if (cell.empty) continue
  const ranked = rankedOf(cell)
  const margin = ranked[0].score - (ranked[1]?.score ?? 0)
  best[i] = { ch: ranked[0].ch, score: ranked[0].score, margin, ranked: ranked.slice(0, 5) }
  if (ranked[0].score < 0.45) {
    warnings.push(`格 (${i % N},${(i / N) | 0}) 识别置信度低（${ranked[0].ch} ${ranked[0].score.toFixed(2)}）`)
  }
}
for (const [key, ch] of manual) {
  const x = key % 10000
  const y = Math.floor(key / 10000)
  if (x >= N || y >= N) {
    console.error(`--map 坐标越界：${x},${y}`)
    process.exit(1)
  }
  const i = y * N + x
  if (!best[i]) best[i] = { ch, score: 1, margin: 1, ranked: [{ ch, score: 1 }] }
  else {
    best[i].ch = ch
    best[i].margin = 1
    best[i].ranked = [{ ch, score: 1 }, ...best[i].ranked.filter((r) => r.ch !== ch)]
  }
  console.log(`[import] 人工覆盖 (${x},${y}) = ${ch}`)
}

// ───────────────────────── 宫格 / 区域 ─────────────────────────
let box = boxOpt
if (!box) {
  if (N === 9) box = 3
  else if (N === 16) box = 4
  else {
    const root = Math.round(Math.sqrt(N))
    box = root * root === N ? root : 0
  }
}
const regions = (() => {
  if (!box) return new Array(N * N).fill(0)
  const out = new Array(N * N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      out[y * N + x] = Math.floor(y / box) * Math.ceil(N / box) + Math.floor(x / box)
    }
  }
  return out
})()
const units = []
for (let y = 0; y < N; y++) units.push(Array.from({ length: N }, (_, x) => y * N + x))
for (let x = 0; x < N; x++) units.push(Array.from({ length: N }, (_, y) => y * N + x))
if (box) {
  const regionIds = [...new Set(regions)]
  for (const id of regionIds) units.push(regions.map((r, i) => (r === id ? i : -1)).filter((i) => i >= 0))
}

function conflictsOf(givens) {
  const list = []
  for (const unit of units) {
    const map = new Map()
    for (const i of unit) {
      const ch = givens[i]
      if (!ch) continue
      const arr = map.get(ch) ?? []
      arr.push(i)
      map.set(ch, arr)
    }
    for (const [ch, arr] of map) if (arr.length > 1) list.push({ ch, cells: arr })
  }
  return list
}

let givens = best.map((b) => (b ? b.ch : null))
let conflicts = conflictsOf(givens)

// 冲突时在相关单元内做小范围一致性修复（最大化模板得分）
if (conflicts.length) {
  console.log(`[import] 行/列/宫出现 ${conflicts.length} 处重复，尝试一致性修复…`)
  const involved = new Set()
  for (const c of conflicts) for (const i of c.cells) involved.add(i)
  for (const i of [...involved]) {
    const x = i % N
    const y = (i / N) | 0
    for (const u of units) if (u.includes(i)) for (const j of u) involved.add(j)
  }
  const vars = [...involved].filter((i) => best[i] && (best[i].ranked?.length ?? 0) > 1)
  const domains = vars.map((i) => {
    const seen = new Set()
    const list = []
    for (const r of best[i].ranked) {
      if (!csSet.has(r.ch) || seen.has(r.ch)) continue
      seen.add(r.ch)
      list.push(r)
    }
    return list
  })
  let nodes = 0
  let found = null
  const assign = new Map()
  const used = new Map() // unitIndex -> Set
  const unitIndexes = new Map(units.map((u, i) => [u, i]))
  const varsUnits = vars.map((i) => units.filter((u) => u.includes(i)))
  const dfs = (k, cost) => {
    if (found) return
    if (++nodes > 300000) return
    if (k === vars.length) {
      found = { cost, assignment: new Map(assign) }
      return
    }
    const i = vars[k]
    for (const cand of domains[k]) {
      let ok = true
      for (const u of varsUnits[k]) {
        const ui = unitIndexes.get(u)
        const set = used.get(ui)
        if (set && set.has(cand.ch)) {
          ok = false
          break
        }
      }
      if (!ok) continue
      for (const u of varsUnits[k]) {
        const ui = unitIndexes.get(u)
        if (!used.has(ui)) used.set(ui, new Set())
        used.get(ui).add(cand.ch)
      }
      assign.set(i, cand.ch)
      dfs(k + 1, cost + (1 - cand.score))
      assign.delete(i)
      for (const u of varsUnits[k]) used.get(unitIndexes.get(u)).delete(cand.ch)
      if (found) return
    }
  }
  dfs(0, 0)
  if (found) {
    let changed = 0
    for (const [i, ch] of found.assignment) {
      if (givens[i] !== ch) changed++
      givens[i] = ch
    }
    const after = conflictsOf(givens)
    console.log(
      `[import] 一致性修复完成：改动 ${changed} 格，剩余 ${after.length} 处冲突${after.length ? '（建议用 --map 修正后重跑）' : ''}`,
    )
    conflicts = after
  } else {
    console.warn('[import] 一致性修复失败，保留原始识别结果，请用 --map 人工修正')
  }
}
if (conflicts.length) {
  for (const c of conflicts) {
    warnings.push(
      `重复 ${c.ch}：${c.cells.map((i) => `(${i % N},${(i / N) | 0})`).join(' ')}`,
    )
  }
}

// ───────────────────────── 通用求解器（N≠9 时校验用） ─────────────────────────
function genericCountSolutions(givensArr, n, regionsArr, limit = 2, maxNodes = 400000) {
  const size = n * n
  const fullMask = (1 << n) - 1
  const masks = new Uint32Array(size)
  const grid = new Array(size).fill(0)
  for (let i = 0; i < size; i++) {
    masks[i] = givensArr[i] ? 0 : fullMask
    grid[i] = givensArr[i] || 0
  }
  const unitList = []
  for (let y = 0; y < n; y++) unitList.push(Array.from({ length: n }, (_, x) => y * n + x))
  for (let x = 0; x < n; x++) unitList.push(Array.from({ length: n }, (_, y) => y * n + x))
  const regionIds = [...new Set(regionsArr)]
  for (const id of regionIds) unitList.push(regionsArr.map((r, i) => (r === id ? i : -1)).filter((i) => i >= 0))
  const peers = Array.from({ length: size }, () => new Set())
  for (const unit of unitList) for (const a of unit) for (const b of unit) if (a !== b) peers[a].add(b)
  const peerList = peers.map((s) => [...s])
  let nodes = 0
  let timedOut = false
  const solutions = []

  const propagate = (startList) => {
    const queue = startList.slice()
    let changed = true
    while (changed) {
      changed = false
      while (queue.length) {
        const cur = queue.pop()
        const bit = 1 << (grid[cur] - 1)
        for (const p of peerList[cur]) {
          if (grid[p]) {
            if (grid[p] === grid[cur]) return false
            continue
          }
          if (!(masks[p] & bit)) continue
          masks[p] &= ~bit
          const m = masks[p]
          if (m === 0) return false
          if ((m & (m - 1)) === 0) {
            grid[p] = 32 - Math.clz32(m)
            masks[p] = 0
            queue.push(p)
            changed = true
          }
        }
      }
      // 唯一候选（hidden single）：某个数字在某单元只剩一个位置
      for (const unit of unitList) {
        for (let v = 1; v <= n; v++) {
          const bit = 1 << (v - 1)
          let count = 0
          let spot = -1
          let placed = false
          for (const i of unit) {
            if (grid[i] === v) {
              placed = true
              break
            }
            if (grid[i]) continue
            if (masks[i] & bit) {
              count++
              spot = i
            }
          }
          if (placed) continue
          if (count === 0) return false
          if (count === 1) {
            grid[spot] = v
            masks[spot] = 0
            queue.push(spot)
            changed = true
          }
        }
      }
    }
    return true
  }
  for (let i = 0; i < size; i++) {
    if (!grid[i]) continue
    if (!propagate([i])) return { count: 0, nodes, timedOut: false, first: null }
  }
  const gridSave = () => grid.slice()
  const maskSave = () => masks.slice()
  const restore = (g, m) => {
    for (let i = 0; i < size; i++) {
      grid[i] = g[i]
      masks[i] = m[i]
    }
  }
  const dfs = () => {
    if (solutions.length >= limit || timedOut) return
    if (++nodes > maxNodes) {
      timedOut = true
      return
    }
    let choice = -1
    let bestCount = n + 1
    for (let i = 0; i < size; i++) {
      if (grid[i]) continue
      let c = 0
      let m = masks[i]
      while (m) {
        m &= m - 1
        c++
      }
      if (c === 0) return
      if (c < bestCount) {
        bestCount = c
        choice = i
        if (c === 1) break
      }
    }
    if (choice < 0) {
      solutions.push(grid.slice())
      return
    }
    const g0 = gridSave()
    const m0 = maskSave()
    let bits = masks[choice]
    while (bits) {
      const bit = bits & -bits
      bits ^= bit
      restore(g0, m0)
      const v = 32 - Math.clz32(bit)
      grid[choice] = v
      masks[choice] = 0
      if (propagate([choice])) dfs()
      if (solutions.length >= limit || timedOut) break
    }
    restore(g0, m0)
  }
  dfs()
  return { count: solutions.length, nodes, timedOut, first: solutions[0] ?? null }
}

// ───────────────────────── 预览 ─────────────────────────
const clues = givens.filter(Boolean).length
const charsUsed = new Map()
for (const ch of givens) if (ch) charsUsed.set(ch, (charsUsed.get(ch) ?? 0) + 1)
console.log(
  `[import] ${path.basename(IMAGE)}：${analysis.W}×${analysis.H}px，识别网格 ${N}×${N}，` +
    `格距 ${analysis.cellX}×${analysis.cellY}px，字符集 ${charset.join('')}`,
)
console.log(`[import] 预填 ${clues}/${N * N} 格：${[...charsUsed].map(([ch, n]) => `${ch}×${n}`).join(' ')}`)
if (box) console.log(`[import] 宫格按 ${box}×${box} 划分（--box 可覆盖）`)
console.log('[import] 识别结果：')
for (let y = 0; y < N; y++) {
  let line = ''
  for (let x = 0; x < N; x++) {
    const ch = givens[y * N + x] ?? '.'
    let sep = ' '
    if (x > 0 && box && x % box === 0) sep = ' | '
    line += (x === 0 ? '' : sep) + ch
  }
  console.log('  ' + String(y).padStart(2) + ' ' + line)
}
if (warnings.length) {
  console.log(`[import] 注意 ${warnings.length} 条：`)
  for (const w of warnings.slice(0, 30)) console.log('  - ' + w)
  if (warnings.length > 30) console.log(`  … 其余 ${warnings.length - 30} 条略`)
}

// ───────────────────────── 校验 ─────────────────────────
const valueOf = (ch) => charset.indexOf(ch) + 1
const charOf = (v) => charset[v - 1] ?? String(v)
let solution = null // 数值数组 1..N
let unique = false
if (verify || append) {
  const givensArr = givens.map((ch) => (ch ? valueOf(ch) : 0))
  if (N === 9) {
    const { countSolutions, solvePuzzle } = await import('../src/game/solver.ts')
    const t0 = Date.now()
    const counted = countSolutions(givensArr, regions, 2, 800000)
    if (counted.timedOut) {
      console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点），仅警告`)
    } else if (counted.count !== 1) {
      console.warn(`[import] 解不唯一：找到 ${counted.count} 个（可能是识别错误）`)
    } else {
      unique = true
      const puzzle = {
        id: 'import-temp',
        name: 'import-temp',
        width: 9,
        height: 9,
        difficulty: 'hard',
        givens: givensArr,
        regions,
      }
      const solved = solvePuzzle(puzzle, 1500000)
      if (solved.solution) solution = solved.solution.cells.slice()
      console.log(
        `[import] 项目 solver 校验：唯一解 ✓（${Date.now() - t0}ms，${counted.nodes} 节点）`,
      )
    }
  } else {
    const t0 = Date.now()
    const out = genericCountSolutions(givensArr, N, regions, 2, 500000)
    if (out.timedOut) {
      console.warn(`[import] 通用校验超时（${out.nodes} 节点），仅警告`)
    } else if (out.count !== 1) {
      console.warn(`[import] 通用校验：解不唯一（${out.count} 个）`)
    } else {
      unique = true
      solution = out.first
      console.log(`[import] 通用 solver 校验（项目 solver 仅支持 9×9）：唯一解 ✓（${Date.now() - t0}ms）`)
    }
  }
}
if (solution) {
  console.log('[import] 参考解：')
  for (let y = 0; y < N; y++) {
    console.log('  ' + solution.slice(y * N, y * N + N).map(charOf).join(''))
  }
}

// ───────────────────────── 导出 / 写入 ─────────────────────────
const id = `sudoku-import-${Date.now().toString(36)}`
const name = nameOpt || `识图 · ${N}×${N}`
if (jsonOut) {
  const file = path.resolve(jsonOut)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      {
        width: N,
        height: N,
        size: N,
        charset,
        givens: givens.map((ch) => ch ?? '.'),
        regions,
        solution: solution ? solution.map(charOf).join('') : null,
        unique,
        source: path.basename(IMAGE),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`[import] 已导出 JSON：${file}`)
}

if (append) {
  if (dry) {
    console.log('[import] --dry：跳过写入')
  } else if (N !== 9) {
    console.error(
      `[import] 当前题库只支持 9×9（src/game/puzzles.ts 的 decodePuzzle 硬编码 81 格），` +
        `无法写入 ${N}×${N}。识别结果已预览；可用 --json 导出，或在支持该尺寸的游戏中使用。`,
    )
    process.exitCode = 2
  } else {
    const givensText = givens.map((ch) => (ch ? ch : '0')).join('')
    const regionText = regions.join('')
    const board = `${givensText}|${regionText}`
    const solutionText = solution ? solution.join('') : ''
    if (!unique) {
      console.warn('[import] 未确认唯一解，条目的参考解留空（可能导致 npm run check 警告/报错）')
    }
    const entry =
      `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: 9, height: 9, ` +
      `difficulty: 'custom', series: ${JSON.stringify(series)}, board: ${JSON.stringify(board)}, ` +
      `solution: ${JSON.stringify(solutionText)} },\n`
    const dataFile = path.resolve('src/game/puzzles-data.ts')
    let text = readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
    const marker = text.lastIndexOf('\n]')
    if (marker < 0) throw new Error('puzzles-data.ts 格式异常：找不到结尾 ]')
    text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
    writeFileSync(dataFile, text)
    console.log(`[import] 已写入 ${dataFile}：${id} ${name}`)
    console.log('[import] 提示：npm run gen 会重新生成题库（覆盖本次写入），导入题请先备份。')
  }
} else {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/puzzles-data.ts。')
}
