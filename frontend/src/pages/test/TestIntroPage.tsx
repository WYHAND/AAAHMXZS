import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, Compass, Flag, RotateCcw, SkipForward } from 'lucide-react'

import { Reveal, staggerDelay } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
import { testApi } from '@/api/test'
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
   * 拿不到（题库未初始化 / 网络失败）就保持 null，文案自动退回不带数字的说法 —— 绝不编造。
   * active 标记防卸载后 setState；本页不再发其它请求，这一次只读、不改任何业务行为。
   */
  useEffect(() => {
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
  }, [])

  /*
   * ⚠️ 本页现在挂在 router/index.tsx 的 **BlankLayout 段（不带守卫）**，所以必须自己补一次取数：
   *    画像请求一直是挂在守卫 effect 上的（见 router/guards.tsx 顶部漏斗判据注释），
   *    少了它 fetched/tested 永远是 false → 下面那条「已测评且非 retest 就静默回首页」永不生效，
   *    已测评的老用户会看到"先花几分钟做个职业测评"（重复测评），?retest=1 的确认卡也不出现。
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
        <Panel className="gap-6">
          <div className="flex flex-col gap-3">
            {/* 小面积浅桃底（与 /login 的身份头一致），琥珀只在这里出现一次 */}
            <span className="flex size-9 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
              {retesting ? (
                <RotateCcw className="size-4" aria-hidden />
              ) : (
                <Compass className="size-4" aria-hidden />
              )}
            </span>
            <h1 className="text-headline-xl font-bold tracking-tight text-primary">
              {retesting ? '重新做一次职业测评' : '先做一次职业测评'}
            </h1>
            <p className="text-body-md text-on-surface-variant">
              {retesting
                ? '重测会更新你现在的三项分数和阶段判断，已经拿到的标签和任务都不受影响。'
                : '这是唯一一次要你主动填东西；答完我就知道你在哪个阶段，之后靠聊天和打卡慢慢认识你。'}
            </p>
          </div>

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
        220ms 播完（动效被吃掉）。改成"卡片静态、内容错峰"，三条按 staggerDelay 依次升起。
      */}
      <Panel className="gap-4">
        <Reveal as="h2" delay={90} className="text-headline-sm text-primary">
          先和你说清楚
        </Reveal>
        <ul className="flex flex-col gap-3">
          {facts.map(({ icon: Icon, text }, index) => (
            <Reveal
              as="li"
              key={text}
              delay={140 + staggerDelay(index)}
              className="flex items-start gap-3"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-on-surface-variant" aria-hidden />
              <span className="text-body-md text-on-surface-variant">{text}</span>
            </Reveal>
          ))}
        </ul>
      </Panel>

      {retesting ? (
        <Reveal delay={200} className="flex justify-center">
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
