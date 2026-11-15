/**
 * ════════════════════════════════════════════════════════════════════
 *  数独（Sudoku）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：0 = 未填，1..9 = 数字。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import { standardRegions, type SudokuPuzzle } from './types'

const meta = {
  title: '数独',
  tagline: '9×9 填数 —— 每行、每列、每宫都必须是 1..9',
  footerNote:
    '规则：在 9×9 格中填入 1..9，每行、每列、每个 3×3 宫内的数字都不能重复。题面预填数字不能修改。',
  storageKeyPrefix: 'sudoku',
  customIdPrefix: 'sudoku-custom-',
  customMinW: 9,
  customMinH: 9,
  customMaxW: 9,
  customMaxH: 9,
  targetKind: 'cell' as const,
}

const VALUE_CYCLE: Array<number | null> = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9]

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: VALUE_CYCLE,
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : String(v)),
  cellClass: (v) => (v == null ? '' : `n${v}`),
  hint:
    '点击格子循环填数；也可用键盘 1–9 填数、0 / 退格清空、方向键移动。题面只有预填数字，唯一解不做强制校验。',
  makePuzzle: (_w, _h, grid, existingId) => {
    const givens = new Array<number>(81).fill(0)
    for (let i = 0; i < givens.length; i++) {
      const v = grid[i]
      givens[i] = typeof v === 'number' && v >= 1 && v <= 9 ? v : 0
    }
    return {
      id: existingId ?? `${meta.customIdPrefix}${Date.now()}`,
      name: '自定义 · 数独',
      width: 9,
      height: 9,
      difficulty: 'custom',
      regions: standardRegions(),
      givens,
    } satisfies SudokuPuzzle
  },
  encodePuzzle: (p) => {
    const sp = p as SudokuPuzzle
    return {
      board: `${(sp.givens ?? []).join('')}|${(sp.regions ?? standardRegions()).join('')}`,
    }
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string' || typeof record.board !== 'string') return null
    const [givenPart, regionPart] = record.board.split('|')
    if (!givenPart || givenPart.length !== 81) return null
    const givens = [...givenPart].map((ch) => {
      const n = Number(ch)
      return Number.isInteger(n) && n >= 1 && n <= 9 ? n : 0
    })
    const regions =
      regionPart && regionPart.length === 81
        ? [...regionPart].map((ch) => Number(ch) || 0)
        : standardRegions()
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : '自定义 · 数独',
      width: 9,
      height: 9,
      difficulty: 'custom',
      regions,
      givens,
    } satisfies SudokuPuzzle
  },
  toGrid: (p) => {
    const sp = p as SudokuPuzzle
    if (!Array.isArray(sp.givens) || sp.givens.length !== 81) return null
    return {
      width: 9,
      height: 9,
      grid: sp.givens.map((v) => (v >= 1 && v <= 9 ? v : null)),
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
