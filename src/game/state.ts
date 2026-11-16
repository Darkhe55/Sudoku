/**
 * 数独 —— 棋盘状态（任意 N）
 *
 * 所有长度/取值都从题面实际 width/height 推导，不再固定 81 / 1..9。
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asSudokuPuzzle,
  asSudokuState,
  decodeCells,
  encodeCells,
  puzzleSize,
  squareSize,
  type SudokuState,
} from './types.ts'

/** 题面边长（正方形）；非法题面返回 0 */
export function sizeOfPuzzle(puzzle: Puzzle): number {
  return puzzleSize(puzzle)
}

export function createEmptyState(puzzle: Puzzle): SudokuState {
  const p = asSudokuPuzzle(puzzle)
  const n = puzzleSize(p) || squareSize(p.width * p.height) || 9
  const size = n * n
  const givens = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    const v = p.givens?.[i] ?? 0
    givens[i] = v >= 1 && v <= n ? v : 0
  }
  return {
    puzzleId: p.id,
    width: p.width || n,
    height: p.height || n,
    cells: givens.slice(),
    givens,
  }
}

export function cloneState(state: GameState): SudokuState {
  const s = asSudokuState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

/** 当前盘面的最大可填数字（= 边长） */
function maxValueOf(state: GameState): number {
  const s = asSudokuState(state)
  return puzzleSize(s) || squareSize(s.cells.length) || 9
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asSudokuState(state)
  const given = s.givens[target.index] ?? 0
  if (given !== 0) return given
  const n = maxValueOf(s)
  const v = s.cells[target.index] ?? 0
  return v >= n ? 0 : v + 1
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asSudokuState(state)
  const given = s.givens[target.index] ?? 0
  return given !== 0 ? given : 0
}

export function applyMove(state: GameState, move: Move): void {
  const s = asSudokuState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  if ((s.givens[move.index] ?? 0) !== 0) return
  const n = maxValueOf(s)
  s.cells[move.index] = move.to >= 1 && move.to <= n ? move.to : 0
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asSudokuState(state).cells[index] ?? 0
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asSudokuState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
  }
}

function readCells(value: unknown, size: number, maxValue: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size, maxValue)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > maxValue) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): SudokuState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const n = puzzleSize({ width: data.width, height: data.height })
  if (!n || n > 36) return null
  const size = n * n
  const cells = readCells(data.cells, size, n)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: n,
    height: n,
    cells,
    givens: new Array<number>(size).fill(0),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asSudokuState(state)
  const sol = asSudokuState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (s.givens[i] !== 0) continue
    if (s.cells[i] === 0 && sol.cells[i] !== 0) return { index: i, from: 0, to: sol.cells[i]! }
  }
  for (let i = 0; i < size; i++) {
    if (s.givens[i] !== 0) continue
    if (s.cells[i] !== sol.cells[i]) return { index: i, from: s.cells[i]!, to: sol.cells[i]! }
  }
  return null
}
