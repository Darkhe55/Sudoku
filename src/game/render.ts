/**
 * 数独 —— SVG 渲染
 */

import {
  cellAtPoint,
  cellCenter,
  originOf,
  regionBoundarySegments,
  squareMetrics,
  cellSizeOf,
} from '../core/board'
import type { BoardMetrics, GameState, HitTarget, Puzzle, ValidationResult } from '../core/types'
import { asSudokuPuzzle, asSudokuState, type SudokuResult } from './types'

export function metricsFor(): BoardMetrics {
  return squareMetrics(9, 9, { cell: 52, pad: 20 })
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
): string {
  const p = asSudokuPuzzle(puzzle)
  const s = asSudokuState(state)
  const r = result as SudokuResult
  const m = metricsFor()
  const o = originOf(m)
  const { w: cw, h: ch } = cellSizeOf(m)
  const bad = new Set(r.badCells ?? [])
  const parts: string[] = []

  parts.push(`<rect class="sd-board-bg" x="${o.x}" y="${o.y}" width="${(cw * 9).toFixed(2)}" height="${(ch * 9).toFixed(2)}" />`)

  for (let x = 0; x <= 9; x++) {
    const px = o.x + x * cw
    parts.push(
      `<line class="sd-grid" x1="${px.toFixed(2)}" y1="${o.y.toFixed(2)}" x2="${px.toFixed(2)}" y2="${(o.y + ch * 9).toFixed(2)}" />`,
    )
  }
  for (let y = 0; y <= 9; y++) {
    const py = o.y + y * ch
    parts.push(
      `<line class="sd-grid" x1="${o.x.toFixed(2)}" y1="${py.toFixed(2)}" x2="${(o.x + cw * 9).toFixed(2)}" y2="${py.toFixed(2)}" />`,
    )
  }

  for (const seg of regionBoundarySegments(m, p.regions ?? [])) {
    parts.push(
      `<line class="sd-region" x1="${seg.x1.toFixed(2)}" y1="${seg.y1.toFixed(2)}" x2="${seg.x2.toFixed(2)}" y2="${seg.y2.toFixed(2)}" />`,
    )
  }

  for (let i = 0; i < 81; i++) {
    const v = s.cells[i] ?? 0
    if (v === 0) continue
    const c = cellCenter(m, i)
    const given = (p.givens?.[i] ?? 0) !== 0
    const cls = `sd-value${given ? ' given' : ''}${bad.has(i) ? ' bad' : ''}`
    parts.push(
      `<text class="${cls}" x="${c.x.toFixed(2)}" y="${(c.y + 1).toFixed(2)}" style="font-size:${(m.cell * 0.56).toFixed(2)}px">${v}</text>`,
    )
  }

  for (let i = 0; i < 81; i++) {
    const x = o.x + (i % 9) * cw
    const y = o.y + Math.floor(i / 9) * ch
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg sd-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(m: BoardMetrics, puzzle: Puzzle, x: number, y: number): HitTarget | null {
  void puzzle
  const index = cellAtPoint(m, x, y)
  return index === null ? null : { index, kind: 'cell' }
}
