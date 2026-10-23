/**
 * 面试复盘右栏的「就业形势」静态资讯。
 *
 * 为什么不接实时新闻：
 * - 项目没有新闻源/抓取服务，硬接一个不稳定的第三方接口会让复盘页经常空着；
 * - 新闻会过期，静态内容必须写清来源和整理日期，不能伪装成"实时"；
 * - 这里只放对求职者有行动价值的公开信息（招聘活动、政策、行业方向），
 *   不放情绪化标题。
 *
 * 更新方式：改这个数组即可，不改页面结构。
 */

export type EmploymentNewsKind = 'policy' | 'recruiting' | 'industry' | 'market'

export interface EmploymentNewsItem {
  kind: EmploymentNewsKind
  title: string
  summary: string
  source: string
  date: string
  href: string
}

/** 最后整理日期：页面会原样显示，避免把旧内容说成"今天" */
export const EMPLOYMENT_NEWS_UPDATED_AT = '2026-10-22'

export const EMPLOYMENT_NEWS: EmploymentNewsItem[] = [
  {
    kind: 'recruiting',
    title: '2027 届“金秋启航”校园招聘月启动',
    summary:
      '9–11 月集中开展，万企进校园、千校万企、千行万业供需对接，重点拓展民营企业与新兴产业岗位。',
    source: '教育部',
    date: '2026-09-24',
    href: 'http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s5987/202609/t20260924_1451848.html',
  },
  {
    kind: 'market',
    title: '全国城市联合招聘秋招专场启动',
    summary:
      '面向 2027 届及往届未就业毕业生，聚焦数字经济、绿色经济、先进制造与现代服务等行业的线上线下专场。',
    source: '人力资源社会保障部 / 新华网',
    date: '2026-09-20',
    href: 'http://www.moe.gov.cn/jyb_xwfb/s5147/202609/t20260921_1451530.html',
  },
  {
    kind: 'industry',
    title: '秋季学期 239 场行业性招聘活动',
    summary:
      '19 个行业、27 个省份、177 所高校参与，覆盖信息通讯、装备制造、金融、医药卫生等方向。',
    source: '国家大学生就业服务平台',
    date: '2026-10-10',
    href: 'https://cso.ncss.cn/ncss/jydt/yw/202610/20261010/2293980085.html',
  },
  {
    kind: 'policy',
    title: '教育部门加力稳岗扩岗',
    summary:
      '院系专场、区域供需对接、国家平台线上招聘持续推进；近期专场汇集岗位 4.3 万余个。',
    source: '新华网',
    date: '2026-10-14',
    href: 'https://www.xinhuanet.com/20261014/c9eae9ad59164d74a799686af7220160/c.html',
  },
]
