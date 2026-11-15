/**
 * 数独 —— 题库
 */

import type { Difficulty, GameState, Puzzle } from '../core/types'
import { RAW_PUZZLES } from './puzzles-data'
import { decodeCells, decodeBoard, type SudokuPuzzle, type SudokuState } from './types'

export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series?: string
  board: string
  solution?: string
}

export function decodePuzzle(raw: RawPuzzle): SudokuPuzzle | null {
  if (raw.width !== 9 || raw.height !== 9) return null
  const decoded = decodeBoard(raw.board, 81)
  if (!decoded) return null
  return {
    id: raw.id,
    name: raw.name,
    width: 9,
    height: 9,
    difficulty: raw.difficulty,
    regions: decoded.regions,
    givens: decoded.givens,
  }
}

export const builtinPuzzles: Puzzle[] = (RAW_PUZZLES as RawPuzzle[])
  .map(decodePuzzle)
  .filter((p): p is SudokuPuzzle => p !== null)

export function getReferenceSolution(id: string): GameState | null {
  const raw = (RAW_PUZZLES as RawPuzzle[]).find((p) => p.id === id)
  if (!raw || typeof raw.solution !== 'string') return null
  const cells = decodeCells(raw.solution, 81)
  if (!cells) return null
  const puzzle = decodePuzzle(raw)
  if (!puzzle) return null
  const state: SudokuState = {
    puzzleId: puzzle.id,
    width: 9,
    height: 9,
    cells,
    givens: puzzle.givens.slice(),
  }
  return state
}
