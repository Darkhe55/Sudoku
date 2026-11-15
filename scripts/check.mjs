/**
 * 数独题库审计
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decodeBoard, decodeCells } from '../src/game/types.ts'
import { isValidSolution, solveByRules } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const text = readFileSync(DATA_FILE, 'utf8')

const entries = []
const re =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*(\d+),\s*difficulty:\s*'([^']+)',\s*series:\s*"([^"]+)",\s*board:\s*"([^"]*)",\s*solution:\s*"([^"]*)"\s*\}/g
let m
while ((m = re.exec(text)) !== null) {
  entries.push({
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

let errors = 0
let warnings = 0
const ids = new Set()

for (const e of entries) {
  if (ids.has(e.id)) {
    console.error(`[check] 重复 id: ${e.id}`)
    errors++
  }
  ids.add(e.id)
  if (e.width !== 9 || e.height !== 9) {
    console.error(`[check] ${e.id} 不是 9×9`)
    errors++
    continue
  }
  const decoded = decodeBoard(e.board, 81)
  const solution = decodeCells(e.solution, 81)
  if (!decoded || !solution) {
    console.error(`[check] ${e.id} 题面/解编码非法`)
    errors++
    continue
  }
  if (!isValidSolution(solution, decoded.regions)) {
    console.error(`[check] ${e.id} 参考解不合法`)
    errors++
    continue
  }
  for (let i = 0; i < 81; i++) {
    if (decoded.givens[i] !== 0 && decoded.givens[i] !== solution[i]) {
      console.error(`[check] ${e.id} 预填格 ${i} 与参考解不一致`)
      errors++
      break
    }
  }

  const counted = countSolutions(decoded.givens, decoded.regions, 2, 800_000)
  if (counted.timedOut) {
    console.warn(`[check] ${e.id} 唯一解检查超时（${counted.nodes} 节点）`)
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
    `[check] ${e.id} 9×9 预填 ${clues} · 解唯一 · 逻辑${plan.saturated ? '可推满' : '需回溯'} · ${counted.nodes} 节点`,
  )
}

console.log(`[check] 共 ${entries.length} 题，错误 ${errors}，警告 ${warnings}`)
if (entries.length === 0) {
  console.warn('[check] 题库为空，请先运行 npm run gen。')
}
if (errors > 0) process.exitCode = 1
