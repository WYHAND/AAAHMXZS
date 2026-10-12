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
import { useAuth } from '@/hooks/useAuth'

// 对齐后端 UserLoginRequest：username 1-50，password 1-64
const loginSchema = z.object({
  username: z
    .string()
    .min(1, { error: '请输入用户名' })
    .max(50, { error: '用户名最长 50 字符' }),
  password: z
    .string()
    .min(1, { error: '请输入密码' })
    .max(64, { error: '密码最长 64 字符' }),
})

type LoginForm = z.infer<typeof loginSchema>

/**
 * 登录页（设计说明书 2.1、3.1 P0）；对接 POST /auth/login
 *
 * 版式（2026-10 收口，与首页同一套规格）：
 * 这个页面在 `BlankLayout` 的 448px 窄栏里居中，所以"像不像一个产品"全靠**卡片外面**
 * 那段身份头：产品标识 + 真 `<h1>`（26/700）+ 一句人话。原来只有一个 CardTitle，
 * 整页没有任何"这是什么产品"的信息，第一印象很空。
 * 卡片下方那行小字只写**已经落地的能力**（宁缺勿编）。
 */
export default function LoginPage() {
  const { login, loading } = useAuth()
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

  return (
    <div className="flex flex-col gap-6">
      {/* 身份头：卡片之外，先回答"这是个什么产品" */}
      <header className="flex flex-col gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h1 className="text-headline-xl font-bold text-primary">登录 AI 就业助手</h1>
        <p className="text-body-md text-on-surface-variant">先做一次职业测评，我就能开始陪你走。</p>
      </header>

      <Panel>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              autoComplete="username"
              placeholder="请输入用户名"
              aria-invalid={Boolean(errors.username)}
              {...register('username')}
            />
            {errors.username ? (
              <p className="text-body-sm text-destructive">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-body-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          {/*
            整屏唯一实心主按钮。
            `rounded-xl text-[15px] font-semibold` 不是随手加的：`size="lg"` 自带的圆角是
            `rounded-md`（实算 6px，见 index.css 的 --radius-md），而设计规范与两处已定稿的
            参考页（HomePage.tsx:220 主行动卡 CTA、TestResultPage.tsx:42 的 PRIMARY_CTA）
            都是「lg + rounded-xl（12px）+ 15px/600」。这里照参考页写，才和整站主 CTA 一致。
          */}
          <Button
            type="submit"
            variant="warm"
            size="lg"
            className="w-full rounded-xl text-[15px] font-semibold"
            disabled={isSubmitting || loading}
          >
            {isSubmitting || loading ? '登录中…' : '登录'}
          </Button>

          <p className="text-center text-body-md text-on-surface-variant">
            还没有账号？
            <Link to="/register" className="ml-1 text-primary hover:underline">
              注册一个
            </Link>
          </p>
        </form>
      </Panel>

      {/* 三条极轻的可信信息：只说产品真做得到的事 */}
      <p className="text-center text-body-sm text-on-surface-variant">
        AI 会从对话里了解你 · 任务拆成当天能做完的小步 · 简历只改你写过的内容
      </p>
    </div>
  )
}
