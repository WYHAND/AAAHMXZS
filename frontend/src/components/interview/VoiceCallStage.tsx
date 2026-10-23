import {
  CornerDownRight,
  Headphones,
  Keyboard,
  Mic,
  RotateCcw,
  Square,
  VolumeX,
} from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/Panel'
import type { VoiceCallState } from '@/hooks/useVoiceCall'
import { cn } from '@/lib/utils'

/**
 * 全真通话主界面。
 *
 * 视觉上只保留一个主角：面试官和当前问题。状态、字幕、控件都围绕它，
 * 不再堆进度条之外的装饰。所有按钮都对应一个真实动作，不做假交互。
 */
export interface VoiceCallStageProps {
  state: VoiceCallState
  caption: string
  transcript: string
  interim: string
  error: string | null
  hint: string | null
  ttsSupported: boolean
  onReplay: () => void
  onStopListening: () => void
  onContinue: () => void
  onCommit: () => void
  onBargeIn: () => void
  onSwitchToText: () => void
  onRetry: () => void
}

const STATUS_LABEL: Record<VoiceCallState, string> = {
  idle: '准备开始',
  speaking: '面试官正在提问…',
  listening: '正在听你说…',
  reviewing: '说完了？可以继续补充',
  thinking: '面试官正在想下一个问题…',
  finished: '这场面试结束了',
  error: '语音出了点小问题',
}

export function VoiceCallStage({
  state,
  caption,
  transcript,
  interim,
  error,
  hint,
  ttsSupported,
  onReplay,
  onStopListening,
  onContinue,
  onCommit,
  onBargeIn,
  onSwitchToText,
  onRetry,
}: VoiceCallStageProps) {
  const speaking = state === 'speaking'
  const listening = state === 'listening'
  const reviewing = state === 'reviewing'
  const thinking = state === 'thinking'
  const showTranscript = Boolean(transcript) && (reviewing || thinking)
  const liveText = interim || transcript
  // 浏览器 stop 后要几十到几百毫秒才吐最终文字；这段空窗别说“可以补充”
  const statusText = reviewing && !transcript ? '正在整理你的回答…' : STATUS_LABEL[state]

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative grid size-20 place-items-center">
          {speaking ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-secondary/20" aria-hidden />
          ) : null}
          {listening ? (
            <span className="absolute inset-0 animate-pulse rounded-full bg-secondary/15" aria-hidden />
          ) : null}
          <span
            className={cn(
              'relative grid size-16 place-items-center rounded-full bg-primary-soft text-primary ring-1 ring-primary/15',
              (speaking || listening) && 'ring-secondary/50',
            )}
            aria-hidden
          >
            {speaking ? (
              <Headphones className="size-7" />
            ) : listening ? (
              <Mic className="size-7" />
            ) : thinking ? (
              <CornerDownRight className="size-7" />
            ) : (
              <Headphones className="size-7" />
            )}
          </span>
        </div>

        <p className="text-body-sm font-medium text-on-surface" aria-live="polite">
          {statusText}
        </p>
        {hint ? <p className="text-caption text-on-surface-variant">{hint}</p> : null}
      </div>

      <h1 className="text-headline-xl text-primary">{caption || '正在准备下一题…'}</h1>

      {showTranscript ? (
        <Panel inset className="ai-inset gap-1.5">
          <span className="text-caption text-caption-foreground">你的回答</span>
          <p className="max-h-32 overflow-y-auto text-body-md whitespace-pre-wrap text-on-surface">
            {transcript}
          </p>
        </Panel>
      ) : null}

      {listening ? (
        <Panel inset className="gap-2">
          <div className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-secondary" aria-hidden />
            <span className="text-caption text-caption-foreground">
              {liveText ? '实时字幕' : '正在听你说，停顿一下我会自动接话'}
            </span>
          </div>
          {liveText ? (
            <p
              className="max-h-32 overflow-y-auto text-body-md whitespace-pre-wrap text-on-surface"
              aria-live="polite"
            >
              {liveText}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {thinking ? (
        <AIThinking text="面试官正在想下一个问题…" lines={1} />
      ) : null}

      {error ? (
        <p className="text-body-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {state === 'idle' ? (
          <Button variant="warm" size="sm" className="motion-press gap-1.5" onClick={onReplay}>
            <RotateCcw className="size-3.5" aria-hidden />
            继续
          </Button>
        ) : null}

        {speaking ? (
          <>
            <Button variant="outline" size="sm" className="motion-press gap-1.5" onClick={onReplay}>
              <RotateCcw className="size-3.5" aria-hidden />
              重听
            </Button>
            <Button variant="outline" size="sm" className="motion-press gap-1.5" onClick={onBargeIn}>
              <Mic className="size-3.5" aria-hidden />
              打断，直接说
            </Button>
          </>
        ) : null}

        {listening ? (
          <Button variant="warm" size="sm" className="motion-press gap-1.5" onClick={onStopListening}>
            <Square className="size-3.5 fill-current" aria-hidden />
            我说完了
          </Button>
        ) : null}

        {reviewing && transcript ? (
          <>
            <Button variant="outline" size="sm" className="motion-press gap-1.5" onClick={onContinue}>
              <Mic className="size-3.5" aria-hidden />
              继续补充
            </Button>
            <Button variant="warm" size="sm" className="motion-press gap-1.5" onClick={onCommit}>
              就这样提交
            </Button>
          </>
        ) : null}

        {state === 'error' ? (
          <Button variant="outline" size="sm" className="motion-press gap-1.5" onClick={onRetry}>
            <RotateCcw className="size-3.5" aria-hidden />
            重试
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          className="motion-press gap-1.5"
          onClick={onSwitchToText}
          disabled={thinking}
        >
          <Keyboard className="size-3.5" aria-hidden />
          改用文字
        </Button>
      </div>

      {!ttsSupported ? (
        <p className="flex items-center justify-center gap-1.5 text-caption text-caption-foreground">
          <VolumeX className="size-3.5" aria-hidden />
          当前浏览器不支持语音朗读，题目会以文字显示。
        </p>
      ) : null}
    </div>
  )
}

export default VoiceCallStage
