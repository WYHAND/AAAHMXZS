import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Compass, RotateCcw } from 'lucide-react'

import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
import { useProfileStore } from '@/store/profileStore'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 测试引导（设计说明书 2.1 /test/intro，3.1 P0）
 *
 * 漏斗落点：已登录但**未做测评**的用户会被强制导到这里。
 *
 * Fix D3（render-check bug #3）：原来 `fetched && tested` 就直接 `navigate('/')`，导致
 *   ① 已测评用户**没有任何入口重新测评**；
 *   ② 守卫注释里「测试中途 → /test/question?resume=1」的分支在 tested=true 下不可达。
 * 现在：
 *   - `?retest=1`（个人中心有入口）显式要求重测时**不弹出**，展示确认卡片；
 *   - sessionStorage 里有未提交的答题进度时，给「继续上次答题」→ `?resume=1`；
 *   - 其它情况（已测评且不是来重测）仍然静默回首页，避免误入重复测评。
 *
 * ⚠️ 2026-10 实测（别再照抄注释里的旧假设）：本页在 router/index.tsx 里已是
 *    **BlankLayout 的窄栏页**（448px 居中 + bg-canvas + 底部系统名），但**仍然没有 h1** ——
 *    标题原来是 CardTitle 的 div，所以这里用真正的
 *    `<h1 className="text-headline-xl font-bold text-primary">` 补上页面标题。
 *    居中一律交给布局，本页不再自己写 min-h-svh / justify-center（双重居中会撑出滚动）。
 */

interface SavedProgress {
  index: number
  answers: Record<string, string>
  skipped: string[]
}

/**
 * 主 CTA 的收口类名（与 TestResultPage 同一份，本页链路的唯一主按钮都用它）。
 * ⚠️ 共享 `components/ui/button.tsx` 的 lg 现在是 `rounded-md(6px) + text-base(16px/500)`，
 *    而 2026-10 规格是 **44px / 圆角 12 / 15px·600**；button.tsx 不在本页改造范围内，
 *    先在页面这一层补齐圆角与字号字重。共享层改好后这两句 utility 同值，可直接删。
 */
const PRIMARY_CTA = 'w-full rounded-xl text-[15px] font-semibold'

export default function TestIntroPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 拆成原始值，避免 useSearchParams 引用不稳定带来的重复渲染
  const retest = searchParams.get('retest') === '1'
  const fetched = useProfileStore((s) => s.fetched)
  const loading = useProfileStore((s) => s.loading)
  const failed = useProfileStore((s) => s.failed)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)

  const [hasProgress, setHasProgress] = useState(false)

  useEffect(() => {
    setHasProgress(
      Boolean(storage.session.get<SavedProgress | null>(STORAGE_KEY.testProgress, null)),
    )
  }, [])

  /*
   * ⚠️ 本页现在挂在 router/index.tsx 的 **BlankLayout 段（不带守卫）**，所以必须自己补一次取数：
   *    画像请求一直是挂在守卫 effect 上的（见 router/guards.tsx 顶部漏斗判据注释），
   *    少了它 fetched/tested 永远是 false → 下面那条「已测评且非 retest 就静默回首页」永不生效，
   *    已测评的老用户会看到"先花 3 分钟做个职业测评"（重复测评），?retest=1 的确认卡也不出现。
   *    三态护栏与守卫完全同款：没取过才取、加载中不重复发、失败不自动重试（等用户手动刷新），
   *    所以不会造成请求风暴。实测取证：tools/render-check/regression.mjs 的 N5 五条 + 第 3 条。
   */
  useEffect(() => {
    if (!fetched && !loading && !failed) {
      void fetchProfile()
    }
  }, [fetched, loading, failed, fetchProfile])

  // 已测评 + 不是显式重测 → 静默回首页（避免误入重复测评）
  useEffect(() => {
    if (fetched && tested && !retest) {
      navigate('/', { replace: true })
    }
  }, [fetched, tested, retest, navigate])

  if (fetched && tested && !retest) return null

  const retesting = tested && retest

  return (
    /*
     * ⚠️ 2026-10：外层居中交给 **BlankLayout**（router/index.tsx 里这页已挂进它的 448px 窄栏）。
     *    这里**只**保留宽度约束：BlankLayout 的 main 是 `flex items-center`，
     *    父容器再加 justify-center 就是双重居中 —— 曾用 `min-h-svh + justify-center` 兜底，
     *    实测会让内容比 main 的可视高度还高（main 有 py-10、下面还有页脚），
     *    在布局内反而撑出多余滚动。`w-full` 就够了。
     */
    <div className="w-full">
      <Panel className="mx-auto w-full gap-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
          {retesting ? <RotateCcw className="size-4" /> : <Compass className="size-4" />}
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-headline-xl font-bold tracking-tight text-primary">
            {retesting ? '重新做一次职业测评' : '先花 3 分钟做个职业测评'}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {retesting
              ? '重测会更新你当前的三项分数与阶段判断，已获得的标签和任务不受影响。'
              : '只有这一次需要你主动填东西，之后我不再弹问卷，靠对话和打卡慢慢认识你。'}
          </p>
        </div>

        <ul className="flex flex-col gap-2 text-body-sm leading-relaxed text-on-surface-variant">
          <li>· 全是选择题，一次一屏，答完一题自动跳下一题</li>
          <li>· 答不上来可以直接跳过，跳过不扣分</li>
          <li>· 答完立刻给出你的阶段和初始画像</li>
        </ul>

        {hasProgress ? (
          <div className="ai-inset flex flex-col gap-2 rounded-lg bg-surface-container-low px-4 py-3">
            <p className="text-body-sm text-on-surface">上次还有没提交完的作答，可以接着答。</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/test/question?resume=1')}
              className="self-start"
            >
              继续上次答题
            </Button>
          </div>
        ) : null}

        {/* 本页唯一实心主按钮 */}
        <Button
          variant="warm"
          size="lg"
          onClick={() => navigate('/test/question')}
          className={PRIMARY_CTA}
        >
          {retesting ? '开始重新测评' : '开始测评'}
        </Button>

        {retesting ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => navigate('/', { replace: true })}
          >
            算了，回首页
          </Button>
        ) : null}
      </Panel>
    </div>
  )
}
