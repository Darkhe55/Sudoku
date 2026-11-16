/**
 * 数独题库审计（任意 N）
 *
 * 审计两个文件：
 *   - src/game/puzzles-data.ts    内置题（npm run gen 生成）
 *   - src/game/imported-puzzles.ts 识图导入题（import-image --append 写入）
 *
 * 对每道题检查：编码可解码、参考解合法且覆盖预填格、解唯一（搜索超时只警告）、
 * 规则引擎可推演。9×9 / 14×14 / 16×16 都走同一套逻辑。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { decodeBoard, decodeCells, regionCountOf } from '../src/game/types.ts'
import { isValidSolution, solveByRules } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'

const FILES = [
  'src/game/puzzles-data.ts',
  'src/game/puzzles-extra-data.ts',
  'src/game/imported-puzzles.ts',
].map((p) => path.resolve(p))

const ENTRY_RE =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*(\d+),\s*difficulty:\s*'([^']+)',\s*series:\s*"([^"]*)",\s*board:\s*"([^"]*)",\s*solution:\s*"([^"]*)"\s*\}/g

function readEntries(file) {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  const out = []
  ENTRY_RE.lastIndex = 0
  let m
  while ((m = ENTRY_RE.exec(text)) !== null) {
    out.push({
      file: path.basename(file),
      id: m[1],
      name: m[2],
      width: Number(m[3]),
      height: Number(m[4]),
      difficulty: m[5],
      series: m[6],
      board: m[7],
      solution: m[8],
    })
  }
  return out
}

const entries = FILES.flatMap(readEntries)

let errors = 0
let warnings = 0
const ids = new Set()

for (const e of entries) {
  if (ids.has(e.id)) {
    console.error(`[check] 重复 id: ${e.id}`)
    errors++
  }
  ids.add(e.id)

  const n = e.width
  if (n !== e.height || n < 4 || n > 36) {
    console.error(`[check] ${e.id} 不是 4..36 的正方形题面（${e.width}×${e.height}）`)
    errors++
    continue
  }
  const size = n * n
  const decoded = decodeBoard(e.board, size, n, n)
  if (!decoded) {
    console.error(`[check] ${e.id} 题面编码非法（${n}×${n}，期望 ${size} 格）`)
    errors++
    continue
  }
  const regionCount = regionCountOf(decoded.regions)
  if (regionCount !== n) {
    console.warn(`[check] ${e.id} 宫数 ${regionCount} 与边长 ${n} 不一致（行/列仍保证互异）`)
    warnings++
  }
  if (regionCount > n) {
    console.error(`[check] ${e.id} 宫数 ${regionCount} 超过边长 ${n}（无法满足互异规则）`)
    errors++
    continue
  }

  let hasSolution = false
  if (e.solution) {
    const solution = decodeCells(e.solution, size, n)
    if (!solution) {
      console.error(`[check] ${e.id} 参考解编码非法`)
      errors++
      continue
    }
    if (!isValidSolution(solution, decoded.regions, n)) {
      console.error(`[check] ${e.id} 参考解不合法`)
      errors++
      continue
    }
    for (let i = 0; i < size; i++) {
      if (decoded.givens[i] !== 0 && decoded.givens[i] !== solution[i]) {
        console.error(`[check] ${e.id} 预填格 ${i} 与参考解不一致`)
        errors++
        break
      }
    }
    hasSolution = true
  } else {
    console.warn(`[check] ${e.id} 没有参考解（显示解/提示将依赖回溯求解）`)
    warnings++
  }

  const maxNodes = n > 9 ? 200_000 : 800_000
  const counted = countSolutions(decoded.givens, decoded.regions, 2, maxNodes)
  if (counted.timedOut) {
    console.warn(`[check] ${e.id} 唯一解检查超时（${counted.nodes} 节点），已跳过唯一性判定`)
    warnings++
  } else if (counted.count !== 1) {
    console.error(`[check] ${e.id} 解不唯一：找到 ${counted.count} 个`)
    errors++
    continue
  }

  const plan = solveByRules(decoded.givens, decoded.regions, true, 240)
  if (!plan.ok || !plan.solution) {
    console.warn(`[check] ${e.id} 规则无法单独推满（需要回溯）`)
    warnings++
  } else if (!plan.saturated) {
    console.warn(`[check] ${e.id} 需要回溯（逻辑推演未饱和）`)
    warnings++
  }

  const clues = decoded.givens.filter((v) => v !== 0).length
  console.log(
    `[check] ${e.id} ${n}×${n}（${regionCount} 宫）预填 ${clues} · ` +
      `${hasSolution ? '参考解 OK · ' : ''}解唯一 · 逻辑${plan.saturated ? '可推满' : '需回溯'} · ${counted.nodes} 节点`,
  )
}

console.log(`[check] 共 ${entries.length} 题，错误 ${errors}，警告 ${warnings}`)
const bySize = new Map()
for (const e of entries) {
  const key = `${e.width}×${e.height}`
  bySize.set(key, (bySize.get(key) || 0) + 1)
}
if (bySize.size) {
  console.log(
    '[check] 尺寸分布：' +
      Array.from(bySize.entries())
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([k, v]) => `${k}×${v}题`)
        .join(' · '),
  )
}
if (entries.length === 0) {
  console.warn('[check] 题库为空，请先运行 npm run gen。')
}
if (errors > 0) process.exitCode = 1
