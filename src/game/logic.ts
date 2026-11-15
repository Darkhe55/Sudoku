/**
 * 数独 —— 逻辑解题回放计划
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type RuleKind } from './rules'
import { asSudokuPuzzle, asSudokuState, type SudokuState } from './types'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  latin: { rule: 1, label: '行/列/宫数字不能重复' },
  region: { rule: 2, label: '宫内唯一位置' },
  probe: { rule: 3, label: '反证：其他数字会立刻矛盾' },
  search: { rule: 4, label: '回溯试探：该格最终是这个数字' },
}

function fallbackSolve(
  grid: number[],
  regions: number[],
  maxNodes: number,
): number[] | null {
  let nodes = 0
  let timedOut = false
  const work = grid.slice()
  const dfs = (): number[] | null => {
    if (timedOut) return null
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return null
    }
    if (!propagate(work, regions)) return null
    let choice = -1
    for (let i = 0; i < 81; i++) {
      if (work[i] === 0) {
        choice = i
        break
      }
    }
    if (choice < 0) return isValidSolution(work, regions) ? Array.from(work) : null
    const backup = work.slice()
    for (let v = 1; v <= 9; v++) {
      work[choice] = v
      const found = dfs()
      if (found) return found
      for (let i = 0; i < 81; i++) work[i] = backup[i]!
      if (timedOut) return null
    }
    return null
  }
  return dfs()
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asSudokuPuzzle(puzzle)
  const s = asSudokuState(initialState)
  const regions = p.regions ?? []

  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0
  const emit = (index: number, to: number, kind: RuleKind | 'probe' | 'search'): void => {
    const from = displayed[index] ?? 0
    if (from === to) return
    displayed[index] = to
    if (kind === lastKind) streak++
    else {
      lastKind = kind
      streak = 1
    }
    frames.push({ rule: RULE_INFO[kind].rule, label: RULE_INFO[kind].label, move: { index, from, to }, streak })
  }
  const onSet = (index: number, value: number, kind: RuleKind): void => emit(index, value, kind)

  if (!propagate(grid, regions, onSet)) return emptyPlan

  let saturated = true
  for (let round = 0; round < 162; round++) {
    let unknown = -1
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) {
        unknown = i
        break
      }
    }
    if (unknown < 0) break
    if (frames.length > 8000) {
      saturated = false
      break
    }
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue
      const feasible: number[] = []
      for (let v = 1; v <= 9; v++) {
        const trial = grid.slice()
        trial[i] = v
        if (propagate(trial, regions)) feasible.push(v)
      }
      if (feasible.length === 0) return emptyPlan
      if (feasible.length === 1) forced.push({ index: i, value: feasible[0]! })
    }
    if (!forced.length) {
      saturated = false
      break
    }
    for (const { index, value } of forced) {
      if (grid[index] === 0) {
        grid[index] = value
        emit(index, value, 'probe')
      }
    }
    if (!propagate(grid, regions, onSet)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0) {
      stillUnknown = true
      break
    }
  }
  if (stillUnknown) {
    const found = fallbackSolve(grid, regions, 1_000_000)
    if (!found) return emptyPlan
    for (let i = 0; i < 81; i++) {
      if (grid[i] === found[i]) continue
      grid[i] = found[i]!
      emit(i, found[i]!, 'search')
    }
    saturated = false
  }

  const finalState: SudokuState = {
    puzzleId: s.puzzleId,
    width: 9,
    height: 9,
    cells: Array.from(grid),
    givens: s.givens.slice(),
  }
  return { puzzleId: p.id, frames, finalState, ruleSteps: frames.length, saturated }
}
