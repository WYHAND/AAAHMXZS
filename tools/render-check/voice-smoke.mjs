/**
 * 面试语音 UI 冒烟测试（不依赖真实麦克风）。
 *
 * 用 Playwright 注入假的 SpeechRecognition / speechSynthesis，
 * 走一遍“接通 → 读题 → 说一句 → 自动提交 → 下一题 → 改用文字”的链路。
 *
 * 用法：
 *   cd tools/render-check
 *   $env:RC_USER="voiceprobe8922"; $env:RC_PASS="probe-pass-123456"; $env:RC_INTERVIEW="..."; node voice-smoke.mjs
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
const WIDTH = Number(process.env.RC_WIDTH ?? 1280)
const HEIGHT = Number(process.env.RC_HEIGHT ?? 900)
const OUT = path.join(__dirname, 'shots', process.env.RC_OUT ?? 'voice-smoke')
const TOKEN_KEY = 'ai_job_helper:token'
const INTERVIEW_KEY = 'ai_job_helper:interview_id'

const errors = []
const log = (...a) => console.log(...a)

async function main() {
  if (!USER || !INTERVIEW) {
    console.error('缺少 RC_USER / RC_INTERVIEW')
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

  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })

  await page.addInitScript(
    ({ tokenKey, interviewKey, token, interview }) => {
      window.localStorage.setItem(tokenKey, JSON.stringify(token))
      window.sessionStorage.setItem(interviewKey, JSON.stringify(interview))

      // ---- 假麦克风权限：接通时的 primeMicrophone 需要它 ----
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
        },
      })

      // ---- 假 TTS：每句 80ms 后触发 onend ----
      class FakeUtterance {
        constructor(text) {
          this.text = text
          this.onend = null
          this.onerror = null
          this.voice = null
          this.lang = ''
          this.rate = 1
          this.pitch = 1
          this.volume = 1
        }
      }
      const fakeSynth = {
        speaking: false,
        onvoiceschanged: null,
        getVoices: () => [
          { name: 'Fake Xiaoxiao', lang: 'zh-CN', default: true, localService: true, voiceURI: 'fake' },
        ],
        cancel() {
          this.speaking = false
        },
        speak(u) {
          this.speaking = true
          window.__fakeUtterance = u
          window.setTimeout(() => {
            this.speaking = false
            try {
              u.onend?.({ type: 'end' })
            } catch {
              /* ignore */
            }
          }, 80)
        },
        pause() {},
        resume() {},
      }
      Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth, configurable: true })
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true })

      // ---- 假 ASR：start 后把实例挂到 window，测试脚本手动喂结果 ----
      class FakeRecognition {
        constructor() {
          this.lang = ''
          this.continuous = false
          this.interimResults = false
          this.maxAlternatives = 1
          this.onstart = null
          this.onend = null
          this.onerror = null
          this.onresult = null
          this.onspeechend = null
          this.onnomatch = null
        }
        start() {
          window.__fakeRec = this
          window.setTimeout(() => this.onstart?.({ type: 'start' }), 20)
        }
        stop() {
          window.setTimeout(() => this.onend?.({ type: 'end' }), 10)
        }
        abort() {
          window.setTimeout(() => this.onend?.({ type: 'end' }), 10)
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true })
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
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
  await page.waitForTimeout(1200)
  await shot('01-intro')
  log('INTRO: ' + (await bodyText()).slice(0, 260))

  await page.getByRole('button', { name: /接通语音通话/ }).click()
  await page.waitForTimeout(900)
  await shot('02-listening')
  log('AFTER_START: ' + (await bodyText()).slice(0, 260))

  // 中间字幕
  await page.evaluate(() => {
    const rec = window.__fakeRec
    if (!rec) throw new Error('fake rec not started')
    rec.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: '我是一名前端开发工程师', confidence: 0.9 }, isFinal: false, length: 1 }],
    })
  })
  await page.waitForTimeout(500)
  await shot('03-interim')

  // 最终结果 + 说完
  await page.evaluate(() => {
    const rec = window.__fakeRec
    rec.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: {
            transcript: '我是一名前端开发工程师，做过校园二手交易平台，负责商品发布、搜索和站内聊天三个模块。',
            confidence: 0.96,
          },
          isFinal: true,
          length: 1,
        },
      ],
    })
    rec.onspeechend?.({ type: 'speechend' })
  })
  await page.waitForTimeout(1800)
  await shot('04-reviewing')
  log('REVIEW: ' + (await bodyText()).slice(0, 320))

  // 等自动提交 + 下一题
  await page.waitForTimeout(8000)
  await shot('05-next')
  log('NEXT: ' + (await bodyText()).slice(0, 360))

  // 改用文字
  const textBtn = page.getByRole('button', { name: /改用文字/ }).first()
  if (await textBtn.count()) {
    await textBtn.click()
    await page.waitForTimeout(900)
    await shot('06-text')
    log('TEXT: ' + (await bodyText()).slice(0, 320))
    log('TEXTAREA: ' + (await page.locator('textarea').first().inputValue().catch(() => '')))
  }

  // 小测试/文字模式的语音输入（独立于全真通话）
  const micBtn = page.getByRole('button', { name: /用语音输入/ }).first()
  if (await micBtn.count()) {
    await micBtn.click()
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      const rec = window.__fakeRec
      rec?.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: '我主要负责搜索和分页加载', confidence: 0.9 }, isFinal: false, length: 1 }],
      })
    })
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      const rec = window.__fakeRec
      rec?.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: '我主要负责搜索和分页加载，搜索做了输入防抖。', confidence: 0.95 },
            isFinal: true,
            length: 1,
          },
        ],
      })
      rec?.onspeechend?.({ type: 'speechend' })
    })
    await page.waitForTimeout(2600)
    await shot('07-dictation')
    log('DICTATION: ' + (await page.locator('textarea').first().inputValue().catch(() => '')))
  }

  log('ERRORS: ' + JSON.stringify(errors, null, 2))
  await browser.close()
  if (errors.length) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
