import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * 设计说明书 6.5：Button 增加 variant="warm"（主色 CTA）与 size="lg"（首页唯一大按钮）。
 * 用色纪律：一屏最多 1 个实心 bg-primary 按钮；hover 用 --primary-hover 而非透明度叠加。
 *
 * 2026-10 收口（与首页对齐，改这里就是改全站）：
 * - `outline` 不再用 `bg-background`（那是**页面画布色**，按钮看着像纸片）与 `shadow-card`，
 *   改成 `bg-card`（白底）+ hover 到 `bg-primary-soft`（浅墨底）；
 * - `secondary` / `ghost` 的 hover 也从 `--secondary` 换成 `--primary-soft`：
 *   `--secondary` 现在是"中性浅底"语义（见 index.css 注释），不再承担交互反馈。
 * - 尺寸不变：sm=h-8、default=h-9、lg=h-11。页面里的主 CTA 统一用 lg。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        /** 首页「下一步建议」唯一大 CTA（= default 的语义化别名） */
        warm: "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border bg-card text-on-surface hover:bg-primary-soft",
        secondary:
          "bg-primary-soft text-on-surface hover:bg-surface-container-high",
        ghost: "hover:bg-primary-soft hover:text-on-surface",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5",
        /*
         * lg = 全站**唯一主 CTA** 规格（2026-10-18 收口）：44px 高 / 圆角 14px / 15px·600。
         * 圆角刻意写死 14px，**不要**再用 rounded-xl：--radius-xl 现在是 22px，
         * 44px 高配 22px 圆角 = 正圆端，按钮会变成药丸，与卡片轮廓混在一起（实测过）。
         * 卡片=22、控件=14、卡内块=12，三档是分开的，别互相借用。
         */
        lg: "h-11 rounded-[14px] px-6 text-[15px] font-semibold has-[>svg]:px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
