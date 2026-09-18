import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

/** 登录页（设计说明书 2.1、3.1 P0）；对接 POST /auth/login */
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
    <Card className="shadow-pop">
      <CardHeader className="gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Sparkles className="size-4" />
        </span>
        <CardTitle className="text-xl">登录 AI 就业助手</CardTitle>
        <CardDescription>先做一次职业测评，我就能开始陪你走</CardDescription>
      </CardHeader>
      <CardContent>
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
              <p className="text-xs text-destructive">{errors.username.message}</p>
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
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          {/* 整屏唯一实心主按钮 */}
          <Button type="submit" variant="warm" size="lg" disabled={isSubmitting || loading}>
            {isSubmitting || loading ? '登录中…' : '登录'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            还没有账号？
            <Link to="/register" className="ml-1 text-primary hover:underline">
              注册一个
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
