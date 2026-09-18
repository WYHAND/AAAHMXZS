import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Compass, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
 * 本页在 BlankLayout 内，自带居中宽度，不用 PageShell。
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
  const tested = useProfileStore((s) => s.tested)

  const [hasProgress, setHasProgress] = useState(false)

  useEffect(() => {
    setHasProgress(
      Boolean(storage.session.get<SavedProgress | null>(STORAGE_KEY.testProgress, null)),
    )
  }, [])

  // 已测评 + 不是显式重测 → 静默回首页（避免误入重复测评）
  useEffect(() => {
    if (fetched && tested && !retest) {
      navigate('/', { replace: true })
    }
  }, [fetched, tested, retest, navigate])

  if (fetched && tested && !retest) return null

  const retesting = tested && retest

  return (
    <Card className="shadow-pop">
      <CardHeader className="gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          {retesting ? <RotateCcw className="size-4" /> : <Compass className="size-4" />}
        </span>
        <CardTitle className="text-xl">
          {retesting ? '重新做一次职业测评' : '先花 3 分钟做个职业测评'}
        </CardTitle>
        <CardDescription>
          {retesting
            ? '重测会更新你当前的三项分数与阶段判断，已获得的标签和任务不受影响。'
            : '只有这一次需要你主动填东西，之后我不再弹问卷，靠对话和打卡慢慢认识你。'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>· 全是选择题，一次一屏，答完一题自动跳下一题</li>
          <li>· 答不上来可以直接跳过，跳过不扣分</li>
          <li>· 答完立刻给出你的阶段和初始画像</li>
        </ul>

        {hasProgress ? (
          <div className="ai-inset flex flex-col gap-2 rounded-lg bg-accent/50 px-4 py-3">
            <p className="text-sm text-accent-foreground">
              上次还有没提交完的作答，可以接着答。
            </p>
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
          className="w-full"
        >
          {retesting ? '开始重新测评' : '开始测评'}
        </Button>

        {retesting ? (
          <Button variant="ghost" className="w-full" onClick={() => navigate('/', { replace: true })}>
            算了，回首页
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
