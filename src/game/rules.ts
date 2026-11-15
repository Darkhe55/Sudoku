/**
 * 数独 —— 规则引擎
 */

export type RuleKind = 'latin' | 'region'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

const N = 9

export function initialGrid(givens: ArrayLike<number>, size: number): number[] {
  const grid = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    const v = givens[i] ?? 0
    if (v >= 1) grid[i] = v
  }
  return grid
}

export function makeUnits(regions: ArrayLike<number>): number[][] {
  const units: number[][] = []
  for (let y = 0; y < N; y++) {
    const row: number[] = []
    for (let x = 0; x < N; x++) row.push(y * N + x)
    units.push(row)
  }
  for (let x = 0; x < N; x++) {
    const col: number[] = []
    for (let y = 0; y < N; y++) col.push(y * N + x)
    units.push(col)
  }
  for (let r = 0; r < N; r++) {
    const cells: number[] = []
    for (let i = 0; i < N * N; i++) if (regions[i] === r) cells.push(i)
    if (cells.length) units.push(cells)
  }
  return units
}

export function propagate(
  cells: number[],
  regions: ArrayLike<number>,
  onSet?: SetCallback,
): boolean {
  const size = N * N
  const units = makeUnits(regions)
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== 0) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  const candidatesOf = (i: number, kind: RuleKind): number[] => {
    if (cells[i] !== 0) return []
    const used = new Set<number>()
    for (const unit of units) {
      if (!unit.includes(i)) continue
      for (const j of unit) if (cells[j] !== 0) used.add(cells[j]!)
    }
    const out: number[] = []
    for (let v = 1; v <= N; v++) if (!used.has(v)) out.push(v)
    void kind
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
      const cands = candidatesOf(i, 'latin')
      if (cands.length === 0) return false
      if (cands.length === 1 && !set(i, cands[0]!, 'latin')) return false
    }

    for (const unit of units) {
      const has = new Set<number>()
      for (const i of unit) if (cells[i] !== 0) has.add(cells[i]!)
      for (let v = 1; v <= N; v++) {
        if (has.has(v)) continue
        const spots: number[] = []
        for (const i of unit) {
          if (cells[i] === 0 && candidatesOf(i, 'region').includes(v)) spots.push(i)
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
): boolean {
  for (let i = 0; i < N * N; i++) {
    if (cells[i]! < 1 || cells[i]! > N) return false
  }
  const units = makeUnits(regions)
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

export function solveByRules(
  givens: ArrayLike<number>,
  regions: ArrayLike<number>,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const size = N * N
  const grid = initialGrid(givens, size)
  let usedProbing = false
  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, regions)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
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
      const ok = isValidSolution(solution, regions)
      return { ok, solution: ok ? solution : null, contradiction: false, saturated: ok, usedProbing }
    }
    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== 0) continue
      const feasible: number[] = []
      for (let v = 1; v <= N; v++) {
        const trial = grid.slice()
        trial[i] = v
        if (propagate(trial, regions)) feasible.push(v)
      }
      if (feasible.length === 0) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (feasible.length === 1) forced.push({ index: i, value: feasible[0]! })
    }
    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === 0) grid[index] = value
    }
    if (!propagate(grid, regions)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }
  }
  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
