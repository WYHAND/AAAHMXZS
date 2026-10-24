/**
 * 换号（登录 / 注册 / 登出）时的**统一清理入口**。
 *
 * 纪律（动这个文件之前先读完这三条）：
 *
 * 1. **凡是按用户缓存的前端状态，换号时必须清。**
 *    后端所有接口都按 token 里的 user_id 鉴权，但前端 store 是**内存单例、跨账号存活**：
 *    上一个账号的会话 id、画像、任务、面试场次只要还留在内存里，新账号一进页面
 *    就会拿着旧 id 去请求 —— 落到后端就是「这条记录不属于你」→ code 2001，
 *    界面于是抱着一个已经不存在的选中项空转（「AI 对话」页永远转圈的现场）。
 *    只清画像是不够的：那只是被漏掉的那一类里最先被发现的一个。
 *
 *    ⚠️ 推论：清完之后还要防住**迟到的响应**把它重新弄脏 —— 换号前发出的请求
 *    可能在换号之后才回来，把上一个账号的数据写进新账号的内存（画像那份最危险：
 *    fetched/tested 是路由守卫的分流依据）。做法是每个按用户的 store 自带一个
 *    世代号，`reset()` 时 +1，异步结果落地前比一次，世代对不上就整份丢弃。
 *    已实现：chatStore.loadConversations / profileStore.fetchProfile /
 *    taskStore.fetchTasks·fetchTask / interviewStore.loadQuestions·fetchReview。
 *    （世代号只描述"请求属于哪一代"，不描述"某个东西渲染过"，因此不会变成
 *    手册 6.12 说的那种"登记与渲染分离"的副本簿记。）
 *
 * 2. **模块级 Set/Map 不受 store.reset 管辖，是最容易被漏掉的一类。**
 *    chatStore 里的 openingRequested / openingInFlight 活在 store 之外
 *    （模块级、跨组件实例存活），里面记的是上一个账号的会话 id。
 *    只要 reset() 没跑，ensureOpening() 就会拿「这个会话我已经拉过开场白了」的脏簿记
 *    直接早退 —— 不发请求、不置成功也不置失败，界面既没气泡、也没等待态、也没失败态，
 *    也就是永远转圈。所以：**新增任何模块级缓存/簿记，都必须能被这里的某次 reset 清掉**
 *    （最省事的做法就是写进对应 store 的 reset()，像 chatStore 那样），
 *    并且要在 reset() 里逐个 clear()，不能只清 state。
 *
 * 3. **新增 store 必须登记进下面的清单**，否则它就会成为下一个「只清了画像」的缺口。
 *    本函数在 store/index.ts（store 的唯一出口）里再导出一次，
 *    保证只看出口的人也能看到它，而不是只在 authStore 里被偷偷调用。
 *
 * ⚠️ 有意**不**在这里清的东西，见函数末尾的说明。
 */

import { useChatStore } from './chatStore'
import { useInterviewStore } from './interviewStore'
import { useProfileStore } from './profileStore'
import { useTaskStore } from './taskStore'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 清空所有按用户缓存的前端状态。调用时机只有三个：
 * authStore 的 `login()` / `register()`（成功后，换上了新账号）与 `logout()`。
 *
 * 它**不碰** authStore 自己：token 的时机由 authStore 掌控
 * （logout 清掉、login/register 成功后写入新 token），在这里清会把刚拿到的新 token 抹掉。
 *
 * 顺序无所谓：每个 store 的 reset() 只写自己的 state，彼此不读对方。
 *
 * ⚠️ 关于依赖环：`authStore → reset → chatStore → authStore` 确实构成一个环
 * （chatStore 要 import authStore 拿 token）。它安全的前提是**环上的跨模块引用
 * 全部发生在函数体里**（登录成功后才调用本函数），没有任何模块在**求值期**
 * 读对方的绑定 —— 一旦谁在顶层读，就会撞上 `Cannot access before initialization`。
 * 想拆掉这个环，正确做法是照 api/client.ts 的 `registerAuthBridge` 反向注入，
 * 而不是把本文件拆成几份散在各处的 reset。
 */
export function resetUserScopedStores(): void {
  /** 会话列表 / 当前会话 / 消息 / 开场白簿记（含两个模块级 Set/Map）+ 中断在途流 */
  useChatStore.getState().reset()
  /** 画像 / 标签 / 阶段 / tested / 下一步建议 / fetched / failed */
  useProfileStore.getState().reset()
  /** 成长任务列表 / 当前任务详情 / 步骤 */
  useTaskStore.getState().reset()
  /** 进行中的面试 / 题目 / 当前题号 / 待答追问 / 复盘 + sessionStorage 里的面试 id */
  useInterviewStore.getState().reset()

  /*
   * 页面直接写在 sessionStorage 里、没进 store 的用户数据。
   *
   * 「测试答题进度」由 TestQuestionPage 自己写（历史上没走 store），
   * 换号后必须丢掉：否则新账号会「恢复上次未提交的答题」，把别人的答案算到自己头上。
   *
   * （另一个按用户的 sessionStorage 键 interviewId 由 interviewStore.reset() 负责，
   * 这里不重复清 —— 同一件事只留一处清理，两份簿记一定会不一致。）
   */
  storage.session.remove(STORAGE_KEY.testProgress)

  /*
   * ⚠️ 有意**不**清：
   *
   * - authStore 的 token / user / bootstrapped：见函数注释，时机由 authStore 掌控。
   * - profileStore.version：它是「画像变了」的全局失效信号，单调递增、与账号无关。
   *   重置回 0 只会让依赖它的 useEffect 少触发一次（若原本就是 0），有害无益。
   * - 纯 UI 偏好：响应式断点（useResponsive 直接读窗口）、折叠/展开、弹窗开关、
   *   sonner 的 toast 队列 —— 要么与用户无关，要么随组件卸载自然消失，均非「按用户缓存」。
   */
}
