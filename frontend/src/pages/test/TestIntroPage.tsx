import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, Flag, SkipForward } from 'lucide-react'

import { Reveal, staggerDelay } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
import { testApi } from '@/api/test'
import { useAuthStore } from '@/store/authStore'
import { useProfileStore } from '@/store/profileStore'
import { normalizeList } from '@/utils/list'
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
 * 版式（2026-10 迭代 02，与首页同一套规格）：
 *   本页在 router/index.tsx 里是 **BlankLayout 的窄栏页**（448px 居中 + bg-canvas + 底部系统名），
 *   顶距与两侧呼吸由布局的 px-4 py-10 提供，本页**不再自己补外壳留白**
 *   （双重留白会把 448px 窄栏挤得更窄）。窄栏只能单列，所以不套 1040px 壳、不做两列。
 *   一屏一个主角：主角卡只承担「一句人话 + 唯一的实心主 CTA」（安心地开始）；
 *   「你会经历什么」这类说明抽到下方一张支撑卡，形成「主角 + 支撑」的节奏，
 *   不再把所有信息挤进一张登录式卡片里。
 *
 * 2026-10-22 方案 A：
 *   - 去掉卡顶的图标块（纯装饰、且把 h1 往下推）；赭金只留 h1 上方一条 2px 细线，
 *     主按钮仍是墨色实心（全屏唯一实心块），两者不抢；
 *   - 主角是一句话 + 一个按钮：h1 走 headline-xl(30)，导语抬到 body-lg(16)，
 *     支撑卡三条说明留在 body-sm(14)（承载信息的最低档）；
 *   - 支撑卡标题从栏目名「先和你说清楚」改成结论句「整个过程比你想的轻松」；
 *   - 高度按"一屏不滚"算过：本页在 BlankLayout 里（main 的 py-10 + 底部系统名），
 *     390×844 可用约 724px；最坏情况（来自面试 + 有未提交进度）约 690px。
 *
 * 数据来源：题量从接口 `GET /test/questions` 取（题库条数只有接口知道），拿不到就不显示数字，
 *   绝不编造；时长只说「几分钟就能答完」这种量级，不写死具体分钟数。
 */

interface SavedProgress {
  index: number
  answers: Record<string, string>
  skipped: string[]
}

export default function TestIntroPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 拆成原始值，避免 useSearchParams 引用不稳定带来的重复渲染
  const retest = searchParams.get('retest') === '1'
  /*
   * 来源路径（守卫 RequireProfile 带过来的 ?from=...）。
   * 只用来**说清"你为什么被带到这一页"**：实测新账号点「模拟面试」会直接看到
   * 整页「先做一次职业测评」，没有一句话解释，用户会以为点错了。
   * 只认 /interview 这一个来源（其余来源保持原样），且**不影响任何跳转逻辑**。
   */
  const fromPath = searchParams.get('from') ?? ''
  const fromInterview = !retest && fromPath.startsWith('/interview')
  const token = useAuthStore((s) => s.token)
  const fetched = useProfileStore((s) => s.fetched)
  const loading = useProfileStore((s) => s.loading)
  const failed = useProfileStore((s) => s.failed)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)

  const [hasProgress, setHasProgress] = useState(false)
  const [questionCount, setQuestionCount] = useState<number | null>(null)

  useEffect(() => {
    setHasProgress(
      Boolean(storage.session.get<SavedProgress | null>(STORAGE_KEY.testProgress, null)),
    )
  }, [])

  /*
   * 题量从接口取（`GET /test/questions`）：文案要说清「要答几道题」，
   * 而题库条数只有接口知道（30 题是种子数据，前端没有常量可依赖）。
   * 拿不到（未登录 / 题库未初始化 / 网络失败）就保持 null，文案自动退回
   * 不带数字的说法 —— 绝不编造。
   *
   * 2026-10 后端已把 `/test/questions` 改为必须登录（历史遗留的匿名端点）。
   * 本页在 BlankLayout 里是**公开页**，所以未登录时直接不发请求：否则会吃一个
   * 401，拦截器会触发 logout + 全局 toast，把"公开引导页"变成"登录失效"体验。
   * active 标记防卸载后 setState；本页不再发其它请求，这一次只读、不改任何业务行为。
   */
  useEffect(() => {
    if (!token) {
      setQuestionCount(null)
      return
    }
    let active = true
    testApi
      .questions()
      .then((list) => {
        if (active) setQuestionCount(normalizeList(list).length)
      })
      .catch(() => {
        /* 取不到就不显示数字，保持 null */
      })
    return () => {
      active = false
    }
  }, [token])

  /*
   * ⚠️ 本页现在挂在 router/index.tsx 的 **BlankLayout 段（不带守卫）**，所以必须自己补一次取数：
   *    画像请求一直是挂在守卫 effect 上的（见 router/guards.tsx 顶部漏斗判据注释），
   *    少了它 fetched/tested 永远是 false → 下面那条「已测评且非 retest 就静默回首页」永不生效，
   *    已测评的老用户会看到"先花几分钟做个职业测评"（重复测评），?retest=1 的确认卡也不出现。
   *    三态护栏与守卫完全同款：没取过才取、加载中不重复发、失败不自动重试（等用户手动刷新），
   *    所以不会造成请求风暴。实测取证：tools/render-check/regression.mjs 的 N5 五条 + 第 3 条。
   */
  useEffect(() => {
    // 未登录时不要打 /profile：公开引导页吃 401 会触发 logout + 全局 toast。
    if (!token) return
    if (!fetched && !loading && !failed) {
      void fetchProfile()
    }
  }, [token, fetched, loading, failed, fetchProfile])

  // 已测评 + 不是显式重测 → 静默回首页（避免误入重复测评）
  useEffect(() => {
    if (fetched && tested && !retest) {
      navigate('/', { replace: true })
    }
  }, [fetched, tested, retest, navigate])

  if (fetched && tested && !retest) return null

  const retesting = tested && retest

  // 题量已知就报准确条数；未知时只说"全是选择题"，不拿一个编造的数字充数
  const stepLine = questionCount
    ? '一共 ' + questionCount + ' 道选择题，一次一屏，几分钟就能答完'
    : '全是选择题，一次一屏，几分钟就能答完'

  /*
   * 「你会经历什么」三条说明：刻意拆成「一句判断 + 一个小图标」的行，
   * 而不是三行 13px 灰字 —— 密集灰字正是"一眼看出是模板"的来源。
   */
  const facts = [
    { icon: ClipboardList, text: stepLine },
    { icon: SkipForward, text: '答不上来可以直接跳过，跳过不扣分' },
    { icon: Flag, text: '答完立刻给出你现在的阶段，下一步该做什么也会更清楚' },
  ]

  return (
    <div className="flex w-full flex-col gap-6">
      {/* 主角卡：整页唯一的大块，只做一件事 —— 让你安心地开始 */}
      <Reveal lg>
        <Panel className="gap-4">
          <div className="flex flex-col gap-2">
            {/* 全屏唯一的赭金：一条 2px 细线（细线/小圆点是允许的用量，别换成色块） */}
            <span aria-hidden className="h-0.5 w-8 rounded-full bg-secondary" />
            <h1 className="text-headline-xl font-bold tracking-tight text-primary">
              {retesting ? '重新做一次职业测评' : '先做一次职业测评'}
            </h1>
            <p className="text-body-lg text-on-surface-variant">
              {retesting
                ? '重测会更新你现在的三项分数和阶段判断，已经拿到的标签和任务都不受影响。'
                : '这是唯一一次要你主动填东西；答完我就知道你在哪个阶段，之后靠聊天和打卡慢慢认识你。'}
            </p>
          </div>
          {/* 从模拟面试被拦过来时补一句原因：否则用户以为"我点的是面试，怎么给我一个测评"。
              它是"为什么来这一页"的说明（信息），所以走 body-sm，不再用 body-md 和正文抢。 */}
          {fromInterview ? (
            <p className="rounded-lg bg-surface-inset px-4 py-3 text-body-sm text-on-surface">
              模拟面试要按你的画像和简历出题，所以先花几分钟做个测评；做完就能回去开面试。
            </p>
          ) : null}

          {hasProgress ? (
            <Panel inset className="gap-3">
              <p className="text-body-sm text-on-surface">上次还有没提交完的作答，可以接着答。</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/test/question?resume=1')}
                className="motion-press self-start"
              >
                继续上次答题
              </Button>
            </Panel>
          ) : null}

          {/* 本屏唯一实心主按钮：尺寸/圆角/字号由 size="lg" 自带，页面不再手写覆盖 */}
          <Button
            variant="warm"
            size="lg"
            className="motion-press w-full"
            onClick={() => navigate('/test/question')}
          >
            {retesting ? '开始重新测评' : '开始测评'}
          </Button>
        </Panel>
      </Reveal>

      {/*
        支撑卡：把「你会经历什么」讲清楚。
        卡片本身不再整体 Reveal —— 否则卡里的行会在父级还是 opacity:0 时就把自己的
        480ms 播完（动效被吃掉）。改成"卡片静态、内容错峰"，三条按 staggerDelay 依次升起。
      */}
      <Panel className="gap-4">
        <Reveal as="h2" delay={160} className="text-headline-md text-primary">
          整个过程比你想的轻松
        </Reveal>
        <ul className="flex flex-col gap-3">
          {facts.map(({ icon: Icon, text }, index) => (
            <Reveal
              as="li"
              key={text}
              delay={250 + staggerDelay(index)}
              className="flex items-start gap-3"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-on-surface-variant" aria-hidden />
              <span className="text-body-sm text-on-surface-variant">{text}</span>
            </Reveal>
          ))}
        </ul>
      </Panel>

      {retesting ? (
        <Reveal delay={360} className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="motion-press"
            onClick={() => navigate('/', { replace: true })}
          >
            算了，回首页
          </Button>
        </Reveal>
      ) : null}
    </div>
  )
}
