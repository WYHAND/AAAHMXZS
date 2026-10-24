/**
 * 截图输出路径：一律落在**本脚本所在目录**的 shots/ 下。
 *
 * 为什么不再直接写 'shots/xxx.png'：那是相对**当前工作目录**的。
 * 从 frontend/ 或仓库根目录运行脚本时，PNG 就会漏到 frontend/shots/ 或
 * 根目录 shots/（历史上 frontend/shots/ 里的两张就是这么来的）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHOTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')

export function shotPath(name) {
  return path.join(SHOTS_DIR, name)
}
