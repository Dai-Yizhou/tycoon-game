# 聊天 Dock 渲染层改动规格

> CSS 样式已完成（`style.css` 已更新），本文档描述 `GameHudShell.ts` 中需要配合的 HTML 结构和 JS 逻辑变更。

## 1. HTML 结构变更

当前结构（`getHTML()` 方法内）：

```html
<div class="hud-chat-dock" data-ui="chat-panel">
  <div class="hud-chat-dock__head">
    <span data-ui="chat-head"></span>
    <span class="hud-chat-dock__tabs"><b data-ui="sys-count"></b><span data-ui="tabs-text"></span></span>
  </div>
  <div class="hud-chat-msgs" data-ui="chat-messages"></div>
  <div class="hud-chat-dock__input">
    <select data-ui="chat-channel"></select>
    <input data-ui="chat-input" maxlength="200" />
    <button data-action="chat-send"></button>
  </div>
</div>
```

需替换为：

```html
<div class="hud-chat-dock" data-ui="chat-panel">
  <!-- 折叠态 Ticker -->
  <div class="hud-chat-dock__ticker" data-ui="chat-toggle">
    <span class="hud-chat-dock__ticker-icon">></span>
    <span class="hud-chat-dock__ticker-text" data-ui="chat-ticker"></span>
    <span class="hud-chat-dock__ticker-badge" data-ui="chat-badge"></span>
  </div>
  <!-- 展开态内容 -->
  <div class="hud-chat-dock__expanded">
    <!-- 频道筛选栏：复选框，高 20px -->
    <div class="hud-chat-dock__filters" data-ui="chat-filters"></div>
    <!-- 消息列表 -->
    <div class="hud-chat-msgs" data-ui="chat-messages"></div>
    <!-- 输入栏 -->
    <div class="hud-chat-dock__input">
      <select data-ui="chat-channel"></select>
      <input data-ui="chat-input" maxlength="200" />
      <button data-action="chat-send"></button>
    </div>
  </div>
</div>
```

关键变化：
- 移除 `.hud-chat-dock__head`，用 `.hud-chat-dock__ticker`（折叠态）和 `.hud-chat-dock__expanded`（展开态）替代
- 新增 `.hud-chat-dock__filters` 容器，用于动态渲染频道复选框
- ticker 文本由 JS 动态更新

## 2. JS 逻辑变更

### 2.1 展开状态管理

当前展开依赖纯 CSS `:hover` 和 `:focus-within`。新增 JS 类名管理：

```typescript
// 新增属性
private isExpanded = false;

// 在 bindEvents() 或构造函数中：
const toggle = this.root.querySelector('[data-ui="chat-toggle"]');
toggle?.addEventListener('click', () => {
  this.isExpanded = !this.isExpanded;
  this.root.querySelector('[data-ui="chat-panel"]')?.classList.toggle('is-expanded', this.isExpanded);
});

// 输入框获得焦点时自动展开
this.input.addEventListener('focus', () => {
  this.isExpanded = true;
  this.root.querySelector('[data-ui="chat-panel"]')?.classList.add('is-expanded');
});

// 输入框失焦时延迟收起（允许点击按钮）
this.input.addEventListener('blur', () => {
  setTimeout(() => {
    if (!this.root.contains(document.activeElement)) {
      this.isExpanded = false;
      this.root.querySelector('[data-ui="chat-panel"]')?.classList.remove('is-expanded');
    }
  }, 150);
});
```

CSS 中 `is-expanded` 类的规则已写好（`.hud-chat-dock.is-expanded .hud-chat-dock__expanded { display: flex; }`）。`:hover` 和 `:focus-within` 仍然生效作为兜底。

### 2.2 Ticker 更新

在 `updateChat()` 方法中更新 ticker 文本：

```typescript
const tickerEl = this.root.querySelector('[data-ui="chat-ticker"]')!;
const lastMsg = chat.history[chat.history.length - 1];
if (lastMsg) {
  const chanKey = lastMsg.channel === 'system' ? 'system' : lastMsg.channel === 'team' ? 'team' : 'region';
  const chanLabel = t(`chat.channel.${chanKey}`);
  tickerEl.innerHTML = `<span class="ch">${this.escapeHtml(chanLabel)}</span>${this.escapeHtml(lastMsg.text)}`;
} else {
  tickerEl.textContent = t('hud.noMessage');
}
```

> 说明：不渲染未读计数徽章（`chat-badge` 已移除），也不渲染频道筛选计数（`.cnt`）。

### 2.3 频道复选框渲染

新增方法，在 `updateChat()` 末尾调用：

```typescript
private renderFilters(chat: ChatState): void {
  const filtersEl = this.root.querySelector('[data-ui="chat-filters"]')!;
  const channels = [
    { id: 'region', labelKey: 'chat.channel.region' },
    { id: 'system', labelKey: 'chat.channel.system' },
    { id: 'team', labelKey: 'chat.channel.team' },
  ];
  filtersEl.innerHTML = channels.map(ch => {
    const checked = this.activeFilters.has(ch.id) ? 'checked' : '';
    const cls = this.activeFilters.has(ch.id) ? 'hud-chat-dock__filter--checked' : '';
    return `<label class="hud-chat-dock__filter ${cls}" data-channel="${ch.id}">
      <input type="checkbox" ${checked} data-ui="filter-${ch.id}" />
      ${t(ch.labelKey)}
    </label>`;
  }).join('');

  // 绑定 change 事件
  channels.forEach(ch => {
    const cb = this.root.querySelector(`[data-ui="filter-${ch.id}"]`) as HTMLInputElement;
    cb?.addEventListener('change', () => {
      if (cb.checked) this.activeFilters.add(ch.id);
      else this.activeFilters.delete(ch.id);
      this.updateChat();
    });
  });
}
```

新增属性：`private activeFilters = new Set(['region', 'system', 'team']);`（默认全选）

### 2.4 消息过滤渲染

`updateChat()` 中渲染消息列表时，根据 `activeFilters` 过滤：

```typescript
private updateChat(): void {
  const chat = this.vm.getChat();
  const msgsEl = this.root.querySelector('[data-ui="chat-messages"]')!;

  const filtered = chat.history.filter(m => {
    const cid = m.channel === 'system' ? 'system' : m.channel === 'team' ? 'team' : 'region';
    return this.activeFilters.has(cid);
  });
  const recent = filtered.slice(-10);

  if (recent.length > 0) {
    msgsEl.innerHTML = recent.map(m => {
      const chanKey = m.channel === 'system' ? 'system' : m.channel === 'team' ? 'team' : 'region';
      const chanLabel = t(`chat.channel.${chanKey}`);
      return `<div class="hud-chat-msg"><b>${this.escapeHtml(chanLabel)}</b><span>${this.escapeHtml(m.text)}</span></div>`;
    }).join('');
  } else {
    msgsEl.innerHTML = `<div class="hud-chat-msg"><span class="sys">${this.escapeHtml(t('hud.noMessage'))}</span></div>`;
  }

  this.renderFilters(chat);        // 新增
  this.updateTicker(chat);        // 新增（从上方 ticker 更新逻辑提取）
}
```

### 2.5 移除旧元素引用

构造函数中移除对已删除元素的引用：

```typescript
// 删除：this.root.querySelector('[data-ui="chat-head"]')
// 删除：this.root.querySelector('[data-ui="sys-count"]')
// 删除：this.root.querySelector('[data-ui="tabs-text"]')
// 新增：this.root.querySelector('[data-ui="chat-ticker"]')
// 新增：this.root.querySelector('[data-ui="chat-badge"]')
// 新增：this.root.querySelector('[data-ui="chat-filters"]')
```

## 3. 元素引用变更汇总

| 旧 data-ui | 新 data-ui | 说明 |
|---|---|---|
| `chat-head` | — | 已移除 |
| `sys-count` | `chat-badge` | badge 从标签文本变为未读计数 |
| `tabs-text` | — | 已移除 |
| — | `chat-toggle` | ticker 点击切换展开 |
| — | `chat-ticker` | ticker 单行文本 |
| — | `chat-filters` | 频道复选框容器 |

## 4. 不需要变更的部分

- `sendChat()` 方法：逻辑不变
- `chat-channel` select：保留，用于发送时选择频道
- `chat-input` input：保留，maxlength 不变
- `chat-send` button：保留
- CSS `:hover` / `:focus-within` 展开规则：保留作为兜底，不与 `is-expanded` 冲突

## 5. 交互行为总结

| 状态 | 触发 | 显示内容 |
|---|---|---|
| 折叠（默认） | 页面加载 / 失焦后 | ticker 单行：`> [频道] 最新消息` |
| hover 展开 | 鼠标移入 dock | 频道筛选栏 + 消息列表 + 输入栏 |
| focus 展开 | 输入框获得焦点 | 同上，且不因鼠标移出收起 |
| 人工展开 | 点击 ticker | 切换 `is-expanded`，保持展开直到再次点击 |
| 频道筛选 | 点击复选框 | 即时过滤消息列表，ticker 仍显示全频道最新 |
