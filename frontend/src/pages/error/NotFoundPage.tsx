import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 404 / 兜底页（设计说明书 2.1 /404、/*）
 * 公开路由：未登录用户也能看到，所以不做守卫。
 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-pop">
        <CardHeader className="gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Compass className="size-4" />
          </span>
          <CardTitle className="text-xl">这个页面不存在</CardTitle>
          <CardDescription>
            链接可能写错了，或者这个功能还没上线。回首页看看下一步该做什么。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button variant="warm" size="lg" className="w-full" asChild>
            <Link to="/">回到首页</Link>
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link to="/chat">和 AI 聊聊我现在的情况</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
