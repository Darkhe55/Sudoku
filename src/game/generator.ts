/**
 * 数独题库生成器
 *
 * 1. 用固定模式生成合法终盘，再随机打乱行带/行/列带/列/数字；
 * 2. 随机顺序尝试挖空，只要仍然唯一解就保留；
 * 3. 达到目标挖空数后停止。
 */

import type { Difficulty } from '../core/types'
import { standardRegions } from './types.ts'
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

function baseSolution(): number[] {
  const out = new Array<number>(81)
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      out[y * 9 + x] = (x * 3 + Math.floor(x / 3) + y) % 9 + 1
    }
  }
  return out
}

function makeSolution(rng: () => number): number[] {
  const base = baseSolution()
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)
  const bands = shuffle([0, 1, 2], rng)
  const stacks = shuffle([0, 1, 2], rng)
  const rowOrder: number[] = []
  const colOrder: number[] = []
  for (const band of bands) {
    for (const r of shuffle([0, 1, 2], rng)) rowOrder.push(band * 3 + r)
  }
  for (const stack of stacks) {
    for (const c of shuffle([0, 1, 2], rng)) colOrder.push(stack * 3 + c)
  }
  const out = new Array<number>(81)
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      out[y * 9 + x] = digits[base[rowOrder[y]! * 9 + colOrder[x]!]! - 1]!
    }
  }
  return out
}

const SPECS: GenSpec[] = [
  { n: 9, seed: 0x53554401, difficulty: 'easy', name: '初识数独', series: '入门', maxRemove: 42 },
  { n: 9, seed: 0x53554402, difficulty: 'easy', name: '九宫漫步', series: '入门', maxRemove: 45 },
  { n: 9, seed: 0x53554403, difficulty: 'medium', name: '行列之间', series: '进阶', maxRemove: 50 },
  { n: 9, seed: 0x53554404, difficulty: 'medium', name: '宫格交错', series: '进阶', maxRemove: 53 },
  { n: 9, seed: 0x53554405, difficulty: 'hard', name: '数独之壁', series: '挑战', maxRemove: 56 },
  { n: 9, seed: 0x53554406, difficulty: 'hard', name: '终局九宫', series: '挑战', maxRemove: 58 },
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
  const regions = standardRegions()
  const solution = makeSolution(rng)
  const givens = solution.slice()
  let removed = 0

  const order = shuffle(
    Array.from({ length: 81 }, (_, i) => i),
    rng,
  )
  for (const i of order) {
    if (removed >= spec.maxRemove) break
    const backup = givens[i]!
    givens[i] = 0
    const out = countSolutions(givens, regions, 2, 200_000)
    if (out.count === 1 && !out.timedOut) removed++
    else givens[i] = backup
  }

  return {
    id: `sudoku-9x9-${spec.seed.toString(36)}`,
    name: spec.name,
    width: 9,
    height: 9,
    difficulty: spec.difficulty,
    series: spec.series,
    board: `${givens.join('')}|${regions.join('')}`,
    solution: solution.join(''),
  }
}

export function generatePuzzles(): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  for (const spec of SPECS) {
    const t0 = Date.now()
    const rng = mulberry32(spec.seed)
    const made = makePuzzle(spec, rng)
    const clues = made.board.split('|')[0]!.split('').filter((c) => c !== '0').length
    console.log(`[数独 gen] ${spec.name}：预填 ${clues}，${Date.now() - t0}ms`)
    out.push(made)
  }
  return out
}
