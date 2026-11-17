/**
 * 逻辑解题审计（在浏览器里跑真实适配器）
 *
 * 对每道内置题生成逻辑回放计划，统计：
 *   - 总帧数 / 基础帧（规则 1-2）/ 高级定式帧（规则 3）/ 反证帧（规则 4）/ 回溯帧（规则 5）
 *   - 是否推满（saturated）、最终盘面是否合法、耗时
 * 高级定式帧越少依赖反证/回溯，说明纯逻辑能力越强。
 */
import { chromium } from 'playwright-core'
import { PORT } from './_port.mjs'

const executablePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
const results = await page.evaluate(() => {
  const a = window.__game.adapter
  return a.builtinPuzzles.map((p) => {
    const st = a.createEmptyState(p)
    const t = performance.now()
    const plan = a.planLogicSolve(p, st)
    const dt = Math.round(performance.now() - t)
    const vr = plan.finalState ? a.validate(plan.finalState, p) : null
    let base = 0
    let advanced = 0
    let probe = 0
    let search = 0
    for (const f of plan.frames) {
      if (f.rule <= 2) base++
      else if (f.rule === 3) advanced++
      else if (f.rule === 4) probe++
      else search++
    }
    return {
      name: p.name,
      size: `${p.width}x${p.height}`,
      frames: plan.frames.length,
      base,
      advanced,
      probe,
      search,
      finalSolved: vr?.solved ?? false,
      saturated: plan.saturated,
      ms: dt,
    }
  })
})
const sum = (k) => results.reduce((a, r) => a + r[k], 0)
console.log(results)
console.log(
  `[audit] ${results.length} 题 · 总帧 ${sum('frames')} · 基础 ${sum('base')} · ` +
    `高级定式 ${sum('advanced')} · 反证 ${sum('probe')} · 回溯 ${sum('search')} · ` +
    `推满 ${results.filter((r) => r.saturated).length}/${results.length} · ` +
    `总耗时 ${sum('ms')}ms`,
)
await browser.close()
