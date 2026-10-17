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

// 对齐后端 UserLoginRequest：username 1-50，password 1-64
// 空值文案写成"还没填 X"（不是复读 placeholder），规则文案只在真有内容时出现。
const loginSchema = z.object({
  username: z
    .string()
    .min(1, { error: '还没填用户名' })
    .max(50, { error: '用户名最长 50 字符' }),
  password: z
    .string()
    .min(1, { error: '还没填密码' })
    .max(64, { error: '密码最长 64 字符' }),
})

type LoginForm = z.infer<typeof loginSchema>

/**
 * 字段样式（与全站表单同一套）：44px 高、白底、1px 描边、14px 圆角。
 * 旧版是「无边框 + 浅底 + 大圆角」，视觉上更像搜索框，已废弃。
 * 聚焦：ring 2px primary/15 + 描边转 primary/30，只换色不改尺寸（不抖动）。
 */
const FIELD_INPUT =
  'h-11 rounded-[14px] border border-border bg-card px-3 text-body-md shadow-none placeholder:text-caption-foreground focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/15'

/** 出错态：描边转 destructive、聚焦 ring 同步转红；错误消失即移除 */
const FIELD_INPUT_ERROR =
  'border-destructive aria-invalid:ring-destructive/15 focus-visible:border-destructive focus-visible:ring-destructive/15'

/**
 * 登录页（设计说明书 2.1、3.1 P0）；对接 POST /auth/login
 *
 * 版式（2026-10 收口，与首页同一套规格）：
 * 这一页挂在 `BlankLayout` 的 448px 窄栏里，整屏就一张居中的主卡（Panel）：
 * 卡顶是产品名 + 一句人话（先回答「这是个什么产品」），下面才是表单。
 * 整屏唯一的实心按钮是表单里的「登录」（warm/lg），切换注册的动作退到 ghost。
 *
 * 居中与画布色都归 BlankLayout（见 layouts/BlankLayout.tsx），页面里不再自己写
 * min-h-svh / justify-center —— 再包一层只会撑出多余滚动（TestIntroPage 同一口径）。
 */
export default function LoginPage() {
  const { login, loading, error } = useAuth()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    const ok = await login(values)
    if (ok) {
      // 去首页；守卫会按 profile.tested 决定是否弹到 /test/intro
      toast.success('登录成功')
      navigate('/', { replace: true })
    } else {
      toast.error('登录失败，请检查用户名和密码')
    }
  })

  /*
   * 失败原因：useAuth 把异常收敛成 error 文本。后端对「用户名或密码错误」用的是 code 1001，
   * 共享层 errorText 会把它翻成通用的「参数有误」—— 只显示这句等于没说清原因，
   * 所以认证语境下换成人话；网络 / 超时 / 服务端原因原样透出，不误伤。
   */
  const reason = error ? (error === ERROR_TEXT[1001] ? '账号或密码不对，再检查一下' : error) : null

  return (
    <Panel className="mx-auto w-full gap-6">
      {/* 身份头：卡片内先说清「这是什么产品」*/}
      <header className="flex flex-col gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h1 className="text-headline-xl font-bold tracking-tight text-primary">AI 就业助手</h1>
        <p className="text-body-md text-on-surface-variant">陪你找到下一步该做什么。</p>
      </header>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="username" className="text-body-sm text-on-surface-variant">
            用户名
          </Label>
          <Input
            id="username"
            autoComplete="username"
            placeholder="请输入用户名"
            className={cn(FIELD_INPUT, errors.username && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.username)}
            {...register('username')}
          />
          {errors.username ? (
            <p className="text-caption text-destructive">{errors.username.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-body-sm text-on-surface-variant">
            密码
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="请输入密码"
            className={cn(FIELD_INPUT, errors.password && FIELD_INPUT_ERROR)}
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-caption text-destructive">{errors.password.message}</p>
          ) : null}
        </div>

        {/* 提交失败的可见原因（不是"出错了"，是"账号或密码不对"） */}
        {reason ? (
          <p
            role="alert"
            className="rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-destructive"
          >
            {reason}
          </p>
        ) : null}

        {/* 整屏唯一实心主按钮：size="lg" 自带 44px / 圆角 12 / 15px·600，页面里不再手写覆盖 */}
        <Button
          type="submit"
          variant="warm"
          size="lg"
          className="w-full"
          disabled={isSubmitting || loading}
        >
          {isSubmitting || loading ? '登录中…' : '登录'}
        </Button>

        {/* 切换登录 / 注册：弱化动作退到 ghost */}
        <Button variant="ghost" size="sm" className="w-full" asChild>
          <Link to="/register">还没有账号？注册一个</Link>
        </Button>
      </form>
    </Panel>
  )
}
