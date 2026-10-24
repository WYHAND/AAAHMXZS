import { useEffect, useState } from 'react'
import { KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invalidateVoiceStatusCache } from '@/api/voice'
import {
  clearApiKeys,
  loadApiKeys,
  maskKey,
  saveApiKeys,
  type ApiKeys,
} from '@/lib/apiKeys'

interface ApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 评委自填 Key：只保存在本机浏览器，随请求发给本机后端。
 * 作者演示时继续用 backend/.env；提交的源码包不包含 .env。
 */
export function ApiKeyDialog({ open, onOpenChange }: ApiKeyDialogProps) {
  const [keys, setKeys] = useState<ApiKeys>({ deepseek: '', dashscope: '' })
  const [saved, setSaved] = useState<ApiKeys>({ deepseek: '', dashscope: '' })

  useEffect(() => {
    if (!open) return
    const current = loadApiKeys()
    setKeys(current)
    setSaved(current)
  }, [open])

  const handleSave = () => {
    saveApiKeys(keys)
    setSaved(keys)
    invalidateVoiceStatusCache()
    toast.success('API Key 已保存到本机浏览器')
    onOpenChange(false)
  }

  const handleClear = () => {
    clearApiKeys()
    setKeys({ deepseek: '', dashscope: '' })
    setSaved({ deepseek: '', dashscope: '' })
    invalidateVoiceStatusCache()
    toast.success('已清除本机保存的 API Key')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            API Key 设置
          </DialogTitle>
          <DialogDescription>
            填你自己的 Key，只保存在本机浏览器，不会写进代码、仓库或数据库。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="deepseek-key">DeepSeek API Key</Label>
            <Input
              id="deepseek-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={keys.deepseek}
              onChange={(event) =>
                setKeys((prev) => ({ ...prev, deepseek: event.target.value }))
              }
            />
            <p className="text-caption text-on-surface-variant">
              用于 AI 对话、任务生成、简历润色、面试出题与复盘。
              {saved.deepseek ? ` 当前：${maskKey(saved.deepseek)}` : ' 当前：未填写'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dashscope-key">阿里云百炼 DashScope API Key</Label>
            <Input
              id="dashscope-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={keys.dashscope}
              onChange={(event) =>
                setKeys((prev) => ({ ...prev, dashscope: event.target.value }))
              }
            />
            <p className="text-caption text-on-surface-variant">
              只用于面试语音（ASR/TTS）。不填则自动隐藏语音入口，文字面试不受影响。
              {saved.dashscope ? ` 当前：${maskKey(saved.dashscope)}` : ' 当前：未填写'}
            </p>
          </div>

          <div className="rounded-lg bg-surface-container-low px-3 py-2 text-caption text-on-surface-variant">
            不填也能跑：AI 会走兜底话术，功能演示不受影响。公用电脑演示结束后请点“清除”。
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1.5">
            <Trash2 className="size-4" />
            清除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="warm" size="sm" onClick={handleSave}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
