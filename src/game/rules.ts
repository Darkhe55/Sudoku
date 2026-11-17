/**
 * 数独 —— 规则引擎（任意 N）
 *
 * 单位（unit）= 一行 / 一列 / 一个宫。所有函数按实际边长 N 工作：
 *   N = width = height，格子数 = N²，数字范围 1..N。
 * 宫可以是标准 box×box，也可以是任意不规则宫（异形数独），只要
 * regions[i] 给的是「第 i 格属于哪个宫」即可。
 *
 * 逻辑定式（全部为可证明的候选消除 / 落子，不依赖对内置题硬编码）：
 *   基础：唯一候选（latin）、单元内唯一位置（region）
 *   高级：宫-行/列交叉（pointing / claiming）、显性/隐性数对与三数组（subset）、
 *         X-Wing / Swordfish（fish）、XY-Wing（wing）、唯一矩形（uniqueness）
 * 高级定式只维护「候选集」：任何落子都能追溯到某个定式的集合条件，反证/回溯
 * 仍由 solveByRules / logic 兜底。
 *
 * 唯一矩形依赖「题目有唯一解」这一前提，默认关闭（options.unique = true 才启用），
 * 由调用方确认题面唯一解后再打开。
 */

import { squareSize } from './types.ts'

/** 落子依据：基础规则 + 高级定式 */
export type RuleKind =
  | 'latin'
  | 'region'
  | 'pointing'
  | 'claiming'
  | 'subset'
  | 'fish'
  | 'wing'
  | 'uniqueness'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

/** 高级定式选项 */
export interface PropagateOptions {
  /** 允许「唯一矩形」这类以唯一解为前提的定式（调用方需先确认题面唯一解） */
  unique?: boolean
  /** 启用高级定式的最大边长（更大的棋盘只跑基础传播，避免拖慢回溯） */
  maxAdvancedN?: number
}

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

const bitOf = (v: number): number => 1 << (v - 1)

export function popcount(x: number): number {
  let n = 0
  while (x) {
    x &= x - 1
    n++
  }
  return n
}

/** 单比特掩码 → 数字（1 基） */
export function lowValue(x: number): number {
  return 31 - Math.clz32(x) + 1
}

/** 高级定式内部用于提前退出（候选集被删空 = 矛盾） */
class Contradiction extends Error {}

interface Units {
  all: number[][]
  rows: number[][]
  cols: number[][]
  boxes: number[][]
  unitOf: number[][]
  rowOf: number[]
  colOf: number[]
  /** 每格所属宫在 boxes 数组中的下标（-1 = 无宫） */
  boxOf: number[]
}

function buildUnits(regions: ArrayLike<number>, n: number): Units {
  const size = n * n
  const rows: number[][] = []
  const cols: number[][] = []
  for (let y = 0; y < n; y++) {
    const row: number[] = []
    for (let x = 0; x < n; x++) row.push(y * n + x)
    rows.push(row)
  }
  for (let x = 0; x < n; x++) {
    const col: number[] = []
    for (let y = 0; y < n; y++) col.push(y * n + x)
    cols.push(col)
  }
  const boxMap = new Map<number, number[]>()
  const limit = Math.min(regions.length, size)
  for (let i = 0; i < limit; i++) {
    const r = regions[i] ?? -1
    const list = boxMap.get(r)
    if (list) list.push(i)
    else boxMap.set(r, [i])
  }
  const boxes = Array.from(boxMap.values())
  const rowOf = new Array<number>(size)
  const colOf = new Array<number>(size)
  for (let i = 0; i < size; i++) {
    rowOf[i] = Math.floor(i / n)
    colOf[i] = i % n
  }
  const boxOf = new Array<number>(size).fill(-1)
  for (let b = 0; b < boxes.length; b++) for (const i of boxes[b]!) boxOf[i] = b
  const all = [...rows, ...cols, ...boxes]
  return { all, rows, cols, boxes, unitOf: buildUnitIndex(all, size), rowOf, colOf, boxOf }
}

/** 每格与哪些格共享单位（行/列/宫）——XY-Wing 用 */
function buildPeerSets(units: Units, size: number): number[][] {
  const sets: Array<Set<number>> = Array.from({ length: size }, () => new Set<number>())
  for (const unit of units.all) {
    for (const i of unit) {
      for (const j of unit) if (i !== j) sets[i]!.add(j)
    }
  }
  return sets.map((s) => Array.from(s))
}

export function propagate(
  cells: number[],
  regions: ArrayLike<number>,
  onSet?: SetCallback,
  n = sizeOfRegions(regions),
  options: PropagateOptions = {},
): boolean {
  const size = n * n
  const units = buildUnits(regions, n)
  const full = n >= 31 ? 0x7fffffff : ((1 << n) - 1) >>> 0
  const advancedAllowed = n <= (options.maxAdvancedN ?? 16)
  const uniqueAllowed = options.unique === true && advancedAllowed
  const peers = advancedAllowed ? buildPeerSets(units, size) : null

  /** 被高级定式排除掉的候选（在同一次 propagate 内持续有效：逻辑上不可逆） */
  const banned = new Array<number>(size).fill(0)
  const masks = new Array<number>(size).fill(0)
  let pending = new Map<number, RuleKind>()

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== 0) return false
    cells[i] = value
    onSet?.(i, value, kind)
    return true
  }

  /** 依据「行/列/宫已用数字 + 已排除候选」重算全部候选掩码 */
  const refreshMasks = (): boolean => {
    for (let i = 0; i < size; i++) {
      if (cells[i] !== 0) {
        masks[i] = 0
        continue
      }
      let used = 0
      for (const u of units.unitOf[i]!) {
        for (const j of units.all[u]!) {
          const v = cells[j]!
          if (v !== 0) used |= bitOf(v)
        }
      }
      const m = full & ~used & ~banned[i]!
      masks[i] = m
    }
    for (let i = 0; i < size; i++) if (cells[i] === 0 && masks[i] === 0) return false
    return true
  }

  /** 从 i 的候选中删掉一组数字；返回是否真的删掉了 */
  const eliminate = (i: number, remove: number, kind: RuleKind): boolean => {
    if (cells[i] !== 0) return false
    const cur = masks[i]!
    if (cur === 0) return false
    const next = cur & ~remove
    if (next === cur) return false
    banned[i]! |= cur & ~next
    masks[i] = next
    if (next === 0) throw new Contradiction()
    if ((next & (next - 1)) === 0) pending.set(i, kind)
    return true
  }

  // —— 高级定式 —— //

  /** 宫-行/列交叉（指向）：宫内某数字只出现在同一行/列 → 该行/列其余格不能放它 */
  const pointingPass = (): boolean => {
    let eliminated = false
    for (let b = 0; b < units.boxes.length; b++) {
      const box = units.boxes[b]!
      for (let v = 1; v <= n; v++) {
        const bit = bitOf(v)
        let count = 0
        let row = -1
        let col = -1
        let sameRow = true
        let sameCol = true
        for (const i of box) {
          if (cells[i] !== 0 || !(masks[i]! & bit)) continue
          if (count === 0) {
            row = units.rowOf[i]!
            col = units.colOf[i]!
          } else {
            if (units.rowOf[i] !== row) sameRow = false
            if (units.colOf[i] !== col) sameCol = false
          }
          count++
        }
        if (count < 2) continue
        if (sameRow && row >= 0) {
          for (const i of units.rows[row]!) {
            if (units.boxOf[i] === b) continue
            if (eliminate(i, bit, 'pointing')) eliminated = true
          }
        }
        if (sameCol && col >= 0) {
          for (const i of units.cols[col]!) {
            if (units.boxOf[i] === b) continue
            if (eliminate(i, bit, 'pointing')) eliminated = true
          }
        }
      }
    }
    return eliminated
  }

  /** 行/列-宫交叉（占位）：行/列内某数字只出现在同一宫 → 该宫其余格不能放它 */
  const claimingPass = (): boolean => {
    let eliminated = false
    const lines: Array<{ cells: number[]; index: number; isRow: boolean }> = []
    for (let r = 0; r < n; r++) lines.push({ cells: units.rows[r]!, index: r, isRow: true })
    for (let c = 0; c < n; c++) lines.push({ cells: units.cols[c]!, index: c, isRow: false })
    for (const line of lines) {
      for (let v = 1; v <= n; v++) {
        const bit = bitOf(v)
        let box = -1
        let count = 0
        let mixed = false
        for (const i of line.cells) {
          if (cells[i] !== 0 || !(masks[i]! & bit)) continue
          const b = units.boxOf[i]!
          if (b < 0 || (box >= 0 && b !== box)) {
            mixed = true
            break
          }
          box = b
          count++
        }
        if (mixed || count < 2 || box < 0) continue
        for (const i of units.boxes[box]!) {
          if (line.isRow ? units.rowOf[i] === line.index : units.colOf[i] === line.index) continue
          if (eliminate(i, bit, 'claiming')) eliminated = true
        }
      }
    }
    return eliminated
  }

  /** 显性数对 / 三数组：k 格候选并集恰为 k 个数字 → 该单元其余格不能放这些数字 */
  const nakedSubsetPass = (): boolean => {
    let eliminated = false
    for (const unit of units.all) {
      const spots: number[] = []
      for (const i of unit) if (cells[i] === 0 && popcount(masks[i]!) >= 2) spots.push(i)
      const m = spots.length
      if (m < 2) continue
      for (let a = 0; a < m - 1; a++) {
        const ia = spots[a]!
        const ma = masks[ia]!
        if (popcount(ma) > 3) continue
        for (let b = a + 1; b < m; b++) {
          const ib = spots[b]!
          const pairUnion = ma | masks[ib]!
          const pc = popcount(pairUnion)
          if (pc === 2) {
            for (const i of unit) {
              if (i !== ia && i !== ib && eliminate(i, pairUnion, 'subset')) eliminated = true
            }
            continue
          }
          if (pc > 3) continue
          for (let c = b + 1; c < m; c++) {
            const ic = spots[c]!
            const tripleUnion = pairUnion | masks[ic]!
            if (popcount(tripleUnion) !== 3) continue
            for (const i of unit) {
              if (i !== ia && i !== ib && i !== ic && eliminate(i, tripleUnion, 'subset')) eliminated = true
            }
          }
        }
      }
    }
    return eliminated
  }

  /** 隐性数对 / 三数组：k 个数字只能落在同一单元的 k 格里 → 这 k 格不能再放别的数字 */
  const hiddenSubsetPass = (): boolean => {
    let eliminated = false
    for (const unit of units.all) {
      const posOfDigit: number[][] = Array.from({ length: n + 1 }, () => [])
      for (const i of unit) {
        if (cells[i] !== 0) continue
        const m = masks[i]!
        for (let v = 1; v <= n; v++) if (m & bitOf(v)) posOfDigit[v]!.push(i)
      }
      const active: number[] = []
      for (let v = 1; v <= n; v++) {
        const len = posOfDigit[v]!.length
        if (len >= 2 && len <= 3) active.push(v)
      }
      for (let a = 0; a < active.length - 1; a++) {
        const va = active[a]!
        const pa = posOfDigit[va]!
        for (let b = a + 1; b < active.length; b++) {
          const vb = active[b]!
          const pairSet = new Set<number>([...pa, ...posOfDigit[vb]!])
          if (pairSet.size === 2) {
            const digits = bitOf(va) | bitOf(vb)
            for (const i of pairSet) if (eliminate(i, full & ~digits, 'subset')) eliminated = true
            continue
          }
          if (pairSet.size !== 3) continue
          for (let c = b + 1; c < active.length; c++) {
            const vc = active[c]!
            const tripleSet = new Set<number>([...pa, ...posOfDigit[vb]!, ...posOfDigit[vc]!])
            if (tripleSet.size !== 3) continue
            const digits = bitOf(va) | bitOf(vb) | bitOf(vc)
            for (const i of tripleSet) if (eliminate(i, full & ~digits, 'subset')) eliminated = true
          }
        }
      }
    }
    return eliminated
  }

  /** X-Wing：某个数字在两行中都只出现在同样两列 → 这两列的其余行不能放它（列同理） */
  const xWingPass = (): boolean => {
    let eliminated = false
    for (let v = 1; v <= n; v++) {
      const bit = bitOf(v)
      const rowSpots: number[][] = []
      for (let r = 0; r < n; r++) {
        const spots: number[] = []
        for (const i of units.rows[r]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        rowSpots.push(spots)
      }
      for (let r1 = 0; r1 < n - 1; r1++) {
        const s1 = rowSpots[r1]!
        if (s1.length !== 2) continue
        const c1 = units.colOf[s1[0]!]!
        const c2 = units.colOf[s1[1]!]!
        for (let r2 = r1 + 1; r2 < n; r2++) {
          const s2 = rowSpots[r2]!
          if (s2.length !== 2) continue
          if (units.colOf[s2[0]!] !== c1 || units.colOf[s2[1]!] !== c2) continue
          for (let r = 0; r < n; r++) {
            if (r === r1 || r === r2) continue
            for (const i of units.rows[r]!) {
              const c = units.colOf[i]!
              if (c !== c1 && c !== c2) continue
              if (eliminate(i, bit, 'fish')) eliminated = true
            }
          }
        }
      }
      const colSpots: number[][] = []
      for (let c = 0; c < n; c++) {
        const spots: number[] = []
        for (const i of units.cols[c]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        colSpots.push(spots)
      }
      for (let c1 = 0; c1 < n - 1; c1++) {
        const s1 = colSpots[c1]!
        if (s1.length !== 2) continue
        const r1 = units.rowOf[s1[0]!]!
        const r2 = units.rowOf[s1[1]!]!
        for (let c2 = c1 + 1; c2 < n; c2++) {
          const s2 = colSpots[c2]!
          if (s2.length !== 2) continue
          if (units.rowOf[s2[0]!] !== r1 || units.rowOf[s2[1]!] !== r2) continue
          for (let c = 0; c < n; c++) {
            if (c === c1 || c === c2) continue
            for (const i of units.cols[c]!) {
              const r = units.rowOf[i]!
              if (r !== r1 && r !== r2) continue
              if (eliminate(i, bit, 'fish')) eliminated = true
            }
          }
        }
      }
    }
    return eliminated
  }

  /** Swordfish：某个数字在三行中只落在三列内 → 这三列的其余行不能放它（列同理） */
  const swordfishPass = (): boolean => {
    let eliminated = false
    for (let v = 1; v <= n; v++) {
      const bit = bitOf(v)
      const rowSpots: number[][] = []
      for (let r = 0; r < n; r++) {
        const spots: number[] = []
        for (const i of units.rows[r]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        rowSpots.push(spots)
      }
      for (let r1 = 0; r1 < n - 2; r1++) {
        const s1 = rowSpots[r1]!
        if (s1.length < 2 || s1.length > 3) continue
        for (let r2 = r1 + 1; r2 < n - 1; r2++) {
          const s2 = rowSpots[r2]!
          if (s2.length < 2 || s2.length > 3) continue
          for (let r3 = r2 + 1; r3 < n; r3++) {
            const s3 = rowSpots[r3]!
            if (s3.length < 2 || s3.length > 3) continue
            const colSet = new Set<number>()
            let tooWide = false
            for (const i of s1) {
              colSet.add(units.colOf[i]!)
              if (colSet.size > 3) tooWide = true
            }
            for (const i of s2) {
              colSet.add(units.colOf[i]!)
              if (colSet.size > 3) tooWide = true
            }
            for (const i of s3) {
              colSet.add(units.colOf[i]!)
              if (colSet.size > 3) tooWide = true
            }
            if (tooWide || colSet.size !== 3) continue
            const cols = Array.from(colSet)
            for (let r = 0; r < n; r++) {
              if (r === r1 || r === r2 || r === r3) continue
              for (const i of units.rows[r]!) {
                if (!cols.includes(units.colOf[i]!)) continue
                if (eliminate(i, bit, 'fish')) eliminated = true
              }
            }
          }
        }
      }
      const colSpots: number[][] = []
      for (let c = 0; c < n; c++) {
        const spots: number[] = []
        for (const i of units.cols[c]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        colSpots.push(spots)
      }
      for (let c1 = 0; c1 < n - 2; c1++) {
        const s1 = colSpots[c1]!
        if (s1.length < 2 || s1.length > 3) continue
        for (let c2 = c1 + 1; c2 < n - 1; c2++) {
          const s2 = colSpots[c2]!
          if (s2.length < 2 || s2.length > 3) continue
          for (let c3 = c2 + 1; c3 < n; c3++) {
            const s3 = colSpots[c3]!
            if (s3.length < 2 || s3.length > 3) continue
            const rowSet = new Set<number>()
            let tooWide = false
            for (const i of s1) {
              rowSet.add(units.rowOf[i]!)
              if (rowSet.size > 3) tooWide = true
            }
            for (const i of s2) {
              rowSet.add(units.rowOf[i]!)
              if (rowSet.size > 3) tooWide = true
            }
            for (const i of s3) {
              rowSet.add(units.rowOf[i]!)
              if (rowSet.size > 3) tooWide = true
            }
            if (tooWide || rowSet.size !== 3) continue
            const rows = Array.from(rowSet)
            for (let c = 0; c < n; c++) {
              if (c === c1 || c === c2 || c === c3) continue
              for (const i of units.cols[c]!) {
                if (!rows.includes(units.rowOf[i]!)) continue
                if (eliminate(i, bit, 'fish')) eliminated = true
              }
            }
          }
        }
      }
    }
    return eliminated
  }

  /** XY-Wing：支点 {a,b}，两翼 {a,c} / {b,c} → 同时看见两翼的格子不能放 c */
  const xyWingPass = (): boolean => {
    if (!peers) return false
    let eliminated = false
    for (let p = 0; p < size; p++) {
      if (cells[p] !== 0) continue
      const mp = masks[p]!
      if (popcount(mp) !== 2) continue
      const a = lowValue(mp & -mp)
      const b = lowValue(mp & (mp - 1))
      const wingsA: number[] = []
      const wingsB: number[] = []
      for (const j of peers[p]!) {
        if (cells[j] !== 0) continue
        const mj = masks[j]!
        if (popcount(mj) !== 2) continue
        if (mj & bitOf(a)) {
          if (mj & bitOf(b)) continue
          wingsA.push(j)
        } else if (mj & bitOf(b)) {
          wingsB.push(j)
        }
      }
      for (const wa of wingsA) {
        const c = lowValue(masks[wa]! & ~bitOf(a))
        if (!c || c === b || c === a) continue
        for (const wb of wingsB) {
          if (!(masks[wb]! & bitOf(b)) || !(masks[wb]! & bitOf(c))) continue
          const common: number[] = []
          for (const j of peers[wa]!) {
            if (j === p || j === wa || j === wb) continue
            if (peers[wb]!.includes(j)) common.push(j)
          }
          for (const j of common) if (eliminate(j, bitOf(c), 'wing')) eliminated = true
        }
      }
    }
    return eliminated
  }

  /** Skyscraper：某数字在两行各只有两个位置且共用一列 → 两行各自的另一列至少一个是它，
   *  同时看见这两个位置（不在两行内）的格子不能放它（列同理） */
  const skyscraperPass = (): boolean => {
    let eliminated = false
    for (let v = 1; v <= n; v++) {
      const bit = bitOf(v)
      const rowSpots: number[][] = []
      for (let r = 0; r < n; r++) {
        const spots: number[] = []
        for (const i of units.rows[r]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        rowSpots.push(spots)
      }
      for (let r1 = 0; r1 < n - 1; r1++) {
        const s1 = rowSpots[r1]!
        if (s1.length !== 2) continue
        const cA = units.colOf[s1[0]!]!
        const cB = units.colOf[s1[1]!]!
        for (let r2 = r1 + 1; r2 < n; r2++) {
          const s2 = rowSpots[r2]!
          if (s2.length !== 2) continue
          const d1 = units.colOf[s2[0]!]!
          const d2 = units.colOf[s2[1]!]!
          // 共用一列 → 各自的另一列至少一个为 v
          const shared = cA === d1 || cA === d2 ? cA : cB === d1 || cB === d2 ? cB : -1
          if (shared < 0) continue
          const c1 = cA === shared ? cB : cA
          const c2 = d1 === shared ? d2 : d1
          if (c1 === c2) continue
          const p1 = r1 * n + c1
          const p2 = r2 * n + c2
          for (let i = 0; i < size; i++) {
            if (units.rowOf[i] === r1 || units.rowOf[i] === r2) continue
            if (units.colOf[i] !== c1 && units.colOf[i] !== c2) continue
            const sees1 = units.colOf[i] === c1 || units.boxOf[i] === units.boxOf[p1]
            const sees2 = units.colOf[i] === c2 || units.boxOf[i] === units.boxOf[p2]
            if (!sees1 || !sees2) continue
            if (!(masks[i]! & bit)) continue
            if (eliminate(i, bit, 'fish')) eliminated = true
          }
        }
      }
      const colSpots: number[][] = []
      for (let c = 0; c < n; c++) {
        const spots: number[] = []
        for (const i of units.cols[c]!) if (cells[i] === 0 && masks[i]! & bit) spots.push(i)
        colSpots.push(spots)
      }
      for (let c1 = 0; c1 < n - 1; c1++) {
        const s1 = colSpots[c1]!
        if (s1.length !== 2) continue
        const rA = units.rowOf[s1[0]!]!
        const rB = units.rowOf[s1[1]!]!
        for (let c2 = c1 + 1; c2 < n; c2++) {
          const s2 = colSpots[c2]!
          if (s2.length !== 2) continue
          const e1 = units.rowOf[s2[0]!]!
          const e2 = units.rowOf[s2[1]!]!
          const shared = rA === e1 || rA === e2 ? rA : rB === e1 || rB === e2 ? rB : -1
          if (shared < 0) continue
          const r1 = rA === shared ? rB : rA
          const r2 = e1 === shared ? e2 : e1
          if (r1 === r2) continue
          const p1 = r1 * n + c1
          const p2 = r2 * n + c2
          for (let i = 0; i < size; i++) {
            if (units.colOf[i] === c1 || units.colOf[i] === c2) continue
            if (units.rowOf[i] !== r1 && units.rowOf[i] !== r2) continue
            const sees1 = units.rowOf[i] === r1 || units.boxOf[i] === units.boxOf[p1]
            const sees2 = units.rowOf[i] === r2 || units.boxOf[i] === units.boxOf[p2]
            if (!sees1 || !sees2) continue
            if (!(masks[i]! & bit)) continue
            if (eliminate(i, bit, 'fish')) eliminated = true
          }
        }
      }
    }
    return eliminated
  }

  /** XYZ-Wing：支点 {a,b,c}，两翼 {a,b} / {a,c} 都看见支点 → 同时看见三格的格子不能放 a */
  const xyzWingPass = (): boolean => {
    if (!peers) return false
    let eliminated = false
    for (let p = 0; p < size; p++) {
      if (cells[p] !== 0) continue
      const mp = masks[p]!
      if (popcount(mp) !== 3) continue
      const digits: number[] = []
      for (let v = 1; v <= n; v++) if (mp & bitOf(v)) digits.push(v)
      const wings: Array<{ index: number; pair: number }> = []
      for (const j of peers[p]!) {
        if (cells[j] !== 0) continue
        const mj = masks[j]!
        if (popcount(mj) !== 2) continue
        if ((mj & ~mp) !== 0) continue
        wings.push({ index: j, pair: mj })
      }
      if (wings.length < 2) continue
      let found: { cell: number; pair: number } | null = null
      for (let a = 0; a < wings.length - 1 && !found; a++) {
        const w1 = wings[a]!
        for (let b = a + 1; b < wings.length; b++) {
          const w2 = wings[b]!
          if (w1.pair === w2.pair) continue
          const common = w1.pair & w2.pair
          if (popcount(common) !== 1) continue
          // 两翼必须分别缺一个支点数字，且合起来覆盖支点
          if ((w1.pair | w2.pair) !== mp) continue
          found = { cell: common, pair: w1.pair ^ w2.pair }
          const target = lowValue(common)
          for (const j of peers[p]!) {
            if (j === w1.index || j === w2.index || j === p) continue
            if (!peers[w1.index]!.includes(j) || !peers[w2.index]!.includes(j)) continue
            if (!(masks[j]! & bitOf(target))) continue
            if (eliminate(j, bitOf(target), 'wing')) eliminated = true
          }
          break
        }
      }
    }
    return eliminated
  }

  /**
   * 唯一矩形（Type 1）：两行两列四格都含 {a,b}，其中三格候选恰好是 {a,b}，
   * 第四格还有别的候选 → 第四格不能是 a/b（否则会形成可互换的致命矩形）。
   * 前提：题面有唯一解；四格必须恰好落在两个宫里（每宫两格），这样交换 a/b
   * 仍满足宫互异。默认关闭。
   */
  const uniqueRectanglePass = (): boolean => {
    let eliminated = false
    for (let r1 = 0; r1 < n - 1; r1++) {
      for (let r2 = r1 + 1; r2 < n; r2++) {
        for (let c1 = 0; c1 < n - 1; c1++) {
          for (let c2 = c1 + 1; c2 < n; c2++) {
            const four = [r1 * n + c1, r1 * n + c2, r2 * n + c1, r2 * n + c2]
            let skip = false
            for (const i of four) if (cells[i] !== 0) skip = true
            if (skip) continue
            const all = four.map((i) => masks[i]!)
            const pairs = all.filter((m) => popcount(m) === 2)
            if (pairs.length !== 3) continue
            const deadly = pairs[0]!
            if (pairs[1] !== deadly || pairs[2] !== deadly) continue
            const fourthIdx = all.findIndex((m) => popcount(m) > 2)
            if (fourthIdx < 0) continue
            const fourth = all[fourthIdx]!
            if ((fourth & deadly) !== deadly) continue
            const b1 = units.boxOf[four[0]!]!
            const b2 = units.boxOf[four[1]!]!
            const b3 = units.boxOf[four[2]!]!
            const b4 = units.boxOf[four[3]!]!
            if (b1 < 0 || b2 < 0 || b3 < 0 || b4 < 0) continue
            const sameRows = b1 === b2 && b3 === b4 && b1 !== b3
            const sameCols = b1 === b3 && b2 === b4 && b1 !== b2
            if (!sameRows && !sameCols) continue
            if (eliminate(four[fourthIdx]!, deadly, 'uniqueness')) eliminated = true
          }
        }
      }
    }
    return eliminated
  }

  /** 依次跑全部高级定式；一旦出现「候选变唯一」的落子就提前返回 */
  const runTechniques = (): { contradiction: boolean; eliminated: boolean } => {
    let eliminated = false
    try {
      for (const pass of [
        pointingPass,
        claimingPass,
        nakedSubsetPass,
        hiddenSubsetPass,
        xWingPass,
        swordfishPass,
        skyscraperPass,
        xyWingPass,
        xyzWingPass,
        ...(uniqueAllowed ? [uniqueRectanglePass] : []),
      ]) {
        if (pass()) eliminated = true
        if (pending.size) return { contradiction: false, eliminated }
      }
    } catch (e) {
      if (e instanceof Contradiction) return { contradiction: true, eliminated }
      throw e
    }
    return { contradiction: false, eliminated }
  }

  // —— 主循环：基础传播到不动点，再跑高级定式；任何落子后从基础传播重来 —— //
  for (;;) {
    for (const unit of units.all) {
      const seen = new Set<number>()
      for (const i of unit) {
        const v = cells[i]!
        if (v === 0) continue
        if (seen.has(v)) return false
        seen.add(v)
      }
    }

    if (!refreshMasks()) return false

    // 唯一候选
    let placed = false
    for (let i = 0; i < size; i++) {
      if (cells[i] !== 0) continue
      const m = masks[i]!
      if ((m & (m - 1)) === 0) {
        if (!set(i, lowValue(m), 'latin')) return false
        placed = true
      }
    }
    if (placed) continue

    // 单元内唯一位置（隐性唯一）；先收集再统一落子，避免半旧候选导致误判
    const hidden: Array<{ index: number; value: number }> = []
    for (const unit of units.all) {
      for (let v = 1; v <= n; v++) {
        const bit = bitOf(v)
        let spot = -1
        let count = 0
        let placedHere = false
        for (const i of unit) {
          if (cells[i] === 0 && masks[i]! & bit) {
            spot = i
            count++
          } else if (cells[i] === v) placedHere = true
        }
        if (count === 0) {
          if (!placedHere) return false
          continue
        }
        if (count === 1) hidden.push({ index: spot, value: v })
      }
    }
    if (hidden.length) {
      for (const { index, value } of hidden) {
        if (cells[index] !== 0) continue
        if (!set(index, value, 'region')) return false
      }
      continue
    }

    if (!advancedAllowed) return true

    // 高级定式：反复消除直到不动点；一旦出现落子就从基础传播重来
    let restart = false
    for (;;) {
      pending = new Map<number, RuleKind>()
      const res = runTechniques()
      if (res.contradiction) return false
      if (pending.size) {
        for (const [i, kind] of pending) {
          if (cells[i] !== 0) continue
          if (!set(i, lowValue(masks[i]!), kind)) return false
        }
        restart = true
        break
      }
      if (!res.eliminated) return true
    }
    if (restart) continue
    return true
  }
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
 * 纯规则求解（基础传播 + 高级定式 + 反证）。
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
  options: PropagateOptions = {},
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
    if (!propagate(grid, regions, undefined, n, options)) {
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
        if (propagate(trial, regions, undefined, n, options)) feasible.push(v)
      }
      if (feasible.length === 0) return out({ contradiction: true })
      if (feasible.length === 1) forced.push({ index: i, value: feasible[0]! })
    }
    if (!forced.length) return out({})
    for (const { index, value } of forced) {
      if (grid[index] === 0) grid[index] = value
    }
    if (!propagate(grid, regions, undefined, n, options)) return out({ contradiction: true })
  }
  return out({})
}
