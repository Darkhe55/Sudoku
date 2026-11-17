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
    notes: new Array<number>(size).fill(0),
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
    notes: s.notes ? s.notes.slice() : new Array<number>(s.cells.length).fill(0),
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
  if (!s.notes || s.notes.length !== s.cells.length) {
    s.notes = new Array<number>(s.cells.length).fill(0)
  }
  if (move.kind === 'note') {
    // 候选数只能写在空格上；to 是候选 bitmask（bit v-1 = 候选 v）
    if ((s.cells[move.index] ?? 0) !== 0) return
    const limit = 2 ** Math.min(25, maxValueOf(s))
    const mask = Math.floor(move.to)
    s.notes[move.index] = mask >= 0 && mask < limit ? mask : 0
    return
  }
  const n = maxValueOf(s)
  s.cells[move.index] = move.to >= 1 && move.to <= n ? move.to : 0
  // 写入（或清除）正式数字时，自动丢掉该格候选数
  s.notes[move.index] = 0
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from, ...(move.kind ? { kind: move.kind } : {}) }
}

export function valueAt(state: GameState, index: number): number {
  return asSudokuState(state).cells[index] ?? 0
}

/** 某格候选数 bitmask（bit v-1 = 候选 v）；无笔记返回 0 */
export function noteMaskAt(state: GameState, index: number): number {
  return asSudokuState(state).notes?.[index] ?? 0
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asSudokuState(state)
  return {
    version: 3,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
    // 预填格也一起存档，刷新后仍能恢复「题面给定格不能改」的保护
    givens: encodeCells(s.givens),
    // 候选数 bitmask 逐格存档（数值可能超过 36 进制单字符，直接用数组）
    notes: s.notes ? s.notes.slice() : [],
  }
}

/** 读取候选数存档：逐格 bitmask 数组；旧档无该字段时全部为 0 */
function readNotes(value: unknown, size: number, maxValue: number): number[] {
  const out = new Array<number>(size).fill(0)
  if (!Array.isArray(value)) return out
  const limit = 2 ** Math.min(25, maxValue)
  for (let i = 0; i < Math.min(size, value.length); i++) {
    const raw = Number(value[i] ?? 0)
    if (!Number.isInteger(raw) || raw < 0 || raw >= limit) continue
    out[i] = raw
  }
  return out
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
  // 旧版进度没有 givens 字段：读不到时按 0（不保护）兼容旧存档
  const givens = readCells(data.givens, size, n)
  if (givens) {
    // 存档里若预填格被改过，以预填值为准纠正回来
    for (let i = 0; i < size; i++) if (givens[i] !== 0) cells[i] = givens[i]
  }
  return {
    puzzleId: data.puzzleId,
    width: n,
    height: n,
    cells,
    givens: givens ?? new Array<number>(size).fill(0),
    notes: readNotes(data.notes, size, n),
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
