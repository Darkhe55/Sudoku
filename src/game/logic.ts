/**
 * 数独 —— 逻辑解题回放计划（任意 N）
 *
 * 与 9×9 行为一致：先规则传播，再用反证；推不满时退回回溯并标为 search。
 * 大棋盘（N>9）反证代价高，加了时间预算：超时则保留已推出的帧并标记 saturated=false。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type PropagateOptions, type RuleKind } from './rules.ts'
import { countSolutions } from './solver.ts'
import { asSudokuPuzzle, asSudokuState, squareSize, type SudokuState } from './types.ts'

/**
 * 规则分类（回放里显示为「规则N · 说明」）：
 *   1 = 行/列/宫基础互异（唯一候选）
 *   2 = 单元内唯一位置（隐性唯一）
 *   3 = 高级集合定式（宫-行列交叉、数对/三数组、X-Wing、Swordfish、XY-Wing、唯一矩形）
 *   4 = 反证（其他数字会立刻矛盾）
 *   5 = 回溯试探（兜底）
 */
const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  latin: { rule: 1, label: '行/列/宫数字不能重复（唯一候选）' },
  region: { rule: 2, label: '单元内唯一位置（隐性唯一）' },
  pointing: { rule: 3, label: '宫-行/列交叉：指向消除后落子' },
  claiming: { rule: 3, label: '行/列-宫交叉：占位消除后落子' },
  subset: { rule: 3, label: '显性/隐性数对·三数组' },
  fish: { rule: 3, label: 'X-Wing / Swordfish 鱼形' },
  wing: { rule: 3, label: 'XY-Wing 三格翼' },
  uniqueness: { rule: 3, label: '唯一矩形（题面唯一解前提下）' },
  probe: { rule: 4, label: '反证：其他数字会立刻矛盾' },
  search: { rule: 5, label: '回溯试探：该格最终是这个数字' },
}

/**
 * 是否题面唯一解（给「唯一矩形」做前提）。
 * 只在 9×9 及以下做预算内检查；大棋盘为性能考虑不启用唯一矩形。
 */
function assumeUnique(givens: number[], regions: number[], n: number): boolean {
  if (n > 9) return false
  const counted = countSolutions(givens, regions, 2, 200_000, n)
  return !counted.timedOut && counted.count === 1
}

function fallbackSolve(
  grid: number[],
  regions: number[],
  n: number,
  maxNodes: number,
  options: PropagateOptions,
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
    if (!propagate(work, regions, undefined, n, options)) return null
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

  // 唯一矩形需要「题面唯一解」前提；其余高级定式无条件可用
  const options: PropagateOptions = { unique: assumeUnique(s.givens.slice(), regions, n) }

  if (!propagate(grid, regions, onSet, n, options)) return emptyPlan

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
        if (propagate(trial, regions, undefined, n, options)) feasible.push(v)
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
    if (!propagate(grid, regions, onSet, n, options)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === 0) {
      stillUnknown = true
      break
    }
  }
  if (stillUnknown) {
    const found = fallbackSolve(grid, regions, n, n > 9 ? 200_000 : 1_000_000, options)
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
