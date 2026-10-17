/**
 * 内联库 `vendor/TagCloud.js` 的类型声明（勘误 9.24.5 第 6 条）。
 *
 * 本仓库是 `allowJs: false`（tsconfig.app.json），所以 `.js` 文件必须配一份
 * 同名 `.d.ts` 才能被 TS 解析 —— 这里只声明**我们真正用到的那部分**，
 * 不是对上游 API 的完整还原。
 */

/** 球体初始化选项（只列上游 2.5.0 的配置项）。 */
export interface TagCloudOptions {
  /** 滚动半径（px）。容器会被设成 2*radius 见方，球面可视半径 ≈ 0.75*radius */
  radius?: number
  /** 最大转速：slow / normal(default) / fast */
  maxSpeed?: 'slow' | 'normal' | 'fast'
  /** 初始转速：slow / normal(default) / fast */
  initSpeed?: 'slow' | 'normal' | 'fast'
  /** 初始滚动方向（顺时针角度）：0=上、90=左、135=右下（默认） */
  direction?: number
  /** 鼠标移出后是否继续滚动（默认 true） */
  keep?: boolean
  reverseDirection?: boolean
  /** 是否给容器写内联样式（默认 true；关掉要自己写尺寸，不推荐） */
  useContainerInlineStyles?: boolean
  /** 是否给每个标签写内联样式（默认 true；定位依赖它，不要关） */
  useItemInlineStyles?: boolean
  containerClass?: string
  itemClass?: string
  useHTML?: boolean
}

export interface TagCloudInstance {
  /** 用新标签替换现有标签（多退少补） */
  update(texts: string[]): void
  /** 暂停动画（`prefers-reduced-motion` 就用它） */
  pause(): void
  resume(): void
  /** 停止并移除容器元素 */
  destroy(): void
}

/**
 * 创建实例。`container` 可以是选择器字符串、元素或元素数组。
 * 返回实例（容器只有一个时不是数组）。
 */
declare function TagCloud(
  container: string | HTMLElement | HTMLElement[],
  texts: string[],
  options?: TagCloudOptions,
): TagCloudInstance

export default TagCloud
