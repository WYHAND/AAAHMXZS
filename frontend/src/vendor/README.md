# vendor/ —— 内联的第三方单文件库

这里放**体积很小、必须离线可用**的第三方库源码。规矩：一个库一个文件，
保留原始许可头，并在本文件里登记来源、版本、改动与升级方法。

---

## TagCloud.js v2.5.0

- **用途**：「我的画像」卡片中间那颗标签球（勘误 9.24.4 / 9.24.5）。
- **上游**：https://github.com/cong-min/TagCloud （现在也发布在 https://github.com/mcc108/TagCloud ）
- **取文件**：`dist/TagCloud.js`（未压缩版；npm 包里 `main` 指向的就是它）
- **许可**：**MIT**（文件头已带 `Copyright (c) 2016-2024 @ Cong Min` + MIT 声明，原样保留）
- **本仓库的改动**：**只有四处**，都在文件里就近注了原因：
  1. **末尾追加一行** `export default (typeof self !== 'undefined' ? self : globalThis).TagCloud`
     —— 上游是 UMD，构造函数挂在 `global.TagCloud`（浏览器里是 `self.TagCloud`），
     ESM 里 `import` 拿不到那个全局赋值。
  2. **深度透明度加下限**：`var alpha = per * per - 0.25` 改成
     `Math.max(0.66, per * per - 0.25)`。上游最低约 0.45，球背面的标签会淡到 **3.1:1**，
     过不了本项目"零条低对比"的验收（`tools/render-check/probe.mjs` 实测）。
     加下限后"近实远虚"仍在，层次更多由 `scale`（0.84 → 1.25）承担。
  3. **`destroy()` 里补 `cancelAnimationFrame`**：上游只把 `interval` 置空，
     而 `_requestInterval` 的 loop 会**自己重新排程** —— 于是销毁后 RAF 仍在跑，
     继续对已摘除的节点写 `transform`（组件每次卸载漏一个循环）。
  4. **事件监听改成具名引用 + 补 `_off()`，`destroy()` 里摘掉**：上游的
     `mouseover/mouseout/mousemove` 都是匿名函数，**摘不掉**；而 `keep: true`（预览里
     那种"鼠标移出后仍跟手"的手感，用户点名要的）会把 `mousemove` 挂在 **window** 上，
     于是每进一次页面就永久留一个监听 + 一份实例闭包。改用具名引用后
     `destroy()` 能把三个监听全部摘掉 —— **不用为了防泄漏而牺牲跟手手感**。
  **球体的布点与旋转算法一行未改。**
- **为什么不 `npm i`**：这个库在 npm 上的包名是 **`TagCloud`（大写 T）**，
  而 npm 11 会把包名小写化 —— 于是 `npm i tagcloud` 命中的是**另一个**同名小写包
  （只有 1.1.0，不是这个库）。内联一个 16KB 的单文件同时满足三点：
  不新增运行时依赖（`package.json` 不动）、离线 exe 里必然存在、版本钉死。
- **升级方法**：从上游 `dist/TagCloud.js` 覆盖本目录的 `TagCloud.js`，然后把
  **末尾那行 `export default` 重新追加**，最后跑一遍
  `node tools/render-check/check-syntax.mjs /src/pages/profile/ProfilePage.tsx`。

### 被用到的部分

只有三处：构造、`pause()` / `resume()`（`prefers-reduced-motion` 用）、`destroy()`
（React 卸载时清容器）。类型声明在 `TagCloud.d.ts`，只覆盖用到的部分。
