export { useAuthStore } from './authStore'
export { useProfileStore, hasFinishedTest } from './profileStore'
export { useChatStore } from './chatStore'
export { useTaskStore, taskProgress, ONGOING_STATUS } from './taskStore'
export { useInterviewStore } from './interviewStore'
export type { PendingFollowup } from './interviewStore'

/*
 * 换号清理的唯一入口（实现在 ./reset.ts）。
 *
 * 放在 store 出口再导出一次，是为了让「只看 index.ts 就知道 store 里有什么」的人
 * 也能看到它 —— 新增 store 时别忘了登记进 reset.ts 的清单，
 * 那里写了纪律：凡是按用户缓存的状态换号时必须清，模块级 Set/Map 是最容易漏的一类。
 */
export { resetUserScopedStores } from './reset'
