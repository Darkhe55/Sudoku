/**
 * 数独（Sudoku）—— 游戏专用类型
 *
 * 规则：9×9 中填入 1..9，每行、每列、每个 3×3 宫都不能重复。
 * regions 用 0..8 表示九个宫，便于后续异形数独复用同一套引擎。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export interface SudokuPuzzle extends Puzzle {
  /** 每格所属区域（宫）0..8 */
  regions: number[]
  /** 题面预填：0 = 空，1..9 = 数字 */
  givens: number[]
  solution?: number[]
}

export interface SudokuState extends GameState {
  cells: number[]
  givens: number[]
}

export interface DuplicateIssue {
  kind: 'row' | 'col' | 'region'
  index: number
  value: number
  cells: number[]
}

export interface SudokuResult extends ValidationResult {
  empty: number
  complete: boolean
  duplicateIssues: DuplicateIssue[]
  changedGivens: number[]
  badCells: number[]
}

export function asSudokuPuzzle(p: Puzzle): SudokuPuzzle {
  return p as SudokuPuzzle
}

export function asSudokuState(s: GameState): SudokuState {
  return s as SudokuState
}

export function encodeBoard(givens: ArrayLike<number>, regions: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < givens.length; i++) out += String(givens[i]! | 0)
  out += '|'
  for (let i = 0; i < regions.length; i++) out += String(regions[i]! | 0)
  return out
}

export function decodeBoard(
  text: string,
  expected: number,
): { givens: number[]; regions: number[] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 2) return null
  const givenText = parts[0]!
  const regionText = parts[1]!
  if (givenText.length !== expected || regionText.length !== expected) return null
  const givens = new Array<number>(expected).fill(0)
  const regions = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const g = givenText.charCodeAt(i) - 48
    const r = regionText.charCodeAt(i) - 48
    if (g < 0 || g > 9 || r < 0 || r > 8) return null
    givens[i] = g
    regions[i] = r
  }
  return { givens, regions }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const v = text.charCodeAt(i) - 48
    if (v < 0 || v > 9) return null
    out[i] = v
  }
  return out
}

/** 标准数独的九宫区域 */
export function standardRegions(): number[] {
  const out = new Array<number>(81).fill(0)
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      out[y * 9 + x] = Math.floor(y / 3) * 3 + Math.floor(x / 3)
    }
  }
  return out
}
