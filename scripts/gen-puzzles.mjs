/**
 * 题库生成器（模板）
 *
 * 模板本身不包含任何谜题生成逻辑 —— 那是每个游戏自己的事。
 * 本脚本负责把生成结果写进项目里的题库数据文件：
 *   - gen-config.mjs 导出 generatePuzzles()      → 写 src/game/puzzles-data.ts（旧内置题）
 *   - gen-config.mjs 导出 generateExtraPuzzles() → 写 src/game/puzzles-extra-data.ts（多尺寸题）
 * 同时存在时两处都写；只存在 generateExtraPuzzles 时只更新多尺寸题库、旧题库保持不变。
 *
 * 每条返回：
 *   { id, name, width, height, difficulty, series, board, solution }
 * 其中 board 是题面编码串，solution 是参考解编码串，编码格式由你的 src/game/puzzles.ts 解析。
 */
import { writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const EXTRA_FILE = path.resolve('src/game/puzzles-extra-data.ts')
const CONFIG_FILE = path.resolve('scripts/gen-config.mjs')

let items = []
let extraItems = []
let generatorName = ''
let hasLegacy = false
let hasExtra = false

if (existsSync(CONFIG_FILE)) {
  // 动态 import 加 query 避免 node 缓存旧模块
  const cfg = await import(`./gen-config.mjs?t=${Date.now()}`)
  if (cfg && typeof cfg.generatePuzzles === 'function') {
    hasLegacy = true
    items = (await cfg.generatePuzzles()) || []
    generatorName = cfg.NAME || '自定义生成器'
  }
  if (cfg && typeof cfg.generateExtraPuzzles === 'function') {
    hasExtra = true
    extraItems = (await cfg.generateExtraPuzzles()) || []
  }
} else {
  console.warn(
    '[gen] 未找到 scripts/gen-config.mjs，将生成空题库。参考 scripts/gen-config.example.mjs。',
  )
}

function validateItems(list, label) {
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || !p.name || !p.width || !p.height) {
      throw new Error(`[gen] 无效的题面条目：` + JSON.stringify(p))
    }
    if (typeof p.board !== 'string') {
      throw new Error(`[gen] ${p.id} 的 board 不是字符串`)
    }
    if (p.solution && p.solution.length !== p.width * p.height) {
      throw new Error(`[gen] ${p.id} 的 solution 长度不等于 ${p.width}×${p.height}`)
    }
    void label
  }
}

function writeDataFile(file, constName, list) {
  const lines = []
  lines.push('/* 自动生成，勿手改。运行 npm run gen 重新生成。 */')
  lines.push('export interface RawPuzzle {')
  lines.push('  id: string')
  lines.push('  name: string')
  lines.push('  width: number')
  lines.push('  height: number')
  lines.push(`  difficulty: 'easy' | 'medium' | 'hard' | 'custom'`)
  lines.push('  series: string')
  lines.push('  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */')
  lines.push('  board: string')
  lines.push('  /** 参考解编码串（没有则留空） */')
  lines.push('  solution?: string')
  lines.push('}')
  lines.push('')
  lines.push(`export const ${constName}: RawPuzzle[] = [`)
  for (const p of list) {
    lines.push(
      `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, width: ${p.width}, height: ${p.height}, difficulty: '${p.difficulty}', series: ${JSON.stringify(p.series || 'builtin')}, board: ${JSON.stringify(p.board)}, solution: ${JSON.stringify(p.solution || '')} },`,
    )
  }
  lines.push(']')
  lines.push('')
  writeFileSync(file, lines.join('\n'))
}

if (hasLegacy) {
  validateItems(items, 'legacy')
  writeDataFile(DATA_FILE, 'RAW_PUZZLES', items)
  console.log(
    `[gen] 写入 ${DATA_FILE}：${items.length} 题${generatorName ? '（' + generatorName + '）' : ''}`,
  )
}
if (hasExtra) {
  validateItems(extraItems, 'extra')
  writeDataFile(EXTRA_FILE, 'EXTRA_PUZZLES', extraItems)
  console.log(`[gen] 写入 ${EXTRA_FILE}：${extraItems.length} 题（多尺寸）`)
}
if (!hasLegacy && !hasExtra) {
  writeDataFile(DATA_FILE, 'RAW_PUZZLES', [])
  console.warn('[gen] gen-config.mjs 没有可用的生成函数，已写入空题库。')
}
