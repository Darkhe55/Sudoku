/**
 * 数独题库生成器（任意 N / 标准矩形宫）
 *
 * 1. 用矩形宫公式生成合法终盘，再随机打乱「宫带行 / 宫带 / 宫栈列 / 宫栈 / 数字」；
 * 2. 随机顺序尝试挖空，只要仍然唯一解就保留；
 * 3. 达到目标挖空数后停止。
 *
 * 9×9 的生成公式与旧版完全一致（3×3 宫），因此旧 9×9 题库可原样复现；
 * 6×6 用 2×3 宫、12×12 用 3×4 宫、16×16 用 4×4 宫，其它 4..25 同理。
 */

import type { Difficulty } from '../core/types'
import { standardBoxDims, standardRegions, encodeBoard, encodeCells } from './types.ts'
import { countSolutions } from './solver.ts'

interface GenSpec {
  n: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  maxRemove: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** 矩形宫基准解：value = (rows*x + floor(x/cols) + y) mod n + 1 */
function baseSolution(n: number): number[] {
  const { rows, cols } = standardBoxDims(n)
  const out = new Array<number>(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[y * n + x] = ((rows * x + Math.floor(x / cols) + y) % n) + 1
    }
  }
  return out
}

function makeSolution(n: number, rng: () => number): number[] {
  const { rows, cols } = standardBoxDims(n)
  const base = baseSolution(n)
  const digits = shuffle(Array.from({ length: n }, (_, i) => i + 1), rng)
  // 行带：每组 rows 行；行带内打乱
  const bands = shuffle(Array.from({ length: Math.ceil(n / rows) }, (_, i) => i), rng)
  // 宫栈：每组 cols 列；宫栈内打乱（注意：旧版先抽宫栈再抽行，保持 RNG 顺序一致）
  const stacks = shuffle(Array.from({ length: Math.ceil(n / cols) }, (_, i) => i), rng)
  const rowOrder: number[] = []
  for (const band of bands) {
    for (const r of shuffle(Array.from({ length: rows }, (_, i) => i), rng)) {
      const row = band * rows + r
      if (row < n) rowOrder.push(row)
    }
  }
  const colOrder: number[] = []
  for (const stack of stacks) {
    for (const c of shuffle(Array.from({ length: cols }, (_, i) => i), rng)) {
      const col = stack * cols + c
      if (col < n) colOrder.push(col)
    }
  }
  const out = new Array<number>(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[y * n + x] = digits[base[rowOrder[y]! * n + colOrder[x]!]! - 1]!
    }
  }
  return out
}

/** 旧 9×9 内置题规格（保持种子与挖空数不变，保证旧题库可原样复现） */
const LEGACY_SPECS: GenSpec[] = [
  { n: 9, seed: 0x53554401, difficulty: 'easy', name: '初识数独', series: '入门', maxRemove: 42 },
  { n: 9, seed: 0x53554402, difficulty: 'easy', name: '九宫漫步', series: '入门', maxRemove: 45 },
  { n: 9, seed: 0x53554403, difficulty: 'medium', name: '行列之间', series: '进阶', maxRemove: 50 },
  { n: 9, seed: 0x53554404, difficulty: 'medium', name: '宫格交错', series: '进阶', maxRemove: 53 },
  { n: 9, seed: 0x53554405, difficulty: 'hard', name: '数独之壁', series: '挑战', maxRemove: 56 },
  { n: 9, seed: 0x53554406, difficulty: 'hard', name: '终局九宫', series: '挑战', maxRemove: 58 },
]

/** 多尺寸内置题规格 */
const EXTRA_SPECS: GenSpec[] = [
  { n: 4, seed: 0x53555401, difficulty: 'easy', name: '四宫启蒙', series: '尺寸', maxRemove: 9 },
  { n: 4, seed: 0x53555402, difficulty: 'easy', name: '四方初阵', series: '尺寸', maxRemove: 10 },
  { n: 6, seed: 0x53555601, difficulty: 'easy', name: '六宫小试', series: '尺寸', maxRemove: 20 },
  { n: 6, seed: 0x53555602, difficulty: 'medium', name: '六宫交错', series: '尺寸', maxRemove: 24 },
  { n: 12, seed: 0x53555c01, difficulty: 'medium', name: '十二宫长廊', series: '尺寸', maxRemove: 96 },
  { n: 12, seed: 0x53555c02, difficulty: 'hard', name: '十二宫回廊', series: '尺寸', maxRemove: 100 },
  { n: 16, seed: 0x53556001, difficulty: 'medium', name: '十六宫巨幕', series: '尺寸', maxRemove: 138 },
  { n: 16, seed: 0x53556002, difficulty: 'hard', name: '十六宫终章', series: '尺寸', maxRemove: 145 },
]

export interface GeneratedPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

function makePuzzle(spec: GenSpec, rng: () => number): GeneratedPuzzle {
  const n = spec.n
  const size = n * n
  const regions = standardRegions(n)
  const solution = makeSolution(n, rng)
  const givens = solution.slice()
  let removed = 0

  // 挖空时的唯一解检查：大棋盘用很小的节点预算（超时就保留该格预填），
  // 最后再用一次大预算复核，不唯一就把预填逐步补回去。
  const probeBudget = n > 12 ? 2_000 : n > 9 ? 8_000 : 200_000
  const order = shuffle(Array.from({ length: size }, (_, i) => i), rng)
  for (const i of order) {
    if (removed >= spec.maxRemove) break
    const backup = givens[i]!
    givens[i] = 0
    const out = countSolutions(givens, regions, 2, probeBudget, n)
    if (out.count === 1 && !out.timedOut) removed++
    else givens[i] = backup
  }

  // 复核唯一解；不唯一/超时就按已挖空顺序逐步回填，直到唯一
  const digOrder = order.filter((i) => givens[i] === 0)
  const verifyBudget = n > 9 ? 200_000 : 800_000
  let checked = countSolutions(givens, regions, 2, verifyBudget, n)
  for (let k = 0; k < digOrder.length && (checked.timedOut || checked.count !== 1); k++) {
    givens[digOrder[k]!] = solution[digOrder[k]!]!
    checked = countSolutions(givens, regions, 2, verifyBudget, n)
  }

  const sizeTag = `${n}x${n}`
  return {
    id: `sudoku-${sizeTag}-${spec.seed.toString(36)}`,
    name: spec.name,
    width: n,
    height: n,
    difficulty: spec.difficulty,
    series: spec.series,
    board: encodeBoard(givens, regions),
    solution: encodeCells(solution),
  }
}

function run(specs: GenSpec[], tag: string): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  for (const spec of specs) {
    const t0 = Date.now()
    const rng = mulberry32(spec.seed)
    const made = makePuzzle(spec, rng)
    const clues = made.board.split('|')[0]!.split('').filter((c) => c !== '0').length
    console.log(`[${tag}] ${made.name}（${spec.n}×${spec.n}）：预填 ${clues}，${Date.now() - t0}ms`)
    out.push(made)
  }
  return out
}

/** 旧 9×9 内置题（npm run gen 会原样复现） */
export function generatePuzzles(): GeneratedPuzzle[] {
  return run(LEGACY_SPECS, '数独 gen')
}

/** 新增多尺寸内置题（4 / 6 / 12 / 16） */
export function generateExtraPuzzles(): GeneratedPuzzle[] {
  return run(EXTRA_SPECS, '数独 gen 多尺寸')
}
