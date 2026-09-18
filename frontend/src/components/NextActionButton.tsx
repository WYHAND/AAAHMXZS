import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 首页「下一步建议」唯一 CTA（设计说明书 3.2 ① 模块⑤、6.5）
 *
 * 纪律：整屏最显眼，且是页面里**唯一**的 bg-primary 实心按钮。
 * ⚠️ 后端 ProfileResponse 没有 next_action 字段（设计说明书 5.4 提过，后端未实现），
 * 文案与目标路由目前由 constants/stage.ts 按阶段决定，前端不做推荐逻辑。
 */
export interface NextActionButtonProps {
  /** CTA 文案（阶段级固定文案） */
  text: string
  /** 目标路由 */
  to: string
  size?: 'default' | 'lg'
  disabled?: boolean
  className?: string
  onClick?: () => void
  trailingIcon?: ReactNode
}

export function NextActionButton({
  text,
  to,
  size = 'lg',
  disabled = false,
  className,
  onClick,
  trailingIcon,
}: NextActionButtonProps) {
  const icon = trailingIcon ?? <ArrowRight className="size-4" />
  const classes = cn('w-full gap-2 sm:w-auto', className)

  // disabled 时退化为真实 button（不嵌套 <a>），否则用 asChild 让 <a> 直接承担按钮样式
  if (disabled) {
    return (
      <Button
        variant="warm"
        size={size}
        disabled
        data-slot="next-action"
        className={classes}
      >
        {text}
        {icon}
      </Button>
    )
  }

  return (
    <Button
      asChild
      variant="warm"
      size={size}
      data-slot="next-action"
      className={classes}
      onClick={onClick}
    >
      <Link to={to}>
        {text}
        {icon}
      </Link>
    </Button>
  )
}
