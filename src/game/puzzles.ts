/**
 * 数独 —— 题库加载
 *
 * 题库由三部分组成：
 *   - RAW_PUZZLES：npm run gen 生成的旧 9×9 内置题（puzzles-data.ts，保持稳定不再变化）
 *   - EXTRA_PUZZLES：npm run gen 生成的多尺寸内置题（puzzles-extra-data.ts：
 *     4×4 / 6×6 / 12×12 / 16×16 等）
 *   - IMPORTED_PUZZLES：scripts/import-image.mjs --append 写入的识图题
 *     （单独文件，npm run gen 不会覆盖；支持任意 N / 任意宫形）
 *
 * 题面编码见 types.ts：givens|regions，每格 1 个 36 进制字符，
 * 因此 9×9（值 1..9 / 宫 0..8）与 16×16（值 1..16 / 宫 0..15）共用同一套解析。
 */

import type { Difficulty, GameState, Puzzle } from '../core/types'
import { RAW_PUZZLES } from './puzzles-data.ts'
import { EXTRA_PUZZLES } from './puzzles-extra-data.ts'
import { IMPORTED_PUZZLES } from './imported-puzzles.ts'
import {
  decodeBoard,
  decodeCells,
  isValidSudokuSize,
  puzzleSize,
  regionCountOf,
  type SudokuPuzzle,
  type SudokuState,
} from './types.ts'

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

/** 内置题 + 识图导入题 */
export const ALL_RAW_PUZZLES: RawPuzzle[] = [
  ...(RAW_PUZZLES as RawPuzzle[]),
  ...(EXTRA_PUZZLES as RawPuzzle[]),
  ...(IMPORTED_PUZZLES as RawPuzzle[]),
]

/**
 * 把题库条目解码成可玩题面。
 * 接受任意正方形边长 4..25（4 / 6 / 9 / 12 / 16 / 25 都可以），宫数 1..36。
 * @param editable 是否允许在题库里编辑/删除（图片导入的题面为 false）
 */
export function decodePuzzle(raw: RawPuzzle, editable = true): SudokuPuzzle | null {
  const n = puzzleSize(raw)
  if (!isValidSudokuSize(n)) return null
  const size = n * n
  const decoded = decodeBoard(raw.board, size, n, 36)
  if (!decoded) return null
  const regionCount = regionCountOf(decoded.regions)
  if (regionCount < 1 || regionCount > 36) return null
  return {
    id: raw.id,
    name: raw.name,
    width: n,
    height: n,
    difficulty: raw.difficulty,
    regions: decoded.regions,
    givens: decoded.givens,
    editable,
  }
}

export const builtinPuzzles: Puzzle[] = [
  ...(RAW_PUZZLES as RawPuzzle[]).map((raw) => decodePuzzle(raw, false)),
  ...(EXTRA_PUZZLES as RawPuzzle[]).map((raw) => decodePuzzle(raw, false)),
  ...(IMPORTED_PUZZLES as RawPuzzle[]).map((raw) => decodePuzzle(raw, false)),
].filter((p): p is SudokuPuzzle => p !== null)

export function getReferenceSolution(id: string): GameState | null {
  const raw = ALL_RAW_PUZZLES.find((p) => p.id === id)
  if (!raw || typeof raw.solution !== 'string' || !raw.solution) return null
  const puzzle = decodePuzzle(raw)
  if (!puzzle) return null
  const size = puzzle.width * puzzle.height
  const cells = decodeCells(raw.solution, size, puzzle.width)
  if (!cells) return null
  const state: SudokuState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells,
    givens: puzzle.givens.slice(),
  }
  return state
}
