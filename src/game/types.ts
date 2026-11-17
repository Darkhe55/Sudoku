/**
 * 数独（Sudoku）—— 游戏专用类型
 *
 * 规则：N×N（N = width = height）中填入 1..N，每行、每列、每个宫都不能重复。
 * 标准尺寸（宫按矩形 box 划分，宫数 = N，宫格数 = N）：
 *   4×4  = 2 行 × 2 列       6×6  = 2 行 × 3 列      8×8  = 2 行 × 4 列
 *   9×9  = 3 行 × 3 列      10×10 = 2 行 × 5 列     12×12 = 3 行 × 4 列
 *   14×14 = 2 行 × 7 列     15×15 = 3 行 × 5 列     16×16 = 4 行 × 4 列
 *   18×18 = 3 行 × 6 列     20×20 = 4 行 × 5 列     21×21 = 3 行 × 7 列
 *   22×22 = 2 行 × 11 列    24×24 = 4 行 × 6 列     25×25 = 5 行 × 5 列
 * 质数边长（5、7、11、13、17、19、23）没有「每宫 N 格」的矩形分块，
 * 退化为拉丁方（宫 = 整行，仅行列约束）；也一并支持。
 *
 * 编码约定（board / solution 字符串，每格固定 1 个字符）：
 *   36 进制字符表 BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
 *   - 题面：'0' = 空格，'1'..'9' = 1..9，'A'..'Z' = 10..35（N ≤ 36）
 *   - 宫号：0..35 用同一张字符表
 *   旧 9×9 题库的字符与 36 进制完全一致（'0'..'9'），天然向后兼容，无需迁移。
 *
 * 布局：索引 = y * width + x；regions[i] 是第 i 格所属宫号（0 起，不要求连续）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

/** 36 进制字符表：0-9 之后是 A-Z */
export const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 自定义题板 / 导入题支持的最小边长 */
export const MIN_SUDOKU_SIZE = 4
/** 自定义题板支持的最大边长（36 进制单字符编码 + 性能上限） */
export const MAX_SUDOKU_SIZE = 25

/** 1 基数值 → 编码字符；0 或非法值返回空串 */
export function symbolOf(value: number): string {
  if (!Number.isFinite(value)) return ''
  const v = Math.floor(value)
  if (v <= 0) return ''
  return v < BASE36.length ? BASE36[v]! : String(v)
}

/** 编码字符 → 数值；空格 '0' 返回 0；非法字符返回 -1 */
export function valueOfSymbol(ch: string): number {
  if (typeof ch !== 'string' || ch.length !== 1) return -1
  return BASE36.indexOf(ch)
}

/** 面积 → 边长；不是正整数平方返回 0 */
export function squareSize(area: number): number {
  if (!Number.isInteger(area) || area <= 0) return 0
  const n = Math.round(Math.sqrt(area))
  return n > 0 && n * n === area ? n : 0
}

/** 区域数（不同宫号个数） */
export function regionCountOf(regions: ArrayLike<number>): number {
  const seen = new Set<number>()
  for (let i = 0; i < regions.length; i++) seen.add(regions[i]!)
  return seen.size
}

/**
 * N 的标准宫分块尺寸：宫高 rows × 宫宽 cols（rows*cols = N）。
 * 取 rows ≤ cols 且最接近 √N 的因数对；质数边长退化为 1×N（宫 = 整行）。
 */
export function standardBoxDims(n: number): { rows: number; cols: number } {
  const size = Number.isInteger(n) && n > 0 ? n : 9
  for (let r = Math.floor(Math.sqrt(size)); r >= 2; r--) {
    if (size % r === 0) return { rows: r, cols: size / r }
  }
  return { rows: 1, cols: size }
}

/** 边长 N 的标准宫分块边长（方形宫才返回边长，否则 0；保留给旧调用方） */
export function standardBox(n: number): number {
  const dims = standardBoxDims(n)
  return dims.rows === dims.cols ? dims.rows : 0
}

/**
 * 标准（规则）宫划分：rows×cols 矩形宫。
 * @param n 边长（格子数 = n²）
 * @param rows 宫高，缺省按 standardBoxDims 推断
 * @param cols 宫宽，缺省 n/rows
 */
export function standardRegions(n = 9, rows?: number, cols?: number): number[] {
  const size = Number.isInteger(n) && n > 0 ? n : 9
  const dims = standardBoxDims(size)
  const boxRows = rows && rows > 0 ? rows : dims.rows
  const boxCols = cols && cols > 0 ? cols : Math.max(1, Math.round(size / boxRows))
  const out = new Array<number>(size * size).fill(0)
  const boxesPerRow = Math.max(1, Math.ceil(size / boxCols))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = Math.floor(y / boxRows) * boxesPerRow + Math.floor(x / boxCols)
    }
  }
  return out
}

/** N 的标准宫（自动判断矩形宫；质数边长退化为整行） */
export function standardRegionsOf(n: number): number[] {
  return standardRegions(n)
}

export interface SudokuPuzzle extends Puzzle {
  /** 每格所属宫号（0 起，可 >8，可非连续） */
  regions: number[]
  /** 题面预填：0 = 空，1..N = 数字/字母 */
  givens: number[]
  solution?: number[]
}

export interface SudokuState extends GameState {
  cells: number[]
  givens: number[]
  /** 每格候选数 bitmask（bit v-1 = 候选 v）；可选，缺省视为 0 */
  notes?: number[]
}

export interface DuplicateIssue {
  kind: 'row' | 'col' | 'region'
  index: number
  value: number
  cells: number[]
}

export interface SudokuResult extends ValidationResult {
  empty: number
  complete: boolean
  duplicateIssues: DuplicateIssue[]
  changedGivens: number[]
  badCells: number[]
}

export function asSudokuPuzzle(p: Puzzle): SudokuPuzzle {
  return p as SudokuPuzzle
}

export function asSudokuState(s: GameState): SudokuState {
  return s as SudokuState
}

/** 题面棋盘边长（要求正方形，非正方形返回 0） */
export function puzzleSize(p: { width: number; height: number }): number {
  const w = p.width
  const h = p.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w !== h) return 0
  return w
}

/**
 * 题面编码：givens|regions，每格 1 个 36 进制字符。
 * 9×9 时输出与旧格式逐字节一致（数字 0-9）。
 */
export function encodeBoard(givens: ArrayLike<number>, regions: ArrayLike<number>): string {
  const encodeInto = (out: string[], values: ArrayLike<number>, count: number): void => {
    for (let i = 0; i < count; i++) {
      const v = Math.floor(values[i] ?? 0)
      out.push(v > 0 && v < BASE36.length ? BASE36[v]! : '0')
    }
  }
  const parts: string[] = []
  encodeInto(parts, givens, givens.length)
  parts.push('|')
  encodeInto(parts, regions, regions.length)
  return parts.join('')
}

/**
 * 题面解码。
 * @param expected 总格数（width * height）
 * @param maxValue 最大数字（= N；字符值必须 ≤ 它）
 * @param maxRegion 宫号上界（字符值必须 < 它）
 */
export function decodeBoard(
  text: string,
  expected: number,
  maxValue = 36,
  maxRegion = 36,
): { givens: number[]; regions: number[] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 2) return null
  const givenText = parts[0]!
  const regionText = parts[1]!
  if (givenText.length !== expected || regionText.length !== expected) return null
  const givens = new Array<number>(expected).fill(0)
  const regions = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const g = valueOfSymbol(givenText[i]!)
    const r = valueOfSymbol(regionText[i]!)
    if (g < 0 || g > maxValue) return null
    if (r < 0 || r >= maxRegion) return null
    givens[i] = g
    regions[i] = r
  }
  return { givens, regions }
}

/** 棋盘/参考解编码：每格 1 个 36 进制字符 */
export function encodeCells(cells: ArrayLike<number>): string {
  const out: string[] = []
  for (let i = 0; i < cells.length; i++) {
    const v = Math.floor(cells[i] ?? 0)
    out.push(v > 0 && v < BASE36.length ? BASE36[v]! : '0')
  }
  return out.join('')
}

export function decodeCells(text: string, expected: number, maxValue = 36): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const v = valueOfSymbol(text[i]!)
    if (v < 0 || v > maxValue) return null
    out[i] = v
  }
  return out
}

/** 边长 N 是否在支持范围（4..25，且需要能排出 N² 格与 36 进制单字符编码） */
export function isValidSudokuSize(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SUDOKU_SIZE && n <= MAX_SUDOKU_SIZE
}
