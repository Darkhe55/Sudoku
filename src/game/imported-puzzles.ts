/**
 * 数独 —— 识图导入题库（自动生成区段，正常为空）
 *
 * 由 `npm run import-image -- <图片> --append` 追加条目；
 * `npm run gen` 只重写 puzzles-data.ts，不会覆盖本文件。
 *
 * 每条格式与 puzzles-data.ts 的 RawPuzzle 相同；board 编码见 types.ts
 * （givens|regions，每格 1 个 36 进制字符），支持 9×9 / 14×14 / 16×16。
 *
 * 注意：本文件是导入题的持久题库，测试用的题面请在验证结束后删掉。
 */

import type { RawPuzzle } from './puzzles.ts'

export const IMPORTED_PUZZLES: RawPuzzle[] = [
]
