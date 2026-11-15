/**
 * 数独 —— 回溯求解器
 */

import type { Puzzle, SolveResult } from '../core/types'
import { initialGrid, isValidSolution, propagate, solveByRules } from './rules.ts'
import type { SudokuPuzzle, SudokuState } from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  givens: number[],
  regions: number[],
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const size = 81
  const grid = initialGrid(givens, size)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(grid, regions)) return

    let choice = -1
    let best = Infinity
    let bestValues: number[] = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== 0) continue
      const x = i % 9
      const y = (i / 9) | 0
      const used = new Set<number>()
      for (let k = 0; k < 9; k++) {
        if (grid[y * 9 + k] !== 0) used.add(grid[y * 9 + k]!)
        if (grid[k * 9 + x] !== 0) used.add(grid[k * 9 + x]!)
      }
      for (let k = 0; k < size; k++) {
        if (regions[k] === regions[i] && grid[k] !== 0) used.add(grid[k]!)
      }
      const cands: number[] = []
      for (let v = 1; v <= 9; v++) if (!used.has(v)) cands.push(v)
      if (cands.length < best) {
        best = cands.length
        choice = i
        bestValues = cands
      }
    }

    if (choice < 0) {
      if (isValidSolution(grid, regions)) solutions.push(Array.from(grid))
      return
    }

    const backup = Array.from(grid)
    for (const v of bestValues) {
      if (solutions.length >= limit || timedOut) return
      grid[choice] = v
      dfs()
      for (let i = 0; i < size; i++) grid[i] = backup[i]!
    }
  }
  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  givens: number[],
  regions: number[],
  limit = 2,
  maxNodes = 300_000,
): CountOutcome {
  const out = search(givens, regions, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as SudokuPuzzle
  if (!p.givens || !p.regions || p.givens.length !== 81) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const byRules = solveByRules(p.givens, p.regions, true, 240)
  if (byRules.ok && byRules.solution) {
    return { solved: true, solution: makeState(p, byRules.solution), nodes: 0, timedOut: false }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const out = search(p.givens, p.regions, 1, maxNodes)
  const solution = out.solutions[0]
  return {
    solved: !!solution,
    solution: solution ? makeState(p, solution) : null,
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

export function makeState(puzzle: SudokuPuzzle, cells: number[]): SudokuState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: puzzle.givens.slice(),
  }
}
