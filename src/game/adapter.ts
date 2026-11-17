/**
 * ════════════════════════════════════════════════════════════════════
 *  数独（Sudoku）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 尺寸：任意 N×N（4..25 自定义，内置 4/6/9/12/16；识图可导入 4..25 等）。
 * 宫：标准矩形宫（6→2×3、9→3×3、12→3×4、16→4×4），质数边长退化为拉丁方。
 * 状态：0 = 未填，1..N = 数字/字母（N>9 时 10..36 用 A..Z 显示）。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic.ts'
import { builtinPuzzles, getReferenceSolution } from './puzzles.ts'
import { hitTest, metricsFor, renderBoard } from './render.ts'
import { solvePuzzle } from './solver.ts'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  noteMaskAt,
  rightClickValue,
  serializeState,
  valueAt,
} from './state.ts'
import { statusBits, validate } from './validate.ts'
import {
  decodeBoard,
  encodeBoard,
  isValidSudokuSize,
  MAX_SUDOKU_SIZE,
  MIN_SUDOKU_SIZE,
  puzzleSize,
  standardRegionsOf,
  valueOfSymbol,
  type SudokuPuzzle,
} from './types.ts'

const meta = {
  title: '数独',
  tagline:
    'N×N 填数 —— 每行、每列、每宫都必须是 1..N（内置 4/6/9/12/16 宫，自定义 4..25）',
  footerNote:
    '规则：在 N×N 格中填入 1..N（超过 9 用 A..Z 表示 10..25），每行、每列、每个宫（4×4 为 2×2 宫、6×6 为 2×3 宫、9×9 为 3×3 宫、12×12 为 3×4 宫、16×16 为 4×4 宫）内的数字都不能重复。题面预填数字不能修改。',
  storageKeyPrefix: 'sudoku',
  customIdPrefix: 'sudoku-custom-',
  customMinW: MIN_SUDOKU_SIZE,
  customMinH: MIN_SUDOKU_SIZE,
  customMaxW: MAX_SUDOKU_SIZE,
  customMaxH: MAX_SUDOKU_SIZE,
  targetKind: 'cell' as const,
}

/** 1..N（大棋盘用 A..Z 表示 10..36） */
const VALUE_CYCLE: Array<number | null> = [null, ...Array.from({ length: 25 }, (_, i) => i + 1)]

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: VALUE_CYCLE,
  valueCycleFor: (w, h) => {
    const n = Math.max(MIN_SUDOKU_SIZE, Math.min(MAX_SUDOKU_SIZE, Math.max(w, h)))
    return [null, ...Array.from({ length: n }, (_, i) => i + 1)]
  },
  validSize: (w, h) => w === h && isValidSudokuSize(w),
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },
  keyForChar: (ch, maxValue) => {
    const v = valueOfSymbol(ch)
    if (v >= 10 && v <= Math.min(36, Math.max(9, maxValue))) return v
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : v <= 9 ? String(v) : String.fromCharCode(55 + v)),
  cellClass: (v) => (v == null ? '' : `n${v}`),
  hint:
    '点击格子循环填数；也可用键盘 1–9 填数（10 以上用 A–Z，或 Shift+A..Z / 数字面板）、0 / 退格清空、方向键移动。题面只有预填数字，唯一解不做强制校验。',
  makePuzzle: (w, h, grid, existingId) => {
    const n = Math.max(MIN_SUDOKU_SIZE, Math.min(MAX_SUDOKU_SIZE, Math.max(w, h)))
    const size = n * n
    const givens = new Array<number>(size).fill(0)
    for (let i = 0; i < size; i++) {
      const v = grid[i]
      givens[i] = typeof v === 'number' && v >= 1 && v <= n ? v : 0
    }
    return {
      id: existingId ?? `${meta.customIdPrefix}${Date.now()}`,
      name: `自定义 · 数独 ${n}×${n}`,
      width: n,
      height: n,
      difficulty: 'custom',
      regions: standardRegionsOf(n),
      givens,
    } satisfies SudokuPuzzle
  },
  encodePuzzle: (p) => {
    const sp = p as SudokuPuzzle
    const n = puzzleSize(sp) || 9
    return {
      board: encodeBoard(sp.givens ?? [], sp.regions ?? standardRegionsOf(n)),
    }
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string' || typeof record.board !== 'string') return null
    const n = puzzleSize({ width: Number(record.width), height: Number(record.height) })
    if (!isValidSudokuSize(n)) return null
    const size = n * n
    const decoded = decodeBoard(record.board, size, n, 36)
    if (!decoded) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · 数独 ${n}×${n}`,
      width: n,
      height: n,
      difficulty: 'custom',
      regions: decoded.regions,
      givens: decoded.givens,
    } satisfies SudokuPuzzle
  },
  toGrid: (p) => {
    const sp = p as SudokuPuzzle
    const n = puzzleSize(sp)
    if (!n || !Array.isArray(sp.givens) || sp.givens.length !== n * n) return null
    return {
      width: n,
      height: n,
      grid: sp.givens.map((v) => (v >= 1 && v <= n ? v : null)),
    }
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.from === 0) playPluck(streak, 1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  noteMaskAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
