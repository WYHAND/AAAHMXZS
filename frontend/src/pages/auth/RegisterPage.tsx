import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

/**
 * 注册页（设计说明书 2.1、3.1 P0）；对接 POST /auth/register
 *
 * 对齐后端 UserCreate：username 3-50、password 6-64，另有可选的 school/major/grade。
 * 后端**没有 email 字段**（设计说明书写的可选邮箱后端未实现），
 * 所以这里的可选字段改成「学校」——它真的会入库。
 * 后端注册直接返回 token + user，注册成功即登录态。
 */
const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, { error: '用户名至少 3 个字符' })
      .max(50, { error: '用户名最长 50 字符' }),
    school: z.string().max(100, { error: '学校名最长 100 字符' }),
    password: z
      .string()
      .min(6, { error: '密码至少 6 位' })
      .max(64, { error: '密码最长 64 字符' }),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    error: '两次输入的密码不一致',
    path: ['confirm'],
  })

type RegisterForm = z.infer<typeof registerSchema>

export default function RegisterPage() {
  const { register: signUp, loading } = useAuth()
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

  return (
    <Card className="shadow-pop">
      <CardHeader className="gap-2">
        <CardTitle className="text-xl">创建你的账号</CardTitle>
        <CardDescription>只用用户名和密码，不用填一堆资料</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" placeholder="登录用，3 个字符以上" {...register('username')} />
            {errors.username ? (
              <p className="text-xs text-destructive">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="school">学校（可选）</Label>
            <Input id="school" placeholder="填了方便后面给针对性建议" {...register('school')} />
            {errors.school ? (
              <p className="text-xs text-destructive">{errors.school.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="至少 6 位"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">确认密码</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="再输一次"
              {...register('confirm')}
            />
            {errors.confirm ? (
              <p className="text-xs text-destructive">{errors.confirm.message}</p>
            ) : null}
          </div>

          <Button type="submit" variant="warm" size="lg" disabled={isSubmitting || loading}>
            {isSubmitting || loading ? '注册中…' : '注册并开始测评'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            已经有账号？
            <Link to="/login" className="ml-1 text-primary hover:underline">
              去登录
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
