/**
 * 把后端 `task_steps.resource` 的值转成一个**真正能打开**的链接。
 *
 * ── 为什么需要这一层转换（这是个真实的坑） ──
 *
 * 后端 Prompt（`app/ai/prompts/task_generate.txt` 第 18 行）**明确要求**模型：
 *
 *     每步尽量给 resource：优先给**搜索关键词**或公开平台的栏目名
 *     （如"B站搜索：产品经理 需求分析 案例"），**不要编造具体 URL**。
 *
 * 这是**故意的设计**——大模型给出的 URL 基本都是幻觉链接，点开就是 404，
 * 比不给资源更伤信任。所以库里存的实际值长这样：
 *
 *     "搜索关键词：程序员 技术方向 科普"
 *     "B站搜索：方向关键词 + 入门介绍"
 *     "无" / "无需搜索，直接凭第一感觉打分"
 *
 * 但页面早期是直接 `<a href={activeStep.resource}>` —— 等于把**一句中文当成
 * 相对路径**，浏览器会跳到 `localhost:5173/搜索关键词：xxx`，必然打不开。
 * 数据是"关键词"、界面当"链接"用，两边语义对不上，这才是那个 bug 的根因。
 *
 * 所以这里把关键词**翻译成对应平台的搜索页**：
 *   - 不编造任何链接（关键词是模型给的，我们只负责拼搜索 URL）；
 *   - 用户一键就能搜到东西，而不是点了一个死按钮。
 */

export interface ResourceLink {
  href: string
  label: string
}

/** 这些值表示"这一步不需要外部资源"，不应该渲染成按钮（否则是个点不开的噪音） */
const NO_RESOURCE = /^(无|没有|暂无|不需要|不涉及)$|^无需/

/** 站内搜索 URL 模板：只拼关键词，不编造具体内容链接 */
const SEARCH = {
  bilibili: (kw: string) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}`,
  web: (kw: string) => `https://www.bing.com/search?q=${encodeURIComponent(kw)}`,
}

/**
 * @returns 可点击的链接；返回 null 表示"这一步没有资源"，调用方应**不渲染**任何东西
 */
export function toResourceLink(raw?: string | null): ResourceLink | null {
  const text = (raw ?? '').trim()
  if (!text || NO_RESOURCE.test(text)) return null

  // 万一以后模型真的给了 URL，直接用它（保留这条分支，避免以后换了 Prompt 又踩回来）
  if (/^https?:\/\//i.test(text)) return { href: text, label: '参考资源' }

  // 剥掉"平台 + 搜索："这类前缀，只留关键词
  const keyword = text
    .replace(/^(B站|bilibili)\s*搜索\s*[:：]\s*/i, '')
    .replace(/^搜索关键词\s*[:：]\s*/, '')
    .replace(/^搜索\s*[:：]\s*/, '')
    .trim()

  if (/^(B站|bilibili)/i.test(text)) {
    return { href: SEARCH.bilibili(keyword), label: `B 站搜：${keyword}` }
  }
  return { href: SEARCH.web(keyword), label: `搜索：${keyword}` }
}
