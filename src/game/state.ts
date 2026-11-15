/**
 * 数独 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asSudokuPuzzle,
  asSudokuState,
  decodeCells,
  encodeCells,
  type SudokuState,
} from './types'

export function createEmptyState(puzzle: Puzzle): SudokuState {
  const p = asSudokuPuzzle(puzzle)
  const size = 81
  const givens = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    const v = p.givens?.[i] ?? 0
    givens[i] = v >= 1 && v <= 9 ? v : 0
  }
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
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

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asSudokuState(state)
  const given = s.givens[target.index] ?? 0
  if (given !== 0) return given
  const v = s.cells[target.index] ?? 0
  return v >= 9 ? 0 : v + 1
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
  s.cells[move.index] = move.to >= 1 && move.to <= 9 ? move.to : 0
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

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 9) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): SudokuState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  if (data.width !== 9 || data.height !== 9) return null
  const size = 81
  const cells = readCells(data.cells, size)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: 9,
    height: 9,
    cells,
    givens: new Array<number>(size).fill(0),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asSudokuState(state)
  const sol = asSudokuState(solution)
  for (let i = 0; i < 81; i++) {
    if (s.givens[i] !== 0) continue
    if (s.cells[i] === 0 && sol.cells[i] !== 0) return { index: i, from: 0, to: sol.cells[i]! }
  }
  for (let i = 0; i < 81; i++) {
    if (s.givens[i] !== 0) continue
    if (s.cells[i] !== sol.cells[i]) return { index: i, from: s.cells[i]!, to: sol.cells[i]! }
  }
  return null
}
