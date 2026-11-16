/**
 * 数独题库生成配置
 */

import {
  generateExtraPuzzles as generateExtra,
  generatePuzzles as generate,
} from '../src/game/generator.ts'

export const NAME = '数独生成器'

export function generatePuzzles() {
  return generate()
}

/** 多尺寸内置题（4/6/12/16 等），写入 puzzles-extra-data.ts */
export function generateExtraPuzzles() {
  return generateExtra()
}
