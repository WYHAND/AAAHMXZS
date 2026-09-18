import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn 约定：合并 Tailwind 类名，后者覆盖前者的同族属性 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
