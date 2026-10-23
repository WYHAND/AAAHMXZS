import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ERROR_TEXT } from '@/constants/errorCode'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

/**
 * 注册页（设计说明书 2.1、3.1 P0）；对接 POST /auth/register
 *
 * 对齐后端 UserCreate：username 3-50、password 6-64，另有可选的 school/major/grade。
 * 后端**没有 email 字段**（设计说明书写的可选邮箱后端未实现），
 * 所以这里的可选字段改成「学校」——它真的会入库。
 * 后端注册直接返回 token + user，注册成功即登录态。
 *
 * 版式与登录页同一套骨架（居中一张 Panel：产品名 + 一句人话 + 表单），
 * 让 /login → /register 的跳转不像是换了个产品。
 *
 * 文案分工（2026-10）：placeholder = 怎么写（示例），helper 行 = 规则/说明，
 * 错误行 = 具体哪里没对。三者不复用同一句话。
 *
 * 2026-10-22 方案 A：表单是这屏唯一的主角 —— 标签 label-md、字段 44px、
 * 规则行与错误行都抬到 body-sm(14)（承载信息的最低档，caption 不承载信息）。
 * 高度账（390×844，BlankLayout 的 py-10 + 系统名约 120）：卡片约 700，总高约 820，
 * 因此把卡内 gap 从 24 收到 16、字段组 gap 从 8 收到 6，保证按钮不被推出屏幕。
 */
const registerSchema = z
  .object({
    username: z
      .string()
      .min(1, { error: '还没填用户名' })
      .min(3, { error: '用户名至少 3 个字符' })
      .max(50, { error: '用户名最长 50 字符' }),
    school: z.string().max(100, { error: '学校名最长 100 字符' }),
    password: z
      .string()
      .min(1, { error: '还没填密码' })
      .min(6, { error: '密码至少 6 位' })
      .max(64, { error: '密码最长 64 字符' }),
    confirm: z.string().min(1, { error: '再输一次密码' }),
  })
  .refine((values) => values.password === values.confirm, {
    error: '两次输入的密码不一致',
    path: ['confirm'],
  })

type RegisterForm = z.infer<typeof registerSchema>

/** 字段样式与登录页同一份：44px 高、白底、1px 暖棕描边、12px 圆角（控件档） */
const FIELD_INPUT =
  'h-11 rounded-md border border-border bg-card px-3 text-body-md shadow-none placeholder:text-caption-foreground focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/15'

/** 出错态：描边转 destructive、聚焦 ring 同步转红；错误消失即移除 */
const FIELD_INPUT_ERROR =
  'border-destructive aria-invalid:ring-destructive/15 focus-visible:border-destructive focus-visible:ring-destructive/15'

export default function RegisterPage() {
  const { register: signUp, loading, error } = useAuth()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: '', school: '', password: '', confirm: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    const ok = await signUp({
      username: values.username,
      password: values.password,
      school: values.school || undefined,
    })
    if (ok) {
      // 新用户没有测评记录，守卫会把 TA 送到 /test/intro
      toast.success('注册成功，先做个测评吧')
      navigate('/test/intro', { replace: true })
    } else {
      toast.error('注册失败，换个用户名试试')
    }
  })

  /*
   * 失败原因：后端「该用户名已被注册」用的也是 code 1001，共享层 errorText 会把它翻成
   * 通用的「参数有误」—— 注册语境下这句等于没说原因，所以换成人话；
   * 网络 / 超时 / 服务端原因原样透出，不误伤。
   */
  const reason = error
    ? error === ERROR_TEXT[1001]
      ? '这个用户名已经被注册了，换一个试试'
      : error
    : null

  return (
    <Panel className="mx-auto w-full gap-4">
      {/* 身份头：与登录页同构，卡片内先说清「这是什么产品」*/}
      <header className="flex flex-col gap-1.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h1 className="text-headline-xl font-bold tracking-tight text-primary">AI 就业助手</h1>
        <p className="text-body-lg text-on-surface-variant">陪你找到下一步该做什么。</p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username" className="text-label-md text-on-surface-variant">
            用户名
          </Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            placeholder="例如：xiaoman"
            className={cn(FIELD_INPUT, errors.username && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.username)}
            {...register('username')}
          />
          {/* 规则不再塞进 placeholder：占位符只给示例，规则固定在字段下方 */}
          {errors.username ? (
            <p className="text-body-sm text-attention">{errors.username.message}</p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">登录用，3 个字符以上</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="school" className="text-label-md text-on-surface-variant">
            学校（可选）
          </Label>
          <Input
            id="school"
            type="text"
            placeholder="例如：华南理工大学"
            className={cn(FIELD_INPUT, errors.school && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.school)}
            {...register('school')}
          />
          {errors.school ? (
            <p className="text-body-sm text-attention">{errors.school.message}</p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">填了方便后面给针对性建议</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-label-md text-on-surface-variant">
            密码
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="例如：Hello2026"
            className={cn(FIELD_INPUT, errors.password && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-body-sm text-attention">{errors.password.message}</p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">至少 6 位</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm" className="text-label-md text-on-surface-variant">
            确认密码
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="再输一次"
            className={cn(FIELD_INPUT, errors.confirm && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.confirm)}
            {...register('confirm')}
          />
          {errors.confirm ? (
            <p className="text-body-sm text-attention">{errors.confirm.message}</p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">和上面一致就行</p>
          )}
        </div>

        {/* 提交失败的可见原因（不是"出错了"） */}
        {reason ? (
          <p
            role="alert"
            className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-attention"
          >
            {reason}
          </p>
        ) : null}

        {/* 整屏唯一实心主按钮（size="lg" 自带 44px / 圆角 12 / 15px·600） */}
        <Button
          type="submit"
          variant="warm"
          size="lg"
          className="w-full"
          disabled={isSubmitting || loading}
        >
          {isSubmitting || loading ? '注册中…' : '注册'}
        </Button>

        {/* 切换注册 / 登录：弱化动作退到 ghost */}
        <Button variant="ghost" size="sm" className="w-full" asChild>
          <Link to="/login">已经有账号？去登录</Link>
        </Button>
      </form>
    </Panel>
  )
}
