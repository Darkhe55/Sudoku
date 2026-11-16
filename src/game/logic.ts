/**
 * 数独 —— 逻辑解题回放计划（任意 N）
 *
 * 与 9×9 行为一致：先规则传播，再用反证；推不满时退回回溯并标为 search。
 * 大棋盘（N>9）反证代价高，加了时间预算：超时则保留已推出的帧并标记 saturated=false。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type RuleKind } from './rules.ts'
import { asSudokuPuzzle, asSudokuState, squareSize, type SudokuState } from './types.ts'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  latin: { rule: 1, label: '行/列/宫数字不能重复' },
  region: { rule: 2, label: '宫内唯一位置' },
  probe: { rule: 3, label: '反证：其他数字会立刻矛盾' },
  search: { rule: 4, label: '回溯试探：该格最终是这个数字' },
}

function fallbackSolve(
  grid: number[],
  regions: number[],
  n: number,
  maxNodes: number,
): number[] | null {
  const size = n * n
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
    if (!propagate(work, regions, undefined, n)) return null
    let choice = -1
    for (let i = 0; i < size; i++) {
      if (work[i] === 0) {
        choice = i
        break
      }
    }
    if (choice < 0) return isValidSolution(work, regions, n) ? Array.from(work) : null
    const backup = work.slice()
    for (let v = 1; v <= n; v++) {
      work[choice] = v
      const found = dfs()
      if (found) return found
      for (let i = 0; i < size; i++) work[i] = backup[i]!
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
  const n = squareSize(regions.length) || p.width || 9
  const size = n * n

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

  if (!propagate(grid, regions, onSet, n)) return emptyPlan

  // 大棋盘的反证预算（毫秒）
  const deadline = Date.now() + (n > 9 ? 6000 : 60_000)
  const maxRounds = n > 9 ? 24 : 162
  const maxProbeCells = n > 9 ? 48 : size
  let saturated = true

  for (let round = 0; round < maxRounds; round++) {
    if (Date.now() > deadline) {
      saturated = false
      break
    }
    let unknown = -1
    for (let i = 0; i < size; i++) {
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
    let probed = 0
    for (let i = 0; i < size; i++) {
      if (grid[i] !== 0) continue
      if (probed >= maxProbeCells || Date.now() > deadline) {
        saturated = false
        break
      }
      probed++
      const feasible: number[] = []
      for (let v = 1; v <= n; v++) {
        const trial = grid.slice()
        trial[i] = v
        if (propagate(trial, regions, undefined, n)) feasible.push(v)
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
    if (!propagate(grid, regions, onSet, n)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === 0) {
      stillUnknown = true
      break
    }
  }
  if (stillUnknown) {
    const found = fallbackSolve(grid, regions, n, n > 9 ? 200_000 : 1_000_000)
    if (!found) {
      // 大棋盘来回溯不出来时，保留已推出的帧（可回放但未推满）
      if (n > 9 && frames.length) {
        const partial: SudokuState = {
          puzzleId: s.puzzleId,
          width: s.width,
          height: s.height,
          cells: Array.from(displayed),
          givens: s.givens.slice(),
        }
        return { puzzleId: p.id, frames, finalState: partial, ruleSteps: frames.length, saturated: false }
      }
      return emptyPlan
    }
    for (let i = 0; i < size; i++) {
      if (grid[i] === found[i]) continue
      grid[i] = found[i]!
      emit(i, found[i]!, 'search')
    }
    saturated = false
  }

  const finalState: SudokuState = {
    puzzleId: s.puzzleId,
    width: s.width || n,
    height: s.height || n,
    cells: Array.from(grid),
    givens: s.givens.slice(),
  }
  return { puzzleId: p.id, frames, finalState, ruleSteps: frames.length, saturated }
}
