/**
 * 云端语音联调（阿里百炼）：
 * - 用 Chromium 的假麦克风播放一段真实语音 WAV；
 * - 前端走 MediaRecorder -> 16k WAV -> /voice/transcribe；
 * - 同时用假 Audio 让云端 TTS 的 play() 立即 ended，跑完整通话状态机。
 *
 * 用法：
 *   $env:RC_USER="voiceprobe8922"; $env:RC_PASS="..."; $env:RC_INTERVIEW="...";
 *   $env:RC_FAKE_MIC="$env:TEMP\fake-mic.wav"; node tools/render-check/voice-cloud-smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://127.0.0.1:5173'
const API = process.env.RC_API ?? 'http://127.0.0.1:8000/api/v1'
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const USER = process.env.RC_USER
const PASS = process.env.RC_PASS ?? 'probe-pass-123456'
const INTERVIEW = process.env.RC_INTERVIEW
const FAKE_MIC = process.env.RC_FAKE_MIC
const OUT = path.join(__dirname, 'shots', 'voice-cloud-smoke')
const TOKEN_KEY = 'ai_job_helper:token'
const INTERVIEW_KEY = 'ai_job_helper:interview_id'

const errors = []
const log = (...a) => console.log(...a)

async function main() {
  if (!USER || !INTERVIEW || !FAKE_MIC || !fs.existsSync(FAKE_MIC)) {
    console.error('缺少 RC_USER / RC_INTERVIEW / RC_FAKE_MIC')
    process.exit(1)
  }

  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const login = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json())
  const token = login?.data?.access_token
  if (!token) {
    console.error('LOGIN_FAILED ' + JSON.stringify(login))
    process.exit(1)
  }

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_MIC}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
    log('CONSOLE', m.type(), m.text().slice(0, 240))
  })
  page.on('requestfailed', (req) => {
    if (req.url().includes('/voice/')) {
      log('VOICE_REQ_FAILED', req.url(), req.failure()?.errorText)
    }
  })
  page.on('response', (res) => {
    if (res.url().includes('/voice/')) {
      log('VOICE_RESP', res.status(), res.url())
    }
  })

  let asrText = ''
  let ttsStatus = 0
  let ttsBytes = 0
  page.on('response', async (res) => {
    const url = res.url()
    try {
      if (url.includes('/voice/transcribe')) {
        const body = await res.json()
        asrText = body?.data?.text ?? ''
        log('ASR_RESPONSE', res.status(), JSON.stringify(asrText))
      }
      if (url.includes('/voice/tts')) {
        ttsStatus = res.status()
        const body = await res.json()
        ttsBytes = body?.data?.audio ? body.data.audio.length : 0
        log('TTS_RESPONSE', ttsStatus, 'base64_chars=' + ttsBytes)
      }
    } catch {
      /* ignore */
    }
  })

  await page.addInitScript(
    ({ tokenKey, interviewKey, token, interview }) => {
      window.localStorage.setItem(tokenKey, JSON.stringify(token))
      window.sessionStorage.setItem(interviewKey, JSON.stringify(interview))

      // 假 Audio：云端 TTS 的请求照常发，但播放立即 ended，避免 headless 没有声音设备
      class FakeAudio {
        constructor(src) {
          this.src = src
          this.preload = ''
          this.onended = null
          this.onerror = null
        }
        play() {
          window.setTimeout(() => this.onended?.({ type: 'ended' }), 180)
          return Promise.resolve()
        }
        pause() {}
        removeAttribute() {
          this.src = ''
        }
        load() {}
      }
      Object.defineProperty(window, 'Audio', { value: FakeAudio, configurable: true })
    },
    { tokenKey: TOKEN_KEY, interviewKey: INTERVIEW_KEY, token, interview: INTERVIEW },
  )

  const shot = async (name) => {
    const file = path.join(OUT, name + '.png')
    await page.screenshot({ path: file, fullPage: true })
    log('SHOT ' + file)
  }

  const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

  await page.goto(BASE_URL + '/interview/session', { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1800)
  await shot('01-intro')
  log('INTRO', (await bodyText()).slice(0, 220))

  const dictation = process.env.RC_DICTATION === '1'
  if (dictation) {
    const textBtn = page.getByRole('button', { name: /先用文字/ }).first()
    if (await textBtn.count()) await textBtn.click()
    await page.waitForTimeout(600)
    const micBtn = page.getByRole('button', { name: /用语音输入/ }).first()
    if (!(await micBtn.count())) throw new Error('dictation mic button not found')
    await micBtn.click()
  } else {
    const startBtn = page.getByRole('button', { name: /接通语音通话/ }).first()
    if (await startBtn.count()) {
      await startBtn.click()
    } else {
      const textBtn = page.getByRole('button', { name: /先用文字/ }).first()
      if (await textBtn.count()) await textBtn.click()
    }
  }

  // 等假 Audio 结束 / 假麦克风播放 + 云端 ASR 上传/识别
  await page.waitForTimeout(2500)
  await shot('02-listening')
  log('AFTER_START', (await bodyText()).slice(0, 320))

  await page.waitForTimeout(12000)
  await shot('03-after-asr')
  log('AFTER_ASR', (await bodyText()).slice(0, 360))
  if (dictation) {
    log('DICTATION_TEXTAREA', await page.locator('textarea').first().inputValue().catch(() => ''))
  }
  log('ASR_TEXT', JSON.stringify(asrText))
  log('TTS_STATUS', ttsStatus, 'TTS_BASE64_CHARS', ttsBytes)
  log('ERRORS', JSON.stringify(errors, null, 2))

  await browser.close()
  if (errors.length) process.exitCode = 2
  if (!asrText) process.exitCode = 3
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
