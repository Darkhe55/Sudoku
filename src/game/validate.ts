/**
 * 数独 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { isValidSolution, makeUnits } from './rules'
import {
  asSudokuPuzzle,
  asSudokuState,
  type DuplicateIssue,
  type SudokuResult,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): SudokuResult {
  const s = asSudokuState(state)
  const p = asSudokuPuzzle(puzzle)
  const cells = s.cells
  const regions = p.regions ?? []

  let empty = 0
  const changed = new Set<number>()
  for (let i = 0; i < 81; i++) {
    if (cells[i] === 0) empty++
    const given = p.givens?.[i] ?? 0
    if (given !== 0 && cells[i] !== given) changed.add(i)
  }

  const bad = new Set<number>()
  for (const i of changed) bad.add(i)
  const duplicateIssues: DuplicateIssue[] = []
  const units = makeUnits(regions)
  const kinds: Array<'row' | 'col' | 'region'> = [
    ...Array.from({ length: 9 }, () => 'row' as const),
    ...Array.from({ length: 9 }, () => 'col' as const),
    ...Array.from({ length: 9 }, () => 'region' as const),
  ]
  for (let u = 0; u < units.length; u++) {
    const unit = units[u]!
    const map = new Map<number, number[]>()
    for (const i of unit) {
      const v = cells[i]!
      if (v === 0) continue
      const list = map.get(v) ?? []
      list.push(i)
      map.set(v, list)
    }
    for (const [value, list] of map) {
      if (list.length > 1) {
        duplicateIssues.push({ kind: kinds[u] ?? 'region', index: u % 9, value, cells: list })
        for (const i of list) bad.add(i)
      }
    }
  }

  const complete = empty === 0
  const solved =
    complete &&
    duplicateIssues.length === 0 &&
    changed.size === 0 &&
    isValidSolution(cells, regions)

  return {
    solved,
    empty,
    complete,
    duplicateIssues,
    changedGivens: Array.from(changed),
    badCells: Array.from(bad),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as SudokuResult
  if (r.solved) return ['完成']
  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.duplicateIssues.length > 0) bits.push(`${r.duplicateIssues.length} 处行列/宫重复`)
  if (r.changedGivens.length > 0) bits.push('题面预填数字被改动')
  if (bits.length === 0) bits.push('继续填数')
  return bits
}
