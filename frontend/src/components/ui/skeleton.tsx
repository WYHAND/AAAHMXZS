import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      /* 2026-10 收口：--accent 现在是浅桃（AI 专用暖色），skeleton 用它会让
         全站加载态都变桃色。骨架属于"中性占位"，用浅容器色。 */
      className={cn("animate-pulse rounded-md bg-surface-container", className)}
      {...props}
    />
  )
}

export { Skeleton }
