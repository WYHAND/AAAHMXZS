import { useCallback, useEffect, useRef, useState } from 'react'
import { Flame, HelpCircle, History, Send } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { dailyApi } from '@/api/daily'
import { SCORE_LABEL } from '@/constants/score'
import { useProfileStore } from '@/store/profileStore'
import type { DailyHistory, TodayQuestion } from '@/types'
import { formatDate } from '@/utils/format'
import { track } from '@/utils/track'

/** 后端 DailyAnswerRequest.answer 上限 200 字 */
const ANSWER_MAX = 200

/** 题目已不可用（脏数据）时后端给空串 —— 条目照常显示，只是题干给一句人话 */
const MISSING_CONTENT = '这道题的题干已经找不到了'
/** 极端脏数据：连回答都是空的（后端正常至少 1 字） */
const MISSING_ANSWER = '这条回答当时没存下文字。'

/**
 * 题库 dimension 现在有中文（兴趣 / 能力 / 技能 / 痛点 / 焦虑 / 认知），
 * 但早期种子数据用的是四个分数维度的英文 slug。界面**不允许**漏英文字段名：
 * 认识的 slug 映射成中文（复用 constants/score 的单一数据源），
 * 不认识的英文一律不显示，本来就是中文的原样透传。
 */
const DIMENSION_LABEL: Record<string, string> = {
  clarity: SCORE_LABEL.clarity_score,
  action: SCORE_LABEL.action_score,
  resume: SCORE_LABEL.resume_score,
  interest: '兴趣',
}

function dimensionLabel(value?: string | null): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (!/^[a-z_]+$/i.test(raw)) return raw
  return DIMENSION_LABEL[raw.toLowerCase()] ?? null
}

/**
 * 每日一问（设计说明书 2.1 /daily、3.2 ① 模块①）
 *
 * 后端形状：GET /daily/today    -> { question: {id, dimension, content}, answered, answer, streak }
 *            POST /daily/answer -> body { question_id, answer }（**不是**路径参数）
 *            GET /daily/history -> { total, items: [{ id, question_id, content, dimension, answer, answered_at }] }
 * 回答成功后触发画像失效（4.2）。
 *
 * 历史是**只读列表**：顺序完全沿用后端（倒序），前端不排序、不翻页；
 * 拿不到历史只影响历史区（降级成空态），不影响上面那道今日问题。
 */
export default function DailyPage() {
  const bumpVersion = useProfileStore((s) => s.bumpVersion)
  const [today, setToday] = useState<TodayQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  /** 历史单独一份状态：两个请求互不拖累 */
  const [history, setHistory] = useState<DailyHistory | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const answerRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await dailyApi.today()
      setToday(data ?? null)
      setAnswer(data?.answer ?? '')
    } catch {
      setToday(null)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * 历史拿不到（后端还没上线 / 网络失败 / 形状不对）→ 降级成空态。
   * 这里刻意不弹 toast：历史是页面的次要区块，报错不该盖住今天的问题。
   */
  const loadHistory = useCallback(async () => {
    setHistoryStatus('loading')
    try {
      setHistory(await dailyApi.history())
      setHistoryStatus('ready')
    } catch {
      setHistory(null)
      setHistoryStatus('failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const submit = async () => {
    if (!today?.question || !answer.trim()) return
    setSubmitting(true)
    try {
      const updated = await dailyApi.answer({
        question_id: today.question.id,
        answer: answer.trim().slice(0, ANSWER_MAX),
      })
      setToday({ ...today, answered: true, answer: updated?.answer ?? answer })
      track('daily_answer', { question_id: today.question.id })
      // 4.2：回答属于画像写操作
      bumpVersion()
      // 刚答的这条也要出现在历史里
      void loadHistory()
      toast.success(
        updated?.profile_refreshed ? '记下了，这条已经进你的画像' : '记下了，攒够 7 题我会更新画像',
      )
    } catch {
      toast.error('提交失败，回答还留在输入框里')
    } finally {
      setSubmitting(false)
    }
  }

  /** 空态里的「去答今天这一道」：把光标送回上面的输入框 */
  const focusAnswer = () => {
    const el = answerRef.current
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus()
  }

  const items = history?.items ?? []
  const truncated = Boolean(history && history.total > items.length)

  return (
    <PageShell
      title="每日一问"
      description="一天一句话就够，不用写小作文。"
      breadcrumb="每日一问"
    >
      {loading ? (
        <AIThinking text="正在取今天的问题…" lines={2} />
      ) : today?.question ? (
        <Card data-print="card">
          <CardHeader className="gap-1">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <HelpCircle className="size-4 text-ai-accent" />
                今天的问题
              </CardTitle>
              {today.streak > 0 ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Flame className="size-3 text-warning" />
                  连续 {today.streak} 天
                </span>
              ) : null}
            </div>
            <CardDescription>{today.question.content}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {today.answered ? (
              <p className="rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
                {today.answer ?? answer}
              </p>
            ) : null}
            <Textarea
              ref={answerRef}
              rows={3}
              maxLength={ANSWER_MAX}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="想到什么写什么，一句话也可以"
            />
            <div className="flex items-center justify-between">
              <span className="font-numeric text-xs text-muted-foreground">
                {answer.length}/{ANSWER_MAX}
              </span>
              <Button
                variant="warm"
                onClick={() => void submit()}
                disabled={submitting || !answer.trim()}
                className="gap-1.5"
              >
                <Send className="size-4" />
                {submitting ? '提交中…' : today.answered ? '更新回答' : '提交'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<HelpCircle className="size-5" />}
          title="今天的问题还没准备好"
          description="每日一问接口暂时没返回内容，稍后再来看看。"
          action={
            <Button variant="warm" onClick={() => void load()}>
              重新加载
            </Button>
          }
        />
      )}

      {/* 历史：后端已按时间倒序，前端只做只读展示 */}
      <Card data-print="card">
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-ai-accent" />
            以前答过的题
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {historyStatus === 'loading' ? (
            <AIThinking text="正在翻你答过的题…" lines={2} />
          ) : historyStatus === 'failed' ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">
                你以前答过的题暂时没取到，不影响今天这一道。
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                再试一次
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<History className="size-5" />}
              title="还没有答过的题"
              description="你写下的每一句都会留在这里，过一阵回头看，能看出自己在变。"
              action={
                today?.question ? (
                  <Button variant="outline" onClick={focusAnswer}>
                    去答今天这一道
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void load()
                      void loadHistory()
                    }}
                  >
                    重新加载
                  </Button>
                )
              }
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((item, index) => {
                  const dimension = dimensionLabel(item.dimension)
                  return (
                    <li
                      key={`${item.id || item.question_id || 'history'}-${index}`}
                      className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-numeric text-xs text-muted-foreground">
                          {formatDate(item.answered_at)}
                        </span>
                        {dimension ? <Badge variant="secondary">{dimension}</Badge> : null}
                      </div>
                      <p className="text-sm text-foreground">
                        {item.content.trim() || MISSING_CONTENT}
                      </p>
                      {/* 长回答正常换行，不截断成一行省略号 */}
                      <p className="rounded-lg bg-secondary px-3 py-2 text-sm break-words whitespace-pre-wrap text-secondary-foreground">
                        {item.answer.trim() || MISSING_ANSWER}
                      </p>
                    </li>
                  )
                })}
              </ul>
              {truncated ? (
                <p className="text-xs text-muted-foreground">
                  你一共答过 {history?.total} 题，这里只列出最近 {items.length} 题。
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
