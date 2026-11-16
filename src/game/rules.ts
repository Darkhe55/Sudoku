/**
 * 数独 —— 规则引擎（任意 N）
 *
 * 单位（unit）= 一行 / 一列 / 一个宫。所有函数按实际边长 N 工作：
 *   N = width = height，格子数 = N²，数字范围 1..N。
 * 宫可以是标准 box×box，也可以是任意不规则宫（异形数独），只要
 * regions[i] 给的是「第 i 格属于哪个宫」即可。
 */

import { squareSize } from './types.ts'

export type RuleKind = 'latin' | 'region'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

/** 由格子数推算 N；region 数组长度就是格子数 */
export function sizeOfRegions(regions: ArrayLike<number>, fallback = 9): number {
  return squareSize(regions.length) || fallback
}

export function initialGrid(
  givens: ArrayLike<number>,
  size: number,
  n = squareSize(size) || 9,
): number[] {
  const grid = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    const v = givens[i] ?? 0
    if (v >= 1 && v <= n) grid[i] = v
  }
  return grid
}

/**
 * 生成全部单位：N 行 + N 列 + 所有宫（按宫号首次出现顺序）。
 * 宫数不要求等于 N（异形数独允许任意宫数，但有效题面通常等于 N）。
 */
export function makeUnits(regions: ArrayLike<number>, n = sizeOfRegions(regions)): number[][] {
  const size = n * n
  const units: number[][] = []
  for (let y = 0; y < n; y++) {
    const row: number[] = []
    for (let x = 0; x < n; x++) row.push(y * n + x)
    units.push(row)
  }
  for (let x = 0; x < n; x++) {
    const col: number[] = []
    for (let y = 0; y < n; y++) col.push(y * n + x)
    units.push(col)
  }
  const byRegion = new Map<number, number[]>()
  const limit = Math.min(regions.length, size)
  for (let i = 0; i < limit; i++) {
    const r = regions[i] ?? -1
    const list = byRegion.get(r)
    if (list) list.push(i)
    else byRegion.set(r, [i])
  }
  for (const cells of byRegion.values()) units.push(cells)
  return units
}

/** 每格参与的单位下标（加速候选数计算） */
function buildUnitIndex(units: number[][], size: number): number[][] {
  const unitOf: number[][] = Array.from({ length: size }, () => [])
  for (let u = 0; u < units.length; u++) {
    for (const i of units[u]!) if (i >= 0 && i < size) unitOf[i]!.push(u)
  }
  return unitOf
}

export function propagate(
  cells: number[],
  regions: ArrayLike<number>,
  onSet?: SetCallback,
  n = sizeOfRegions(regions),
): boolean {
  const size = n * n
  const units = makeUnits(regions, n)
  const unitOf = buildUnitIndex(units, size)
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== 0) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  const candidatesOf = (i: number): number[] => {
    if (cells[i] !== 0) return []
    const used = new Set<number>()
    for (const u of unitOf[i]!) {
      for (const j of units[u]!) if (cells[j] !== 0) used.add(cells[j]!)
    }
    const out: number[] = []
    for (let v = 1; v <= n; v++) if (!used.has(v)) out.push(v)
    return out
  }

  while (changed) {
    changed = false

    for (const unit of units) {
      const seen = new Set<number>()
      for (const i of unit) {
        const v = cells[i]!
        if (v === 0) continue
        if (seen.has(v)) return false
        seen.add(v)
      }
    }

    for (let i = 0; i < size; i++) {
      if (cells[i] !== 0) continue
      const cands = candidatesOf(i)
      if (cands.length === 0) return false
      if (cands.length === 1 && !set(i, cands[0]!, 'latin')) return false
    }

    for (const unit of units) {
      const has = new Set<number>()
      for (const i of unit) if (cells[i] !== 0) has.add(cells[i]!)
      for (let v = 1; v <= n; v++) {
        if (has.has(v)) continue
        const spots: number[] = []
        for (const i of unit) {
          if (cells[i] === 0 && candidatesOf(i).includes(v)) spots.push(i)
        }
        if (spots.length === 0) return false
        if (spots.length === 1 && !set(spots[0]!, v, 'region')) return false
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  regions: ArrayLike<number>,
  n = sizeOfRegions(regions),
): boolean {
  const size = n * n
  if (cells.length < size) return false
  for (let i = 0; i < size; i++) {
    const v = cells[i]!
    if (v < 1 || v > n) return false
  }
  const units = makeUnits(regions, n)
  for (const unit of units) {
    const seen = new Set<number>()
    for (const i of unit) {
      const v = cells[i]!
      if (seen.has(v)) return false
      seen.add(v)
    }
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

/**
 * 纯规则求解（唯一候选 + 宫内唯一位置 + 反证）。
 *
 * 大棋盘（N>9）的反证开销很大，加时间预算：超时即返回 ok:false，
 * 由调用方（solver/logic）改用回溯或部分回放。
 */
export function solveByRules(
  givens: ArrayLike<number>,
  regions: ArrayLike<number>,
  probing = true,
  maxRounds = 400,
  n = sizeOfRegions(regions),
  budgetMs = n > 9 ? 2500 : 60_000,
): RuleSolveResult {
  const size = n * n
  const grid = initialGrid(givens, size, n)
  const deadline = Date.now() + budgetMs
  let usedProbing = false

  const out = (partial: Partial<RuleSolveResult>): RuleSolveResult => ({
    ok: false,
    solution: null,
    contradiction: false,
    saturated: false,
    usedProbing,
    ...partial,
  })

  for (let round = 0; round < maxRounds; round++) {
    if (Date.now() > deadline) return out({})
    if (!propagate(grid, regions, undefined, n)) {
      return out({ contradiction: true })
    }
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === 0) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, regions, n)
      return { ok, solution: ok ? solution : null, contradiction: false, saturated: ok, usedProbing }
    }
    if (!probing) return out({})
    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== 0) continue
      if (Date.now() > deadline) return out({})
      const feasible: number[] = []
      for (let v = 1; v <= n; v++) {
        const trial = grid.slice()
        trial[i] = v
        if (propagate(trial, regions, undefined, n)) feasible.push(v)
      }
      if (feasible.length === 0) return out({ contradiction: true })
      if (feasible.length === 1) forced.push({ index: i, value: feasible[0]! })
    }
    if (!forced.length) return out({})
    for (const { index, value } of forced) {
      if (grid[index] === 0) grid[index] = value
    }
    if (!propagate(grid, regions, undefined, n)) return out({ contradiction: true })
  }
  return out({})
}
