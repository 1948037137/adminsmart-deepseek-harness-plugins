/** AdminSmart browser plugin bundle using the DeepSeek Harness lazy-CJS client-module contract. */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-client-ui',
  factory: (require) => {
    const module = { exports: {} } // Lazy-CJS module container returned to the Harness Client Loader.
    const exports = module.exports // Named exports populated at the end of this factory.
    const { jsx, jsxs } = require('react/jsx-runtime') // React JSX runtime is a Harness platform seed and is not bundled twice.
    const { useEffect, useMemo, useRef, useState } = require('react') // Hooks drive history filtering, image intake, and Session-scoped knowledge state.
    const { defineStore } = require('@deepseek-ai/dsh-client-store') // Harness-owned Store engine persists sidebar viewing preferences without ad-hoc browser storage.
    const {
      Button, IconCheckOutline16, IconChecklistOutline14, IconChevronDownOutline14,
      IconCloseOutline16, IconEditOutline16, IconEllipsisOutline16, IconNewChatOutline16,
      IconPanelLeftOutline16, IconPlusOutline16, IconSearchOutline16, IconTrashOutline16, Menu, Modal
    } = require('@deepseek-ai/dsh-client-ui-primitives') // Official Harness controls keep toolbar and destructive-action geometry consistent.

    const inject = ['slots', 'layout', 'uiWorkspace', 'workspaces', 'sessions', 'conversation', 'theme'] // AdminSmart surfaces reuse official layout, navigation, Session, image-draft, and theme services.
    const KNOWLEDGE_SCOPE_URL = '/agent-harness/adminsmart/knowledge/scope' // Gateway-prefixed Host route; browser never receives Runtime capability credentials.
    const SESSION_SEARCH_URL = './adminsmart/sessions/search' // Host plugin wrapper retains Harness match seq/time for click-to-locate behavior.
    const AURASEARCH_LOGO_URL = './adminsmart/assets/aurasearch-logo.jpg?v=20260901-2' // Relative URL works through both the Gateway prefix and an isolated direct Harness origin; the local date and revision invalidate superseded artwork.
    const ADMINSMART_PRIMARY_COLOR = '#409eff' // Exact Element Plus active-menu color used by the AdminSmart host navigation.
    const ADMINSMART_STYLE_ID = 'adminsmart-harness-client-ui' // Stable style element identity across Client HMR replacement.
    const CHAT_IMAGE_MIME_TYPES = new Set([
      'image/png', // PNG 截图或透明背景图片。
      'image/jpeg', // JPEG/JPG 相机照片和普通图片。
      'image/webp', // WebP 网页图片和截图。
      'image/gif' // GIF 图片；是否解析动画帧由当前多模态模型决定。
    ]) // 聊天附件白名单；这些文件仅进入当前问题上下文，不进入知识库。
    const HISTORY_SEARCH_DEBOUNCE_MS = 240 // 会话正文搜索等待短暂停顿后再调用 Harness 内容索引。
    const HISTORY_SEARCH_MAX_LENGTH = 200 // 搜索词最大 UTF-16 长度，避免无界输入进入 Session 搜索接口。
    const DEEPSEEK_REFERENCE_SIDEBAR_WIDTH = 261 // 参考页面在 1396px 视口下的实际侧栏视觉宽度。
    const SEARCH_OVERLAY_MESSAGE_TYPE = 'adminsmart:agent-search-overlay' // iframe 向 Vue Teleport 宿主发送的无敏感几何消息类型。
    const SEARCH_OVERLAY_CLOSE_MESSAGE_TYPE = 'adminsmart:agent-search-overlay-close' // Vue 蒙层点击后请求 iframe 关闭搜索的消息类型。
    const ADMINSMART_UI_STYLES = `
/* AdminSmart brand: match the host system's selected navigation color. */
[data-adminsmart-brand-mark="true"] {
  background: transparent !important;
}

/* AdminSmart history sidebar: DeepSeek-style time groups with progressive search and row menus. */
.adminsmart-history {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  padding: 0 14px 12px 2px;
  color: #1f2329;
  font-family: Inter, "Microsoft YaHei", sans-serif;
}
.adminsmart-history__toolbar {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 12px;
}
.adminsmart-history__label {
  min-width: 0;
  flex: 1;
  color: #8a8f99;
  font-size: 13px;
  font-weight: 500;
}
.adminsmart-history__search {
  box-sizing: border-box;
  min-width: 0;
  height: 32px;
  flex: 1;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  outline: none;
  color: #1f2329;
  background: #ffffff;
  font-size: 13px;
  letter-spacing: 0;
}
.adminsmart-history__search:focus {
  border-color: ${ADMINSMART_PRIMARY_COLOR};
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.12);
}
.adminsmart-history__toolbar-action,
.adminsmart-history__menu-button {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: #8a8f99;
  background: transparent;
  cursor: pointer;
}
.adminsmart-history__toolbar-action:hover,
.adminsmart-history__menu-button:hover {
  color: #1f2329;
  background: rgba(31, 35, 41, 0.06);
}
.adminsmart-history__toolbar-action:focus-visible,
.adminsmart-history__menu-button:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 1px;
}
.adminsmart-history__list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding-bottom: 8px;
}
.adminsmart-history__group + .adminsmart-history__group {
  margin-top: 10px;
}
.adminsmart-history__group-title {
  display: flex;
  min-height: 30px;
  align-items: center;
  padding: 0 12px;
  color: #8a8f99;
  font-size: 12px;
  font-weight: 500;
}
.adminsmart-history__row {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 40px;
  align-items: center;
  padding: 0 4px 0 0;
  border-radius: 8px;
  color: #1f2329;
  background: transparent;
  font-size: 14px;
  letter-spacing: 0;
}
.adminsmart-history__row:hover,
.adminsmart-history__row:focus-within,
.adminsmart-history__row[aria-selected="true"] {
  background: rgba(31, 35, 41, 0.055);
}
.adminsmart-history__open {
  display: flex;
  min-width: 0;
  height: 40px;
  flex: 1;
  align-items: center;
  padding: 0 12px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.adminsmart-history__open:focus-visible {
  outline: none;
}
.adminsmart-history__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-history__menu-button {
  opacity: 0;
  transition: opacity 100ms ease, color 100ms ease, background-color 100ms ease;
}
.adminsmart-history__row:hover .adminsmart-history__menu-button,
.adminsmart-history__row:focus-within .adminsmart-history__menu-button {
  opacity: 1;
}
@media (hover: none) {
  .adminsmart-history__menu-button {
    opacity: 0.72;
  }
}
.adminsmart-delete-copy {
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}
.adminsmart-delete-status {
  margin-top: 8px;
  color: #909399;
  font-size: 12px;
}
.adminsmart-delete-error {
  margin-top: 8px;
  color: #f56c6c;
  font-size: 12px;
}
.adminsmart-delete-action {
  color: #f56c6c !important;
  border-color: rgba(245, 108, 108, 0.5) !important;
}

/* AdminSmart complete sidebar: one Harness sidebar Slot, no Workspace-facing chrome. */
.adminsmart-sidebar {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  padding: 6px 12px 0;
  overflow: hidden;
  border-right: var(--adminsmart-sidebar-visual-tail, 0px) solid var(--dsw-specific-page-fill, #ffffff);
  color: #0f1115;
  background: #f9fafb;
  font-family: Inter, "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}
.adminsmart-sidebar--collapsed {
  align-items: center;
  gap: 10px;
  padding: 16px 10px 12px;
}
.adminsmart-sidebar__header {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 52px;
  flex: 0 0 52px;
  align-items: center;
  gap: 18px;
}
.adminsmart-sidebar__brand {
  display: inline-flex;
  min-width: 0;
  height: 36px;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.adminsmart-sidebar__brand:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 41, 0.06));
}
.adminsmart-sidebar__brand-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-sidebar__icon-button {
  position: relative;
  box-sizing: border-box;
  display: grid;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #81858c;
  background: transparent;
  cursor: pointer;
}
.adminsmart-sidebar__icon-button::before {
  position: absolute;
  inset: -10px;
  content: '';
}
.adminsmart-sidebar__rail-button {
  box-sizing: border-box;
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #606266);
  background: transparent;
  cursor: pointer;
}
.adminsmart-sidebar__icon-button:hover,
.adminsmart-sidebar__rail-button:hover {
  color: var(--dsw-alias-label-primary, #1f2329);
  background: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 41, 0.06));
}
.adminsmart-sidebar__brand:focus-visible,
.adminsmart-sidebar__icon-button:focus-visible,
.adminsmart-sidebar__rail-button:focus-visible,
.adminsmart-sidebar__new-session:focus-visible,
.adminsmart-sidebar__bulk-close:focus-visible,
.adminsmart-sidebar__bulk-trigger:focus-visible,
.adminsmart-sidebar__bulk-action:focus-visible,
.adminsmart-history__check:focus-visible,
.adminsmart-search__result:focus-visible,
.adminsmart-search__close:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 1px;
}
.adminsmart-sidebar__new-session {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 40px;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 28px;
  padding: 0 16px;
  border: 0.666667px solid rgba(103, 158, 254, 0);
  border-radius: 100px;
  color: #0f1115;
  background: #ffffff;
  box-shadow: rgba(72, 104, 178, 0.04) 0 -2px 2px,
    rgba(106, 111, 117, 0.09) 0 2px 2px,
    rgba(72, 104, 178, 0.08) 0 1px 2px;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.adminsmart-sidebar__new-session:hover {
  border-color: rgba(103, 158, 254, 0.35);
  background: #ffffff;
}
.adminsmart-sidebar__bulk-header {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 40px;
  flex: 0 0 40px;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 28px;
  padding-left: 10px;
}
.adminsmart-sidebar__bulk-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #0f1115;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-sidebar__bulk-close {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 1px solid #e1e3e6;
  border-radius: 50%;
  color: #81858c;
  background: #ffffff;
  cursor: pointer;
}
.adminsmart-sidebar__bulk-close:hover {
  color: #0f1115;
  background: #f1f3f5;
}
.adminsmart-sidebar__bulk-actions {
  box-sizing: border-box;
  display: grid;
  width: 100%;
  height: 62px;
  flex: 0 0 62px;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid #ebeef1;
}
.adminsmart-sidebar__bulk-action {
  display: inline-flex;
  min-width: 0;
  height: 61px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0;
  border: 0;
  color: #0f1115;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.adminsmart-sidebar__bulk-action + .adminsmart-sidebar__bulk-action {
  border-left: 1px solid #ebeef1;
}
.adminsmart-sidebar__bulk-action--danger {
  color: #ec1313;
}
.adminsmart-sidebar__bulk-action:hover:not(:disabled) {
  background: #f1f3f5;
}
.adminsmart-sidebar__bulk-action:disabled {
  color: #a8adb5;
  cursor: default;
}
.adminsmart-sidebar__bulk-trigger {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #81858c;
  background: transparent;
  cursor: pointer;
}
.adminsmart-sidebar__bulk-trigger:hover {
  color: #0f1115;
  background: #f1f3f5;
}
.adminsmart-sidebar .adminsmart-history {
  width: 100%;
  min-height: 0;
  flex: 1;
  padding: 0;
  overflow: hidden;
}
.adminsmart-sidebar .adminsmart-history__list {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0;
}
.adminsmart-sidebar .adminsmart-history__group + .adminsmart-history__group {
  margin-top: 20px;
}
.adminsmart-sidebar .adminsmart-history__group-title {
  box-sizing: border-box;
  height: 22px;
  min-height: 22px;
  padding: 2px 10px;
  color: #81858c;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  justify-content: space-between;
}
.adminsmart-sidebar .adminsmart-history__row {
  position: relative;
  min-height: 40px;
  padding: 0;
  border-radius: 12px;
  color: #0f1115;
}
.adminsmart-sidebar .adminsmart-history__row:hover,
.adminsmart-sidebar .adminsmart-history__row:focus-within {
  background: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 41, 0.06));
}
.adminsmart-sidebar .adminsmart-history__row[aria-selected="true"][data-multi-select="false"] {
  color: #3964fe;
  background: #e4edfd;
}
.adminsmart-sidebar .adminsmart-history__row[data-multi-select="true"] {
  color: #0f1115;
  background: transparent;
}
.adminsmart-sidebar .adminsmart-history__row[data-multi-select="true"]:hover,
.adminsmart-sidebar .adminsmart-history__row[data-multi-select="true"]:focus-within {
  background: #f1f3f5;
}
.adminsmart-sidebar .adminsmart-history__open {
  height: 40px;
  padding: 9px 6px 9px 10px;
  line-height: 22px;
}
.adminsmart-history__check {
  box-sizing: border-box;
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  margin-left: 10px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #ffffff;
  background: transparent;
  box-shadow: rgba(0, 0, 0, 0.12) 0 0 0 1.5px inset;
  cursor: pointer;
}
.adminsmart-history__check[aria-pressed="true"] {
  background: #3964fe;
  box-shadow: none;
}
.adminsmart-sidebar .adminsmart-history__menu-button {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
  margin-right: 6px;
}
.adminsmart-sidebar .adminsmart-history__row[aria-selected="true"] .adminsmart-history__menu-button {
  opacity: 0.72;
}
.adminsmart-sidebar .adminsmart-history__empty {
  padding: 32px 12px;
  text-align: center;
}

/* AdminSmart conversation search: modal overlay modeled after the DeepSeek history finder. */
.adminsmart-search {
  position: fixed;
  z-index: 10000;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  align-items: start;
  justify-items: center;
  padding: 14vh 16px 16px;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(2px);
}
.adminsmart-search[data-external-overlay="true"] {
  background: transparent;
  backdrop-filter: none;
}
.adminsmart-search__dialog {
  box-sizing: border-box;
  display: flex;
  width: min(660px, calc(100vw - 32px));
  max-height: min(72vh, 916px);
  flex-direction: column;
  overflow: hidden;
  border: 0;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: rgba(0, 0, 0, 0.04) 0 2px 4px,
    rgba(0, 0, 0, 0.02) 0 4px 10px;
}
.adminsmart-search__dialog[data-expanded="true"] {
  height: min(72vh, 916px);
}
.adminsmart-search__field-row {
  box-sizing: border-box;
  display: flex;
  min-height: 60px;
  flex: 0 0 60px;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 0;
}
.adminsmart-search__dialog[data-expanded="true"] .adminsmart-search__field-row {
  border-bottom: 1px solid #ebeef1;
  border-radius: 20px 20px 0 0;
}
.adminsmart-search__dialog[data-expanded="false"] .adminsmart-search__field-row {
  border-radius: 20px;
}
.adminsmart-search__field-icon {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #8a8f99);
}
.adminsmart-search__input {
  min-width: 0;
  height: 24px;
  flex: 1;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--dsw-alias-label-primary, #1f2329);
  background: transparent;
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0;
}
.adminsmart-search__input::placeholder {
  color: var(--dsw-alias-label-tertiary, #a3a7ae);
}
.adminsmart-search__close {
  display: grid;
  width: 32px;
  height: 28px;
  flex: 0 0 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 28px;
  color: #81858c;
  background: transparent;
  cursor: pointer;
}
.adminsmart-search__close:hover {
  background: var(--dsw-alias-interactive-bg-hover, #f5f7fa);
}
.adminsmart-search__body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.adminsmart-search__status {
  padding: 34px 18px;
  color: var(--dsw-alias-label-tertiary, #8a8f99);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}
.adminsmart-search__status[data-level="error"] {
  color: #f56c6c;
}
.adminsmart-search__results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.adminsmart-search__result {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 67px;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 10px;
  border: 0;
  border-radius: 16px;
  color: #0f1115;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.adminsmart-search__result-icon {
  box-sizing: border-box;
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 50%;
  color: #81858c;
  background: transparent;
  box-shadow: rgba(0, 0, 0, 0.1) 0 0 0 1px inset;
}
.adminsmart-search__result-content {
  display: flex;
  min-width: 0;
  height: 47px;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.adminsmart-search__result:hover,
.adminsmart-search__result[aria-current="true"] {
  background: #f1f3f5;
}
.adminsmart-search__result-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  height: 25px;
  line-height: 25px;
}
.adminsmart-search__result-title,
.adminsmart-search__result-snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-search__result-title {
  min-width: 0;
  flex: 1;
  font-size: 15px;
  font-weight: 400;
  line-height: 25px;
}
.adminsmart-search__result-date {
  flex: none;
  color: #81858c;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}
.adminsmart-search__result-snippet {
  color: #61666b;
  font-size: 13px;
  line-height: 20px;
}
.adminsmart-search__more {
  padding: 10px 12px 4px;
  color: var(--dsw-alias-label-tertiary, #8a8f99);
  font-size: 12px;
  text-align: center;
}
[data-chat-anchor-key][data-adminsmart-search-hit="true"] {
  border-radius: 8px;
  box-shadow: 0 0 0 8px rgba(228, 237, 253, 0.72);
  scroll-margin-block: 120px;
}
.adminsmart-rename-field {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l1, #dcdfe6);
  border-radius: 8px;
  outline: none;
  color: var(--dsw-alias-label-primary, #1f2329);
  background: #ffffff;
  font: inherit;
  font-size: 14px;
  letter-spacing: 0;
}
.adminsmart-rename-field:focus {
  border-color: ${ADMINSMART_PRIMARY_COLOR};
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.12);
}
.adminsmart-rename-error {
  margin-top: 8px;
  color: #f56c6c;
  font-size: 12px;
}
@media (max-width: 720px) {
  .adminsmart-search {
    padding: 16px;
  }
  .adminsmart-search__dialog {
    width: 100%;
    max-height: calc(100vh - 32px);
  }
  .adminsmart-search__dialog[data-expanded="true"] {
    height: calc(100vh - 32px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .adminsmart-history__menu-button,
  .adminsmart-knowledge-chevron,
  .adminsmart-turn-process__chevron {
    transition: none;
  }
}
.adminsmart-turn-process {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  color: var(--dsw-alias-label-secondary, #61666b);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.adminsmart-turn-process__chevron {
  transition: transform 100ms ease;
}
.adminsmart-turn-process[aria-expanded="true"] .adminsmart-turn-process__chevron {
  transform: rotate(180deg);
}
.adminsmart-turn-process:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 2px;
}
.adminsmart-history__empty {
  padding: 28px 12px;
  color: #8a8f99;
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
}

/* AdminSmart composer tools: upload and knowledge scope follow an 8px control rhythm. */
.adminsmart-composer-tools {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.adminsmart-upload-button {
  box-sizing: border-box;
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--dsw-alias-label-primary, #303133);
  background: var(--dsw-specific-selector, #f5f7fa);
  cursor: pointer;
}
.adminsmart-upload-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, #ecf5ff);
}
.adminsmart-upload-button:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 2px;
}
.adminsmart-upload-button:disabled {
  cursor: default;
  opacity: 0.5;
}
.adminsmart-knowledge-button {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 4px;
  padding: 0 6px !important;
  border: 0 !important;
  border-radius: 24px !important;
  color: var(--dsw-alias-label-secondary, #61666b) !important;
  background: transparent !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  line-height: 20px !important;
}
.adminsmart-knowledge-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, #f5f7fa) !important;
}
.adminsmart-knowledge-button:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 2px;
}
.adminsmart-knowledge-chevron {
  flex: none;
  transition: transform 100ms ease;
}
.adminsmart-knowledge-chevron--open {
  transform: rotate(180deg);
}
.adminsmart-knowledge-scope {
  position: relative;
  display: inline-flex;
  min-width: 0;
  align-items: center;
}
.adminsmart-knowledge-popover {
  position: absolute;
  z-index: 110;
  left: 0;
  bottom: calc(100% + 12px);
  box-sizing: border-box;
  display: flex;
  width: min(360px, calc(100vw - 32px));
  max-height: min(420px, 60vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  color: #0f1115;
  background: #ffffff;
  box-shadow: rgba(0, 0, 0, 0.06) 0 8px 24px,
    rgba(0, 0, 0, 0.03) 0 2px 6px;
}
.adminsmart-knowledge-popover__header {
  box-sizing: border-box;
  display: flex;
  min-height: 58px;
  flex: 0 0 58px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid #ebeef1;
}
.adminsmart-knowledge-popover__heading {
  min-width: 0;
  flex: 1;
}
.adminsmart-knowledge-popover__title,
.adminsmart-knowledge-popover__meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-knowledge-popover__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.adminsmart-knowledge-popover__meta {
  color: #81858c;
  font-size: 12px;
  line-height: 18px;
}
.adminsmart-knowledge-popover__close {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #81858c;
  background: transparent;
  cursor: pointer;
}
.adminsmart-knowledge-popover__close:hover {
  color: #0f1115;
  background: #f1f3f5;
}
.adminsmart-knowledge-popover__list {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px;
}
.adminsmart-knowledge-popover__group-label {
  box-sizing: border-box;
  display: flex;
  height: 30px;
  min-height: 30px;
  align-items: center;
  margin-top: 6px;
  padding: 0 10px;
  color: #81858c;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}
.adminsmart-knowledge-option {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border: 0;
  border-radius: 12px;
  color: #0f1115;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.adminsmart-knowledge-option:hover,
.adminsmart-knowledge-option:focus-visible {
  background: #f1f3f5;
}
.adminsmart-knowledge-option[data-selected="true"] {
  background: #f3f6ff;
}
.adminsmart-knowledge-option:disabled {
  cursor: wait;
  opacity: 0.58;
}
.adminsmart-knowledge-option__check {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  background: transparent;
  box-shadow: rgba(0, 0, 0, 0.14) 0 0 0 1.5px inset;
}
.adminsmart-knowledge-option__check[data-selected="true"] {
  background: #3964fe;
  box-shadow: none;
}
.adminsmart-knowledge-option__copy {
  min-width: 0;
  flex: 1;
}
.adminsmart-knowledge-option__title,
.adminsmart-knowledge-option__file {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-knowledge-option__title {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.adminsmart-knowledge-option__file {
  color: #81858c;
  font-size: 12px;
  line-height: 18px;
}
.adminsmart-knowledge-popover__status {
  padding: 24px 12px;
  color: #81858c;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
.adminsmart-knowledge-popover__status[data-level="error"] {
  color: #ec1313;
}
.adminsmart-knowledge-popover__footer {
  box-sizing: border-box;
  display: grid;
  height: 52px;
  flex: 0 0 52px;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid #ebeef1;
}
.adminsmart-knowledge-popover__action {
  height: 51px;
  padding: 0;
  border: 0;
  color: #0f1115;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
}
.adminsmart-knowledge-popover__action + .adminsmart-knowledge-popover__action {
  border-left: 1px solid #ebeef1;
}
.adminsmart-knowledge-popover__action--primary {
  color: #3964fe;
}
.adminsmart-knowledge-popover__action:hover:not(:disabled) {
  background: #f1f3f5;
}
.adminsmart-knowledge-popover__action:disabled {
  color: #a8adb5;
  cursor: default;
}
.adminsmart-knowledge-popover__close:focus-visible,
.adminsmart-knowledge-option:focus-visible,
.adminsmart-knowledge-popover__action:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: -2px;
}
.adminsmart-upload-message {
  max-width: 180px;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-upload-message[data-level="info"] {
  color: #909399;
}
.adminsmart-upload-message[data-level="success"] {
  color: #67c23a;
}
.adminsmart-upload-message[data-level="error"] {
  color: #f56c6c;
}
` // Scoped CSS uses stable AdminSmart classes and semantic data attributes, never upstream hashed class names.

    /** Install or refresh the single AdminSmart stylesheet owned by this Client plugin. */
    function installAdminSmartStyles() {
      let styleElement = document.querySelector(`style[data-adminsmart-style="${ADMINSMART_STYLE_ID}"]`) // Existing HMR style node, when present.
      if (!styleElement) {
        styleElement = document.createElement('style')
        styleElement.setAttribute('data-adminsmart-style', ADMINSMART_STYLE_ID)
        document.head.appendChild(styleElement)
      }
      if (styleElement.textContent !== ADMINSMART_UI_STYLES) styleElement.textContent = ADMINSMART_UI_STYLES
      return styleElement
    }

    /** Render the operator-provided AuraSearch logo requested by sidebar or hero geometry. */
    function AdminSmartMark({ size = 24, className }) {
      const edge = Math.max(20, Number(size) || 24) // Official slot owner controls mark geometry with a safe minimum.
      return jsx('img', {
        className,
        'data-adminsmart-brand-mark': 'true',
        src: AURASEARCH_LOGO_URL,
        alt: '',
        'aria-hidden': 'true',
        draggable: false,
        width: edge,
        height: edge,
        style: {
          display: 'block',
          width: `${edge}px`,
          height: `${edge}px`,
          borderRadius: '7px',
          clipPath: 'inset(0 round 7px)',
          objectFit: 'cover',
          boxShadow: '0 0 0 1px rgba(15, 17, 21, 0.08)'
        }
      })
    }

    /** Render the AuraSearch product name without any DSH or DeepSeek text. */
    function AdminSmartName() {
      return jsx('span', {
        'data-adminsmart-brand-name': 'true',
        style: {
          color: 'inherit',
          fontFamily: 'Inter, "Microsoft YaHei", sans-serif',
          fontSize: '14px',
          fontWeight: '600',
          lineHeight: '20px',
          letterSpacing: '0',
          whiteSpace: 'nowrap'
        },
        children: 'AuraSearch'
      })
    }

    /** Render the compact pin glyph missing from the current official primitive set. */
    function AdminSmartPinIcon({ size = 16 }) {
      const edge = Math.max(14, Number(size) || 16) // Bottom bulk actions use one stable icon edge.
      return jsxs('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        children: [
          jsx('path', { d: 'M12 17v5' }),
          jsx('path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' })
        ]
      })
    }

    /** Suppress internal model context nodes while preserving them in the durable Session log. */
    function AdminSmartHiddenChatNode() {
      return null
    }

    /** Remove the complete per-Session title/actions header while retaining the conversation body and composer. */
    function AdminSmartHiddenSessionHeader() {
      return null
    }

    /** Render the Harness Turn-process disclosure opened by default for user-visible reasoning. */
    function AdminSmartTurnProcessNode({ turnProcess }) {
      const foldable = Boolean(turnProcess?.foldable) // Harness decides whether the current Turn has a collapsible process window.
      const open = Boolean(turnProcess?.open) // Shared Chat store state remains authoritative after the initial expansion.
      useEffect(() => {
        if (foldable && !open) turnProcess.setOpen(true)
      }, [foldable, open, turnProcess])
      if (!foldable) return null
      return jsxs('button', {
        type: 'button',
        className: 'adminsmart-turn-process',
        'aria-expanded': open,
        onClick: () => { turnProcess.setOpen(!open) },
        children: [
          jsx('span', { children: '已思考' }),
          jsx(IconChevronDownOutline14, {
            className: 'adminsmart-turn-process__chevron',
            'aria-hidden': 'true'
          })
        ]
      })
    }

    /** Create the persisted AdminSmart sidebar viewing store through the official Harness Store engine. */
    function createAdminSmartSidebarStore() {
      return defineStore({
        init: () => ({
          pinnedSessionIds: [] // 用户主动置顶且仍可见的会话 ID，按操作顺序持久化。
        }),
        persist: 'adminsmart.sidebar.view.v1',
        actions: {
          /** Toggle one Session's pinned membership. */
          togglePinned: (draft, sessionId) => {
            const normalizedId = String(sessionId) // Harness Session ID 的可持久化字符串形式。
            const existingIndex = draft.pinnedSessionIds.indexOf(normalizedId) // 当前置顶位置；-1 表示尚未置顶。
            if (existingIndex >= 0) draft.pinnedSessionIds.splice(existingIndex, 1)
            else draft.pinnedSessionIds.unshift(normalizedId)
          },
          /** Ensure every selected Session is pinned without unpinning existing members. */
          pinMany: (draft, sessionIds) => {
            const requestedIds = sessionIds.map(String) // Bulk-selected Session identities in visible list order.
            const existingIds = new Set(draft.pinnedSessionIds.map(String)) // Current persistent membership used to avoid duplicates.
            const newIds = requestedIds.filter(sessionId => !existingIds.has(sessionId)) // Selected Sessions not already pinned.
            draft.pinnedSessionIds = [...newIds, ...draft.pinnedSessionIds]
          },
          /** Remove pins whose Sessions are no longer visible to this Runtime. */
          retainPinned: (draft, visibleSessionIds) => {
            const visibleIds = new Set(visibleSessionIds.map(String)) // 当前用户未归档普通会话的权限内集合。
            draft.pinnedSessionIds = draft.pinnedSessionIds.filter(sessionId => visibleIds.has(sessionId))
          }
        }
      })
    }

    const HISTORY_GROUPS = [
      { id: 'today', label: '今天' }, // Sessions updated within the most recent 24 hours.
      { id: 'week', label: '7 天内' }, // Sessions updated after the first day and within seven days.
      { id: 'month', label: '30 天内' }, // Sessions updated after seven days and within thirty days.
      { id: 'older', label: '更早' } // Remaining durable history.
    ] // Stable display order follows the original DeepSeek conversation sidebar.

    /** Resolve one Session update timestamp into the reference sidebar's recency bucket. */
    function historyGroupId(updatedAt, currentTime) {
      const elapsed = Math.max(0, currentTime - Number(updatedAt || 0)) // Future or invalid timestamps fall into the newest safe bucket.
      const elapsedDays = elapsed / (24 * 60 * 60 * 1000) // Fractional age in local browser days for coarse UI grouping.
      if (elapsedDays < 1) return 'today'
      if (elapsedDays < 7) return 'week'
      if (elapsedDays < 30) return 'month'
      return 'older'
    }

    /** Resolve the stable user-facing title for one Session summary. */
    function historyTitle(summary) {
      return summary.blank ? '新会话' : String(summary.displayTitle || '未命名会话')
    }

    /** Format one Session update timestamp like the DeepSeek search-result date label. */
    function historySearchDate(updatedAt) {
      const timestamp = Number(updatedAt || 0) // Harness durable activity timestamp in Unix milliseconds.
      const date = new Date(timestamp) // Local calendar date shown beside the Session title.
      if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return ''
      const currentDate = new Date() // Browser-local current date determines relative and absolute labels.
      const currentDayStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate()
      ) // Local midnight on September 1, 2026 or the applicable runtime date.
      const resultDayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      ) // Local midnight for the Session's latest durable activity.
      const elapsedCalendarDays = Math.round(
        (currentDayStart.getTime() - resultDayStart.getTime()) / (24 * 60 * 60 * 1000)
      ) // Calendar-day distance used by DeepSeek's today/yesterday labels.
      if (elapsedCalendarDays === 0) {
        const hours = String(date.getHours()).padStart(2, '0') // Today result's local hour.
        const minutes = String(date.getMinutes()).padStart(2, '0') // Today result's local minute.
        return `${hours}:${minutes}`
      }
      if (elapsedCalendarDays === 1) return '昨天'
      const monthAndDay = `${date.getMonth() + 1}月${date.getDate()}日` // Current-year compact date label.
      return date.getFullYear() === currentDate.getFullYear()
        ? monthAndDay
        : `${date.getFullYear()}年${monthAndDay}`
    }

    /** Normalize rendered or indexed message text for tolerant click-to-locate comparison. */
    function comparableSearchText(value) {
      return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/[…*_`#>|[\](){}]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase()
    }

    /** Build longest-first unique location terms from the Harness snippet and the user's query. */
    function searchLocationTerms(snippet, query) {
      const normalizedTerms = [snippet, query]
        .map(comparableSearchText)
        .filter(term => term.length >= 2) // Single-character searches cannot reliably identify one rendered message.
      return [...new Set(normalizedTerms)].sort((left, right) => right.length - left.length)
    }

    /** Find the smallest official chat row whose rendered text contains one indexed search term. */
    function findRenderedSearchMatch(seq, terms) {
      const visibleRows = [...document.querySelectorAll('[data-chat-anchor-key]:not([hidden])')] // Official stable chat-row anchors currently rendered in the conversation window.
      const seqText = Number.isFinite(seq) ? String(seq) : '' // Exact provider coordinate used when an official key exposes it.
      if (seqText) {
        const exactRow = visibleRows.find(row => {
          const anchorKey = String(row.getAttribute('data-chat-anchor-key') ?? '') // Official row identity supplied by ui-chat.
          return anchorKey === seqText || anchorKey.endsWith(`:${seqText}`)
        })
        if (exactRow) return exactRow
      }
      for (const term of terms) {
        const matchingRow = visibleRows.find(row => comparableSearchText(row.textContent).includes(term)) // Snippet comparison remains inside visible conversation rows.
        if (matchingRow) return matchingRow
      }
      return null
    }

    /** Publish the current search-dialog rectangle to the same-origin Vue Teleport host. */
    function publishSearchOverlay(open, dialogElement) {
      if (window.parent === window) return
      const rectangle = open && dialogElement
        ? dialogElement.getBoundingClientRect()
        : null // iframe viewport coordinates contain no query, Session, user, or knowledge data.
      window.parent.postMessage({
        type: SEARCH_OVERLAY_MESSAGE_TYPE, // Stable bridge command understood by AgentMicroAppHost.vue.
        open: Boolean(open && rectangle), // false removes every teleported pane immediately.
        rect: rectangle
          ? {
              left: rectangle.left, // Dialog left edge within the Harness iframe viewport.
              top: rectangle.top, // Dialog top edge within the Harness iframe viewport.
              width: rectangle.width, // Dialog width reserved as the clear Teleport window.
              height: rectangle.height // Dialog height reserved as the clear Teleport window.
            }
          : null
      }, window.location.origin)
    }

    /**
     * Render one DeepSeek-style Session history row and its official overflow menu.
     *
     * @param {object} props Row behavior and current view state.
     * @param {object} props.summary Harness Session list summary.
     * @param {boolean} props.selected Whether this Session is currently open.
     * @param {boolean} props.pinned Whether this Session belongs to the pinned group.
     * @param {boolean} props.multiSelect Whether rows currently toggle bulk selection.
     * @param {boolean} props.checked Whether this row is selected for a bulk action.
     * @param {(sessionId:string) => void} props.openSession Open one Session through Harness navigation.
     * @param {(sessionId:string) => void} props.toggleSelected Toggle one bulk-selection membership.
     * @param {(sessionId:string,title:string) => void} props.requestRename Open the rename dialog.
     * @param {(sessionId:string) => void} props.togglePinned Toggle the persisted pin.
     * @param {(sessionId:string) => void} props.beginMultiSelect Enter bulk mode with this row selected.
     * @param {(sessionIds:string[],title:string) => void} props.requestDelete Open reversible deletion confirmation.
     * @returns {object} React element tree for one Session row.
     */
    function AdminSmartHistoryRow({
      summary,
      selected,
      pinned,
      multiSelect,
      checked,
      openSession,
      toggleSelected,
      requestRename,
      togglePinned,
      beginMultiSelect,
      requestDelete
    }) {
      const [menuOpen, setMenuOpen] = useState(false) // Row-local overflow menu visibility.
      const title = historyTitle(summary) // Visible history title mirrors official fallback semantics.
      const menuItems = [
        {
          id: 'rename', // Stable rename command identity.
          label: '重命名', // Visible operation label.
          icon: jsx(IconEditOutline16, { size: 14, 'aria-hidden': 'true' }) // Official edit glyph.
        },
        {
          id: 'pin', // Stable pin command identity.
          label: pinned ? '取消置顶' : '置顶', // Action changes with current membership.
          icon: jsx(AdminSmartPinIcon, { size: 14 }) // Lucide Pin keeps the menu icon family consistent with other outline actions.
        },
        {
          id: 'multi-select', // Stable bulk-selection command identity.
          label: '多选', // Opens the sidebar-wide selection mode.
          icon: jsx(IconChecklistOutline14, { size: 14, 'aria-hidden': 'true' }) // Official checklist glyph.
        },
        {
          id: 'delete', // Stable delete command identity.
          label: '删除', // User-facing reversible removal action.
          icon: jsx(IconTrashOutline16, { size: 14, 'aria-hidden': 'true' }), // Official Harness trash glyph.
          danger: true // Menu applies its built-in danger treatment.
        }
      ]
      return jsxs('div', {
        role: 'treeitem',
        className: 'adminsmart-history__row',
        'aria-selected': selected,
        'data-checked': checked ? 'true' : 'false',
        'data-multi-select': multiSelect ? 'true' : 'false',
        children: [
          multiSelect
            ? jsx('button', {
                type: 'button',
                className: 'adminsmart-history__check',
                'aria-label': checked ? `取消选择：${title}` : `选择：${title}`,
                'aria-pressed': checked,
                onClick: () => { toggleSelected(summary.id) },
                children: checked ? jsx(IconCheckOutline16, { size: 13, 'aria-hidden': 'true' }) : null
              })
            : null,
          jsx('button', {
            type: 'button',
            className: 'adminsmart-history__open',
            title,
            onClick: () => {
              if (multiSelect) toggleSelected(summary.id)
              else openSession(summary.id)
            },
            children: jsx('span', { className: 'adminsmart-history__title', children: title })
          }),
          multiSelect
            ? null
            : jsx(Menu, {
                open: menuOpen,
                onClose: () => { setMenuOpen(false) },
                items: menuItems,
                onSelect: (id) => {
                  setMenuOpen(false)
                  if (id === 'rename') requestRename(summary.id, title)
                  if (id === 'pin') togglePinned(summary.id)
                  if (id === 'multi-select') beginMultiSelect(summary.id)
                  if (id === 'delete') requestDelete([String(summary.id)], title)
                },
                portal: true,
                closeOnPointerLeave: true,
                anchor: jsx('button', {
                  type: 'button',
                  className: 'adminsmart-history__menu-button',
                  'aria-label': `会话操作：${title}`,
                  'aria-expanded': menuOpen,
                  title: '会话操作',
                  onClick: event => {
                    event.stopPropagation()
                    setMenuOpen(value => !value)
                  },
                  children: jsx(IconEllipsisOutline16, { size: 16, 'aria-hidden': 'true' })
                })
              })
        ]
      })
    }

    /**
     * Render the full AdminSmart sidebar through the official root `sidebar` Slot.
     *
     * @param {object} props Harness owner, standard hook, Store, and injected service props.
     * @param {boolean} props.collapsed Whether the layout is currently displaying the compact rail.
     * @param {number} props.width Current layout-owned sidebar width in CSS pixels.
     * @param {Function} props.useSessions Selector hook over the Harness Session list.
     * @param {Function} props.useWorkspaces Selector hook over the Workspace archive projection.
     * @param {Function} props.useStore Selector hook over the AdminSmart sidebar Store.
     * @param {object} props.actions Bound Store actions for persisted pin membership.
     * @param {() => void} props.startSession Start or reuse the fixed Workspace's blank Session.
     * @param {() => void} props.toggleSidebar Toggle the layout-owned sidebar rail.
     * @param {(sessionId:string) => void} props.openSession Open one listed Session.
     * @param {(query:string,signal:AbortSignal) => Promise<object>} props.searchSessions Search Harness's visible message-content index.
     * @param {(sessionId:string) => Promise<boolean>} props.loadOlderSession Load one older history page when search navigation needs it.
     * @param {(sessionId:string,title:string) => Promise<void>} props.renameSession Rename one Session through its public face.
     * @param {(sessionId:string) => Promise<void>} props.archiveSession Remove one Session from ordinary history through Workspace UI semantics.
     * @returns {object} React element tree for the expanded sidebar, collapsed rail, dialogs, and search overlay.
     */
    function AdminSmartSidebar({
      collapsed,
      width,
      useSessions,
      useWorkspaces,
      useStore,
      actions,
      startSession,
      toggleSidebar,
      openSession,
      searchSessions,
      loadOlderSession,
      renameSession,
      archiveSession
    }) {
      const [searchOpen, setSearchOpen] = useState(false) // Full-viewport conversation search overlay visibility.
      const [searchQuery, setSearchQuery] = useState('') // User-entered title and content search phrase.
      const [remoteSearch, setRemoteSearch] = useState({
        query: '', // Query associated with the current remote result page.
        status: 'idle', // idle、loading、ready 或 error。
        items: [], // Harness message-content hits for the current query.
        hasMore: false // Whether the bounded Harness result page omitted more hits.
      })
      const searchInputRef = useRef(null) // Search overlay input receives focus when the modal opens.
      const searchDialogRef = useRef(null) // Modal focus containment is limited to the search surface.
      const searchTriggerRef = useRef(null) // Closing search restores focus to the currently rendered toolbar trigger.
      const [pendingSearchJump, setPendingSearchJump] = useState(null) // Search result awaiting Session open, older-history loading, scroll, and temporary highlight.
      const [multiSelect, setMultiSelect] = useState(false) // Sidebar-wide bulk selection mode; intentionally not persisted across reloads.
      const [selectedSessionIds, setSelectedSessionIds] = useState([]) // Session IDs selected for the next bulk delete action.
      const [renameTarget, setRenameTarget] = useState(null) // Session identity and current title shown by the rename dialog.
      const [renameDraft, setRenameDraft] = useState('') // Editable title value isolated from the durable Session until confirmation.
      const [renaming, setRenaming] = useState(false) // Rename request duplicate-submit lock.
      const [renameError, setRenameError] = useState('') // Safe rename failure shown beside the field.
      const renameInputRef = useRef(null) // Rename dialog input receives focus after the target is selected.
      const [deleteTarget, setDeleteTarget] = useState(null) // One or more Session IDs awaiting reversible archive confirmation.
      const [deleting, setDeleting] = useState(false) // Delete confirmation duplicate-submit lock.
      const [deleteError, setDeleteError] = useState('') // Partial or total archive failure shown inside the confirmation dialog.
      const sessionState = useSessions(state => state) // Authoritative Session list and current selection from Harness.
      const workspaceState = useWorkspaces(state => state) // Archive membership remains a Workspace service concern even when grouping is hidden.
      const pinnedSessionIds = useStore(state => state.pinnedSessionIds) // Persisted user-controlled pinned Session order.
      const historyRows = useMemo(() => {
        const archivedIds = new Set((workspaceState.archivedSessionIds ?? []).map(String)) // Archived Sessions stay outside the ordinary history list.
        return sessionState.ids
          .map(sessionId => sessionState.byId[sessionId])
          .filter(summary => summary !== undefined)
          .filter(summary => summary.origin !== 'subagent')
          .filter(summary => !archivedIds.has(String(summary.id)))
          .filter(summary => !summary.blank || summary.id === sessionState.current)
          .sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))
      }, [sessionState, workspaceState.archivedSessionIds])
      const visibleSessionIds = useMemo(
        () => historyRows.map(summary => String(summary.id)),
        [historyRows]
      ) // Stable array used to prune persisted pins and transient selections.
      const visibleSessionIdSet = useMemo(
        () => new Set(visibleSessionIds),
        [visibleSessionIds]
      ) // Membership map for result filtering and stale selection cleanup.
      const pinnedIdSet = useMemo(
        () => new Set(pinnedSessionIds.map(String)),
        [pinnedSessionIds]
      ) // Render-local pin membership map shared by grouping and search ordering.
      const selectedSessionIdSet = useMemo(
        () => new Set(selectedSessionIds.map(String)),
        [selectedSessionIds]
      ) // Render-local bulk-selection membership map.
      const historyGroups = useMemo(() => {
        const currentTime = Date.now() // One render-local reference prevents rows near a boundary from entering inconsistent groups.
        const groupedRows = [] // Ordered pinned and recency sections rendered without a visible “历史记录” heading.
        const pinnedRows = historyRows.filter(summary => pinnedIdSet.has(String(summary.id))) // Current visible pinned Sessions.
        if (pinnedRows.length > 0) {
          groupedRows.push({
            id: 'pinned', // Stable pinned group identity.
            label: '置顶', // User-facing pinned section label.
            rows: pinnedRows // Visible pinned Session summaries.
          })
        }
        for (const group of HISTORY_GROUPS) {
          const rows = historyRows.filter(summary => (
            !pinnedIdSet.has(String(summary.id))
            && historyGroupId(summary.updatedAt, currentTime) === group.id
          )) // Unpinned Sessions in this recency bucket.
          if (rows.length === 0) continue
          groupedRows.push({
            id: group.id, // Stable recency group identity.
            label: group.label, // User-facing recency label.
            rows // Recency-filtered Session summaries.
          })
        }
        return groupedRows
      }, [historyRows, pinnedIdSet])
      const normalizedSearchQuery = searchQuery
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .trim()
        .slice(0, HISTORY_SEARCH_MAX_LENGTH) // Bounded literal phrase passed to local title matching and Harness content search.
      const searchResults = useMemo(() => {
        if (normalizedSearchQuery === '') return []
        const normalizedQuery = normalizedSearchQuery.toLocaleLowerCase() // Case-insensitive local title matcher.
        const contentResults = [] // Harness relevance-ordered message-content hits.
        const contentSessionIds = new Set() // Sessions already represented by a stronger content hit.
        if (remoteSearch.query === normalizedSearchQuery) {
          for (const item of remoteSearch.items) {
            const sessionId = String(item?.sessionId ?? '') // Harness content-hit Session identity.
            const summary = sessionState.byId[sessionId] // Current visible metadata remains the authorization boundary for rendering.
            if (!visibleSessionIdSet.has(sessionId) || summary === undefined) continue
            contentSessionIds.add(sessionId)
            contentResults.push({
              key: String(item?.key || `content:${sessionId}`), // Host-provided match identity includes the event sequence.
              summary, // Current Session metadata replaces any stale search projection.
              seq: Number(item?.seq), // Exact matching Session event sequence from Harness SessionQuery.
              time: Number(item?.time), // Exact matching event time drives today/yesterday labels.
              snippet: String(item?.snippet ?? '') // Host-provided escaped message excerpt displayed as ordinary React text.
            })
          }
        }
        const titleResults = historyRows
          .filter(summary => !contentSessionIds.has(String(summary.id)))
          .filter(summary => historyTitle(summary).toLocaleLowerCase().includes(normalizedQuery))
          .map(summary => ({
            key: `title:${String(summary.id)}`, // Title-only result identity.
            summary, // Authoritative Session metadata used for title and navigation.
            seq: Number.NaN, // Title-only matches have no message event coordinate.
            time: Number(summary.updatedAt || 0), // Session activity time provides the title-only row label.
            snippet: '' // Title-only matches do not manufacture a message excerpt.
          }))
        return [...contentResults, ...titleResults] // Official relevance first, then unmatched local titles by sidebar recency.
      }, [historyRows, normalizedSearchQuery, remoteSearch, sessionState.byId, visibleSessionIdSet])
      const renameDraftTrimmed = renameDraft.trim() // Host-normalized candidate title without surrounding whitespace.
      const renderedSidebarWidth = Math.max(56, Number(width) || 56) // Layout-owned frame width, including the compact rail state.
      const visualSidebarTail = collapsed
        ? 0
        : Math.max(0, renderedSidebarWidth - DEEPSEEK_REFERENCE_SIDEBAR_WIDTH) // Official Layout keeps its track; a page-colored tail preserves the measured 261px visual column without patching upstream geometry.
      const sidebarStyle = {
        width: `${renderedSidebarWidth}px`, // Custom root remains aligned with the official AppFrame track.
        '--adminsmart-sidebar-visual-tail': `${visualSidebarTail}px` // Tail visually belongs to the conversation surface, leaving DeepSeek-sized sidebar content.
      }

      useEffect(() => {
        actions.retainPinned(visibleSessionIds)
      }, [actions.retainPinned, visibleSessionIds])

      useEffect(() => {
        setSelectedSessionIds(currentIds => {
          const retainedIds = currentIds.filter(sessionId => visibleSessionIdSet.has(String(sessionId))) // Bulk selection cannot retain archived or removed Sessions.
          return retainedIds.length === currentIds.length ? currentIds : retainedIds
        })
      }, [visibleSessionIdSet])

      useEffect(() => {
        if (!searchOpen) return undefined
        /** Publish the latest dialog rectangle after mount, result expansion, and viewport changes. */
        const publishGeometry = () => {
          publishSearchOverlay(true, searchDialogRef.current)
        }
        queueMicrotask(() => {
          searchInputRef.current?.focus()
          publishGeometry()
        })
        /** Close on Escape and keep Tab focus inside the active modal surface. */
        const containSearchFocus = (event) => {
          if (event.key === 'Escape') {
            closeSearch()
            return
          }
          if (event.key !== 'Tab') return
          const focusableElements = Array.from(searchDialogRef.current?.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
          ) ?? []) // Keyboard-reachable controls in document order.
          if (focusableElements.length === 0) return
          const firstElement = focusableElements[0] // First focus stop for reverse wrapping.
          const lastElement = focusableElements[focusableElements.length - 1] // Last focus stop for forward wrapping.
          if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault()
            lastElement.focus()
          } else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault()
            firstElement.focus()
          }
        }
        /** Accept only the same-origin Vue Teleport host's close request. */
        const closeFromTeleportHost = (event) => {
          if (
            event.source === window.parent
            && event.origin === window.location.origin
            && event.data?.type === SEARCH_OVERLAY_CLOSE_MESSAGE_TYPE
          ) closeSearch()
        }
        const resizeObserver = typeof ResizeObserver === 'function'
          ? new ResizeObserver(publishGeometry)
          : null // Search result expansion is observed without polling when supported.
        if (resizeObserver && searchDialogRef.current) resizeObserver.observe(searchDialogRef.current)
        document.addEventListener('keydown', containSearchFocus)
        window.addEventListener('message', closeFromTeleportHost)
        window.addEventListener('resize', publishGeometry)
        return () => {
          resizeObserver?.disconnect()
          document.removeEventListener('keydown', containSearchFocus)
          window.removeEventListener('message', closeFromTeleportHost)
          window.removeEventListener('resize', publishGeometry)
          publishSearchOverlay(false, null)
        }
      }, [searchOpen])

      useEffect(() => {
        if (!searchOpen || normalizedSearchQuery === '') {
          setRemoteSearch({
            query: '', // No active query.
            status: 'idle', // No network request is in flight.
            items: [], // Empty content-hit page.
            hasMore: false // Empty result pages cannot be truncated.
          })
          return undefined
        }
        const controller = new AbortController() // Query replacement or modal close cancels the superseded content search.
        setRemoteSearch({
          query: normalizedSearchQuery, // Query associated with this pending request.
          status: 'loading', // Search progress displayed without blocking local title hits.
          items: [], // Stale content hits never remain visible under a new phrase.
          hasMore: false // Unknown until the bounded response arrives.
        })
        const timer = window.setTimeout(() => {
          searchSessions(normalizedSearchQuery, controller.signal).then(result => {
            if (controller.signal.aborted) return
            setRemoteSearch({
              query: normalizedSearchQuery, // Query proven current at settlement time.
              status: 'ready', // Harness content index completed successfully.
              items: Array.isArray(result?.items) ? result.items : [], // Bounded content-hit rows.
              hasMore: Boolean(result?.hasMore) // Host-declared truncation state.
            })
          }).catch(() => {
            if (controller.signal.aborted) return
            setRemoteSearch({
              query: normalizedSearchQuery, // Failed query retained for accurate feedback.
              status: 'error', // Safe generic failure; transport details stay outside the user UI.
              items: [], // Failed searches contribute no content hits.
              hasMore: false // A failed page cannot claim additional results.
            })
          })
        }, HISTORY_SEARCH_DEBOUNCE_MS) // Debounce keeps typing responsive and limits SQLite index work.
        return () => {
          window.clearTimeout(timer)
          controller.abort()
        }
      }, [normalizedSearchQuery, searchOpen, searchSessions])

      useEffect(() => {
        if (
          pendingSearchJump === null
          || String(sessionState.current ?? '') !== pendingSearchJump.sessionId
        ) return undefined
        let cancelled = false // Session switch or a newer search result cancels the current locate loop.
        /** Wait for the official Session window and React chat rows to settle without blocking input. */
        const waitForRender = delay => new Promise(resolveWait => {
          window.setTimeout(resolveWait, delay)
        })
        /** Locate the indexed row, loading older official history pages only when needed. */
        const locateMatch = async () => {
          for (let attempt = 0; attempt < 10 && !cancelled; attempt += 1) {
            await waitForRender(attempt === 0 ? 80 : 160)
            if (cancelled) return
            const matchingRow = findRenderedSearchMatch(pendingSearchJump.seq, pendingSearchJump.terms) // Current rendered row for the exact seq or indexed snippet.
            if (matchingRow) {
              const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true // Operator motion preference controls scroll animation.
              matchingRow.setAttribute('data-adminsmart-search-hit', 'true')
              matchingRow.scrollIntoView({
                behavior: reduceMotion ? 'auto' : 'smooth',
                block: 'center'
              })
              window.setTimeout(() => {
                matchingRow.removeAttribute('data-adminsmart-search-hit')
              }, 2600) // Temporary context highlight disappears without mutating Session data.
              setPendingSearchJump(null)
              return
            }
            let loadedOlder = false // Whether this attempt requested another durable history page.
            try {
              loadedOlder = await loadOlderSession(pendingSearchJump.sessionId)
            } catch {
              loadedOlder = false
            }
            if (!loadedOlder && attempt >= 3) break
          }
          if (!cancelled) setPendingSearchJump(null)
        }
        void locateMatch()
        return () => { cancelled = true }
      }, [loadOlderSession, pendingSearchJump, sessionState.current])

      useEffect(() => {
        if (renameTarget === null) return
        queueMicrotask(() => {
          renameInputRef.current?.focus()
          renameInputRef.current?.select()
        })
      }, [renameTarget])

      /** Open the search overlay without changing the current Session. */
      function openSearch() {
        setSearchOpen(true)
      }

      /** Close search, clear its phrase, and restore focus to the toolbar trigger. */
      function closeSearch() {
        setSearchOpen(false)
        setSearchQuery('')
        queueMicrotask(() => { searchTriggerRef.current?.focus() })
      }

      /** Open one search result and locate the indexed message after the Session renders. */
      function openSearchResult(result) {
        const sessionId = String(result.summary.id) // Search result's authorized Session identity.
        const terms = searchLocationTerms(result.snippet, normalizedSearchQuery) // Longest-first rendered-text locator terms.
        setPendingSearchJump(terms.length === 0
          ? null
          : {
              sessionId, // Session that must become current before locating.
              seq: Number(result.seq), // Exact Harness event sequence when the row exposes it.
              terms // Indexed snippet and literal query fallback.
            })
        openSession(result.summary.id)
        closeSearch()
      }

      /** Start a new conversation and leave any transient bulk-selection state behind. */
      function startNewSession() {
        cancelMultiSelect()
        startSession()
      }

      /** Start bulk selection with the row that invoked the command. */
      function beginMultiSelect(sessionId) {
        setMultiSelect(true)
        setSelectedSessionIds(sessionId === undefined ? [] : [String(sessionId)])
      }

      /** Leave bulk-selection mode and discard its transient membership. */
      function cancelMultiSelect() {
        setMultiSelect(false)
        setSelectedSessionIds([])
      }

      /** Toggle one visible Session in the transient bulk-selection set. */
      function toggleSelectedSession(sessionId) {
        const normalizedId = String(sessionId) // Stable Session identity used by the selection set.
        setSelectedSessionIds(currentIds => (
          currentIds.includes(normalizedId)
            ? currentIds.filter(currentId => currentId !== normalizedId)
            : [...currentIds, normalizedId]
        ))
      }

      /** Pin every selected Session through the persisted Harness viewing Store. */
      function pinSelectedSessions() {
        if (selectedSessionIds.length === 0) return
        actions.pinMany(selectedSessionIds)
        cancelMultiSelect()
      }

      /** Open the rename dialog for one Session with its current visible title. */
      function requestRename(sessionId, currentTitle) {
        setRenameError('')
        setRenameDraft(currentTitle)
        setRenameTarget({
          sessionId: String(sessionId), // Session to mutate through its public Session face.
          currentTitle // Current visible title used for unchanged-value validation.
        })
      }

      /** Close the rename dialog unless a request is active. */
      function closeRenameDialog() {
        if (renaming) return
        setRenameTarget(null)
        setRenameError('')
      }

      /** Persist one validated Session title through the Harness Session API. */
      async function confirmRenameSession() {
        if (
          renaming
          || renameTarget === null
          || renameDraftTrimmed === ''
          || renameDraftTrimmed === renameTarget.currentTitle
        ) return
        setRenaming(true)
        setRenameError('')
        try {
          await renameSession(renameTarget.sessionId, renameDraftTrimmed)
          setRenameTarget(null)
        } catch (reason) {
          setRenameError(String(reason?.message || '会话重命名失败'))
        } finally {
          setRenaming(false)
        }
      }

      /** Open reversible deletion confirmation for one or more visible Sessions. */
      function requestDelete(sessionIds, title) {
        const visibleTargets = sessionIds.map(String).filter(sessionId => visibleSessionIdSet.has(sessionId)) // Only current visible Sessions can enter the confirmation.
        if (visibleTargets.length === 0) return
        setDeleteError('')
        setDeleteTarget({
          sessionIds: visibleTargets, // Session identities to archive through official Workspace UI semantics.
          title // Single title or bulk summary displayed in the modal.
        })
      }

      /** Close the deletion confirmation unless requests are still settling. */
      function closeDeleteDialog() {
        if (deleting) return
        setDeleteTarget(null)
        setDeleteError('')
      }

      /** Archive every confirmed Session and retain only failed rows for an accurate retry. */
      async function confirmDeleteSessions() {
        if (deleting || deleteTarget === null) return
        setDeleting(true)
        setDeleteError('')
        try {
          const results = await Promise.allSettled(
            deleteTarget.sessionIds.map(sessionId => Promise.resolve().then(() => archiveSession(sessionId)))
          ) // Every selected Session settles so partial success is known precisely.
          const failedSessionIds = deleteTarget.sessionIds.filter((sessionId, index) => (
            results[index]?.status === 'rejected'
          )) // IDs whose archive request failed and remain eligible for retry.
          if (failedSessionIds.length > 0) {
            setSelectedSessionIds(failedSessionIds)
            setDeleteTarget({
              sessionIds: failedSessionIds, // Retry target excludes Sessions already removed successfully.
              title: `${failedSessionIds.length} 个会话` // Updated summary matches the remaining target count.
            })
            setDeleteError(`${failedSessionIds.length} 个会话删除失败，请重试`)
            return
          }
          setDeleteTarget(null)
          cancelMultiSelect()
        } finally {
          setDeleting(false)
        }
      }

      return jsxs('aside', {
        className: `adminsmart-sidebar${collapsed ? ' adminsmart-sidebar--collapsed' : ''}`,
        style: sidebarStyle,
        'aria-label': 'AuraSearch 会话导航',
        'data-adminsmart-sidebar': 'true',
        children: [
          collapsed
            ? jsx('button', {
                type: 'button',
                className: 'adminsmart-sidebar__rail-button',
                'aria-label': '展开侧栏',
                title: '展开侧栏',
                onClick: toggleSidebar,
                children: jsx(AdminSmartMark, { size: 24 })
              })
            : jsxs('div', {
                className: 'adminsmart-sidebar__header',
                children: [
                  jsxs('button', {
                    type: 'button',
                    className: 'adminsmart-sidebar__brand',
                    'aria-label': '开启新对话',
                    title: '开启新对话',
                    onClick: startNewSession,
                    children: [
                      jsx(AdminSmartMark, { size: 24 }),
                      jsx('span', {
                        className: 'adminsmart-sidebar__brand-name',
                        children: jsx(AdminSmartName, {})
                      })
                    ]
                  }),
                  jsx('button', {
                    ref: searchTriggerRef,
                    type: 'button',
                    className: 'adminsmart-sidebar__icon-button',
                    'aria-label': '搜索会话',
                    title: '搜索会话',
                    onClick: openSearch,
                    children: jsx(IconSearchOutline16, { size: 17, 'aria-hidden': 'true' })
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'adminsmart-sidebar__icon-button',
                    'aria-label': '收起侧栏',
                    title: '收起侧栏',
                    onClick: toggleSidebar,
                    children: jsx(IconPanelLeftOutline16, { size: 17, 'aria-hidden': 'true' })
                  })
                ]
              }),
          collapsed
            ? jsx('button', {
                type: 'button',
                className: 'adminsmart-sidebar__rail-button',
                'aria-label': '开启新对话',
                title: '开启新对话',
                onClick: startNewSession,
                children: jsx(IconNewChatOutline16, { size: 18, 'aria-hidden': 'true' })
              })
            : multiSelect
              ? jsxs('div', {
                  className: 'adminsmart-sidebar__bulk-header',
                  children: [
                    jsx('span', {
                      className: 'adminsmart-sidebar__bulk-title',
                      children: selectedSessionIds.length === 0
                        ? '选择对话'
                        : `已选择 ${selectedSessionIds.length} 个对话`
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'adminsmart-sidebar__bulk-close',
                      'aria-label': '退出批量选择',
                      title: '退出批量选择',
                      onClick: cancelMultiSelect,
                      children: jsx(IconCloseOutline16, { size: 16, 'aria-hidden': 'true' })
                    })
                  ]
                })
              : jsxs('button', {
                  type: 'button',
                  className: 'adminsmart-sidebar__new-session',
                  onClick: startNewSession,
                  children: [
                    jsx(IconNewChatOutline16, { size: 17, 'aria-hidden': 'true' }),
                    jsx('span', { children: '开启新对话' })
                  ]
                }),
          collapsed
            ? jsx('button', {
                ref: searchTriggerRef,
                type: 'button',
                className: 'adminsmart-sidebar__rail-button',
                'aria-label': '搜索会话',
                title: '搜索会话',
                onClick: openSearch,
                children: jsx(IconSearchOutline16, { size: 18, 'aria-hidden': 'true' })
              })
            : null,
          !collapsed
            ? jsx('section', {
                className: 'adminsmart-history',
                'aria-label': '会话记录',
                'data-adminsmart-history': 'true',
                children: historyRows.length === 0
                  ? jsx('div', {
                      className: 'adminsmart-history__empty',
                      children: sessionState.phase === 'pending' ? '正在加载会话…' : '暂无会话'
                    })
                  : jsx('div', {
                      className: 'adminsmart-history__list',
                      role: 'tree',
                      'aria-label': '会话列表',
                      'aria-multiselectable': multiSelect,
                      children: historyGroups.map((group, groupIndex) => jsxs('section', {
                        className: 'adminsmart-history__group',
                        role: 'group',
                        'aria-label': group.label,
                        children: [
                          jsxs('div', {
                            className: 'adminsmart-history__group-title',
                            children: [
                              jsx('span', { children: group.label }),
                              groupIndex === 0 && !multiSelect
                                ? jsx('button', {
                                    type: 'button',
                                    className: 'adminsmart-sidebar__bulk-trigger',
                                    'aria-label': '批量选择会话',
                                    title: '批量选择会话',
                                    onClick: () => { beginMultiSelect() },
                                    children: jsx(IconChecklistOutline14, { size: 14, 'aria-hidden': 'true' })
                                  })
                                : null
                            ]
                          }),
                          ...group.rows.map(summary => jsx(AdminSmartHistoryRow, {
                            summary,
                            selected: summary.id === sessionState.current,
                            pinned: pinnedIdSet.has(String(summary.id)),
                            multiSelect,
                            checked: selectedSessionIdSet.has(String(summary.id)),
                            openSession,
                            toggleSelected: toggleSelectedSession,
                            requestRename,
                            togglePinned: actions.togglePinned,
                            beginMultiSelect,
                            requestDelete
                          }, String(summary.id)))
                        ]
                      }, group.id))
                    })
              })
            : null,
          !collapsed && multiSelect
            ? jsxs('div', {
                className: 'adminsmart-sidebar__bulk-actions',
                children: [
                  jsxs('button', {
                    type: 'button',
                    className: 'adminsmart-sidebar__bulk-action',
                    disabled: selectedSessionIds.length === 0,
                    onClick: pinSelectedSessions,
                    children: [
                      jsx(AdminSmartPinIcon, { size: 17 }),
                      jsx('span', { children: '置顶' })
                    ]
                  }),
                  jsxs('button', {
                    type: 'button',
                    className: 'adminsmart-sidebar__bulk-action adminsmart-sidebar__bulk-action--danger',
                    disabled: selectedSessionIds.length === 0,
                    onClick: () => { requestDelete(selectedSessionIds, `${selectedSessionIds.length} 个会话`) },
                    children: [
                      jsx(IconTrashOutline16, { size: 17, 'aria-hidden': 'true' }),
                      jsx('span', { children: '删除' })
                    ]
                  })
                ]
              })
            : null,
          searchOpen
            ? jsx('div', {
                className: 'adminsmart-search',
                'data-external-overlay': window.parent === window ? 'false' : 'true',
                role: 'presentation',
                onMouseDown: event => {
                  if (event.target === event.currentTarget) closeSearch()
                },
                children: jsxs('section', {
                  ref: searchDialogRef,
                  className: 'adminsmart-search__dialog',
                  'data-expanded': normalizedSearchQuery === '' ? 'false' : 'true',
                  role: 'dialog',
                  'aria-modal': 'true',
                  'aria-label': '搜索会话',
                  children: [
                    jsxs('div', {
                      className: 'adminsmart-search__field-row',
                      role: 'search',
                      children: [
                        jsx(IconSearchOutline16, {
                          className: 'adminsmart-search__field-icon',
                          size: 18,
                          'aria-hidden': 'true'
                        }),
                        jsx('input', {
                          ref: searchInputRef,
                          type: 'text',
                          className: 'adminsmart-search__input',
                          value: searchQuery,
                          maxLength: HISTORY_SEARCH_MAX_LENGTH,
                          placeholder: '搜索对话内容...',
                          'aria-label': '搜索对话内容',
                          onChange: event => { setSearchQuery(String(event.target.value ?? '')) }
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'adminsmart-search__close',
                          'aria-label': '关闭搜索',
                          title: '关闭',
                          onClick: closeSearch,
                          children: jsx(IconCloseOutline16, { size: 16, 'aria-hidden': 'true' })
                        })
                      ]
                    }),
                    normalizedSearchQuery === ''
                      ? null
                      : jsx('div', {
                          className: 'adminsmart-search__body',
                          children: searchResults.length === 0
                          ? jsx('div', {
                              className: 'adminsmart-search__status',
                              'data-level': remoteSearch.status === 'error' ? 'error' : 'info',
                              role: remoteSearch.status === 'error' ? 'alert' : 'status',
                              children: remoteSearch.status === 'loading'
                                ? '正在搜索…'
                                : remoteSearch.status === 'error'
                                  ? '会话内容搜索暂时不可用，请稍后重试'
                                  : '没有匹配的会话，请换一个关键词'
                            })
                          : jsxs('div', {
                              className: 'adminsmart-search__results',
                              role: 'listbox',
                              'aria-label': '会话搜索结果',
                              children: [
                                ...searchResults.map(result => jsxs('button', {
                                  type: 'button',
                                  className: 'adminsmart-search__result',
                                  role: 'option',
                                  'aria-selected': result.summary.id === sessionState.current,
                                  'aria-current': result.summary.id === sessionState.current ? 'true' : undefined,
                                  onClick: () => { openSearchResult(result) },
                                  children: [
                                    jsx('span', {
                                      className: 'adminsmart-search__result-icon',
                                      children: jsx(IconNewChatOutline16, { size: 20, 'aria-hidden': 'true' })
                                    }),
                                    jsxs('span', {
                                      className: 'adminsmart-search__result-content',
                                      children: [
                                        jsxs('span', {
                                          className: 'adminsmart-search__result-heading',
                                          children: [
                                            jsx('span', {
                                              className: 'adminsmart-search__result-title',
                                              children: historyTitle(result.summary)
                                            }),
                                            historySearchDate(result.time)
                                              ? jsx('span', {
                                                  className: 'adminsmart-search__result-date',
                                                  children: historySearchDate(result.time)
                                                })
                                              : null
                                          ]
                                        }),
                                        result.snippet
                                          ? jsx('span', {
                                              className: 'adminsmart-search__result-snippet',
                                              children: result.snippet
                                            })
                                          : null
                                      ]
                                    })
                                  ]
                                }, result.key)),
                                remoteSearch.status === 'loading'
                                  ? jsx('div', {
                                      className: 'adminsmart-search__more',
                                      role: 'status',
                                      children: '正在继续搜索对话内容…'
                                    })
                                  : null,
                                remoteSearch.status === 'error'
                                  ? jsx('div', {
                                      className: 'adminsmart-search__more',
                                      role: 'alert',
                                      children: '已显示标题匹配；对话内容搜索暂时不可用'
                                    })
                                  : null,
                                remoteSearch.hasMore
                                  ? jsx('div', {
                                      className: 'adminsmart-search__more',
                                      children: '结果较多，请输入更具体的关键词'
                                    })
                                  : null
                              ]
                            })
                        })
                  ]
                })
              })
            : null,
          jsxs(Modal, {
            open: renameTarget !== null,
            onClose: closeRenameDialog,
            closeLabel: '关闭',
            title: '重命名会话',
            footer: jsxs('div', {
              children: [
                jsx(Button, {
                  variant: 'outline',
                  disabled: renaming,
                  onClick: closeRenameDialog,
                  children: '取消'
                }),
                jsx(Button, {
                  variant: 'outline',
                  disabled: renaming
                    || renameTarget === null
                    || renameDraftTrimmed === ''
                    || renameDraftTrimmed === renameTarget.currentTitle,
                  onClick: () => { void confirmRenameSession() },
                  children: renaming ? '保存中…' : '保存'
                })
              ]
            }),
            children: [
              jsx('input', {
                ref: renameInputRef,
                type: 'text',
                className: 'adminsmart-rename-field',
                value: renameDraft,
                maxLength: 100,
                'aria-label': '会话名称',
                onChange: event => { setRenameDraft(String(event.target.value ?? '')) },
                onKeyDown: event => {
                  if (event.key === 'Enter') void confirmRenameSession()
                }
              }),
              renameError
                ? jsx('div', { className: 'adminsmart-rename-error', role: 'alert', children: renameError })
                : null
            ]
          }),
          jsxs(Modal, {
            open: deleteTarget !== null,
            onClose: closeDeleteDialog,
            closeLabel: '关闭',
            title: deleteTarget?.sessionIds?.length > 1 ? '删除所选会话' : '删除会话',
            description: deleteTarget === null
              ? undefined
              : deleteTarget.sessionIds.length > 1
                ? `将从历史记录中移除 ${deleteTarget.sessionIds.length} 个会话。`
                : `“${deleteTarget.title}”将从历史记录中移除。`,
            footer: jsxs('div', {
              children: [
                jsx(Button, {
                  variant: 'outline',
                  disabled: deleting,
                  onClick: closeDeleteDialog,
                  children: '取消'
                }),
                jsx(Button, {
                  variant: 'outline',
                  className: 'adminsmart-delete-action',
                  disabled: deleting,
                  onClick: () => { void confirmDeleteSessions() },
                  children: deleting ? '删除中…' : '删除'
                })
              ]
            }),
            children: [
              jsx('div', {
                className: 'adminsmart-delete-copy',
                children: '删除采用 Harness 的可恢复归档语义，原始会话日志不会被物理销毁。'
              }),
              deleting
                ? jsx('div', { className: 'adminsmart-delete-status', role: 'status', children: '正在删除会话…' })
                : null,
              deleteError
                ? jsx('div', { className: 'adminsmart-delete-error', role: 'alert', children: deleteError })
                : null
            ]
          })
        ]
      })
    }

    /** Parse one FastAPI uniform response and return its data object. */
    async function responseData(response) {
      const payload = await response.json().catch(() => null) // Scope responses contain only document labels and UUIDs.
      if (!response.ok || !payload || payload.code !== 200 || typeof payload.data !== 'object') {
        throw new Error(String(payload?.msg || '知识范围暂时不可用'))
      }
      return payload.data
    }

    /** Search the current tenant's Harness Session index with exact match coordinates. */
    async function searchSessionHistory(query, signal) {
      const response = await fetch(SESSION_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }), // Only the bounded literal search phrase leaves the Client plugin.
        signal,
        credentials: 'same-origin',
        cache: 'no-store'
      })
      const payload = await response.json().catch(() => null) // Host returns only authorized Session ids, match coordinates, times, and snippets.
      if (!response.ok || payload === null || typeof payload !== 'object') {
        throw new Error(String(payload?.error || '会话搜索暂时不可用'))
      }
      const items = Array.isArray(payload.items)
        ? payload.items.map((item, index) => ({
            key: `${String(item?.sessionId ?? '')}:${String(item?.seq ?? index)}`, // Stable row key supports multiple future hits per Session.
            sessionId: String(item?.sessionId ?? ''), // Official Harness Session identity.
            seq: Number(item?.seq), // Exact matching event sequence from SessionQuery.
            time: Number(item?.time), // Exact matching event timestamp from SessionQuery.
            snippet: String(item?.snippet ?? '') // Bounded provider-selected plain-text excerpt.
          })).filter(item => item.sessionId !== '' && Number.isFinite(item.seq) && Number.isFinite(item.time))
        : [] // Invalid Host rows fail closed instead of becoming navigation targets.
      return {
        items, // Validated match rows in Harness relevance order.
        hasMore: Boolean(payload.hasMore) // Provider truncation marker shown by the search UI.
      }
    }

    /** Render a Session-scoped knowledge-document multi-select in the composer controls. */
    function KnowledgeScopeSelector({ session }) {
      const sessionId = String(session?.sessionId ?? '') // InputZone supplies the current Harness SessionSnapshot under its public sessionId field.
      const rootRef = useRef(null) // Outside-click handling is confined to the selector subtree.
      const [open, setOpen] = useState(false) // Current popover visibility.
      const [loading, setLoading] = useState(true) // Initial scope catalog and save operations share one bounded feedback state.
      const [documents, setDocuments] = useState([]) // Current user's ready document option rows.
      const [selectedIds, setSelectedIds] = useState([]) // Empty list means all knowledge; non-empty is a strict backend whitelist.
      const [draftSelectedIds, setDraftSelectedIds] = useState([]) // Popover-local multi-selection saved only when the user applies it.
      const [error, setError] = useState('') // Safe backend or transport message; never contains knowledge正文。

      useEffect(() => {
        if (!sessionId) {
          setLoading(false)
          return undefined
        }
        const controller = new AbortController() // Session switch cancels the old user's scope request before state submission.
        setLoading(true)
        setError('')
        fetch(`${KNOWLEDGE_SCOPE_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal
        })
          .then(responseData)
          .then((data) => {
            setDocuments(Array.isArray(data.documents) ? data.documents : [])
            const nextSelectedIds = Array.isArray(data.selectedDocumentIds) ? data.selectedDocumentIds.map(String) : [] // Backend-authoritative Session whitelist.
            setSelectedIds(nextSelectedIds)
            setDraftSelectedIds(nextSelectedIds)
          })
          .catch((reason) => {
            if (reason?.name !== 'AbortError') setError(String(reason?.message || '知识范围加载失败'))
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
        return () => { controller.abort() }
      }, [sessionId])

      useEffect(() => {
        if (!open) return undefined
        /** Close without saving when the user clicks outside or presses Escape. */
        const closeOutside = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const closeOnEscape = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', closeOutside)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
          document.removeEventListener('pointerdown', closeOutside)
          document.removeEventListener('keydown', closeOnEscape)
        }
      }, [open])

      /** Persist one complete strict whitelist; an empty array restores all-knowledge mode. */
      async function saveSelection(nextIds) {
        setLoading(true)
        setError('')
        try {
          const response = await fetch(KNOWLEDGE_SCOPE_URL, {
            method: 'PUT',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, documentIds: nextIds })
          })
          const data = await responseData(response)
          setDocuments(Array.isArray(data.documents) ? data.documents : documents)
          const savedSelectedIds = Array.isArray(data.selectedDocumentIds) ? data.selectedDocumentIds.map(String) : [] // Backend-normalized strict whitelist.
          setSelectedIds(savedSelectedIds)
          setDraftSelectedIds(savedSelectedIds)
          setOpen(false)
        } catch (reason) {
          setError(String(reason?.message || '知识范围保存失败'))
        } finally {
          setLoading(false)
        }
      }

      /** Toggle one document in the local draft while preserving option order. */
      function toggleDocument(documentId) {
        const normalizedId = String(documentId)
        setDraftSelectedIds(currentIds => (
          currentIds.includes(normalizedId)
            ? currentIds.filter(value => value !== normalizedId)
            : [...currentIds, normalizedId]
        ))
      }

      const allKnowledge = selectedIds.length === 0 // Required product rule: no explicit selection means every ready document.
      const draftAllKnowledge = draftSelectedIds.length === 0 // Current popover draft's all-knowledge mode.
      const selectionChanged = (
        draftSelectedIds.length !== selectedIds.length
        || draftSelectedIds.some((documentId, index) => documentId !== selectedIds[index])
      ) // Footer apply is enabled only when the local draft differs from the saved whitelist.
      const buttonLabel = allKnowledge ? '全部知识' : `已选 ${selectedIds.length} 个`
      return jsxs('div', {
        ref: rootRef,
        className: 'adminsmart-knowledge-scope',
        'data-adminsmart-knowledge-scope': 'true',
        children: [
          jsxs('button', {
            type: 'button',
            className: 'adminsmart-knowledge-button',
            disabled: loading || !sessionId,
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            title: '选择知识范围',
            onClick: () => {
              if (!open) {
                setDraftSelectedIds([...selectedIds])
                setError('')
              }
              setOpen(value => !value)
            },
            children: [
              jsx('span', { children: loading ? '加载中…' : buttonLabel }),
              jsx(IconChevronDownOutline14, {
                className: open
                  ? 'adminsmart-knowledge-chevron adminsmart-knowledge-chevron--open'
                  : 'adminsmart-knowledge-chevron',
                'aria-hidden': 'true'
              })
            ]
          }),
          open
            ? jsxs('section', {
                className: 'adminsmart-knowledge-popover',
                role: 'dialog',
                'aria-label': '选择知识',
                children: [
                  jsxs('div', {
                    className: 'adminsmart-knowledge-popover__header',
                    children: [
                      jsxs('span', {
                        className: 'adminsmart-knowledge-popover__heading',
                        children: [
                          jsx('span', { className: 'adminsmart-knowledge-popover__title', children: '选择知识' }),
                          jsx('span', {
                            className: 'adminsmart-knowledge-popover__meta',
                            children: loading
                              ? '正在保存...'
                              : draftAllKnowledge
                                ? '全部知识'
                                : `已选择 ${draftSelectedIds.length} 个文档`
                          })
                        ]
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'adminsmart-knowledge-popover__close',
                        'aria-label': '关闭知识选择',
                        title: '关闭',
                        onClick: () => {
                          setDraftSelectedIds([...selectedIds])
                          setOpen(false)
                          setError('')
                        },
                        children: jsx(IconCloseOutline16, { size: 16, 'aria-hidden': 'true' })
                      })
                    ]
                  }),
                  jsxs('div', {
                    className: 'adminsmart-knowledge-popover__list',
                    role: 'listbox',
                    'aria-multiselectable': 'true',
                    children: [
                      jsxs('button', {
                        type: 'button',
                        className: 'adminsmart-knowledge-option',
                        role: 'option',
                        'aria-selected': draftAllKnowledge,
                        'data-selected': draftAllKnowledge ? 'true' : 'false',
                        disabled: loading,
                        onClick: () => { setDraftSelectedIds([]) },
                        children: [
                          jsx('span', {
                            className: 'adminsmart-knowledge-option__check',
                            'data-selected': draftAllKnowledge ? 'true' : 'false',
                            children: draftAllKnowledge ? jsx(IconCheckOutline16, { size: 13, 'aria-hidden': 'true' }) : null
                          }),
                          jsxs('span', {
                            className: 'adminsmart-knowledge-option__copy',
                            children: [
                              jsx('span', { className: 'adminsmart-knowledge-option__title', children: '全部知识' }),
                              jsx('span', { className: 'adminsmart-knowledge-option__file', children: '默认' })
                            ]
                          })
                        ]
                      }),
                      documents.length > 0
                        ? jsx('div', { className: 'adminsmart-knowledge-popover__group-label', children: '指定文档' })
                        : null,
                      documents.length === 0
                        ? jsx('div', { className: 'adminsmart-knowledge-popover__status', children: '暂无可用知识文档' })
                        : documents.map((document) => {
                            const documentId = String(document.documentId ?? '') // Backend-authorized knowledge document identity.
                            const selected = draftSelectedIds.includes(documentId) // Current draft membership shown by the circular check.
                            const title = String(document.title || '未命名文档') // Primary row label.
                            const fileName = String(document.fileName || '') // Secondary source filename.
                            return jsxs('button', {
                              type: 'button',
                              className: 'adminsmart-knowledge-option',
                              role: 'option',
                              'aria-selected': selected,
                              'data-selected': selected ? 'true' : 'false',
                              disabled: loading,
                              title: fileName ? `${title}\n${fileName}` : title,
                              onClick: () => { toggleDocument(documentId) },
                              children: [
                                jsx('span', {
                                  className: 'adminsmart-knowledge-option__check',
                                  'data-selected': selected ? 'true' : 'false',
                                  children: selected ? jsx(IconCheckOutline16, { size: 13, 'aria-hidden': 'true' }) : null
                                }),
                                jsxs('span', {
                                  className: 'adminsmart-knowledge-option__copy',
                                  children: [
                                    jsx('span', { className: 'adminsmart-knowledge-option__title', children: title }),
                                    fileName ? jsx('span', { className: 'adminsmart-knowledge-option__file', children: fileName }) : null
                                  ]
                                })
                              ]
                            }, documentId)
                          }),
                      error
                        ? jsx('div', {
                            className: 'adminsmart-knowledge-popover__status',
                            'data-level': 'error',
                            role: 'alert',
                            children: error
                          })
                        : null
                    ]
                  }),
                  jsxs('div', {
                    className: 'adminsmart-knowledge-popover__footer',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'adminsmart-knowledge-popover__action',
                        disabled: loading,
                        onClick: () => {
                          setDraftSelectedIds([...selectedIds])
                          setOpen(false)
                          setError('')
                        },
                        children: '取消'
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'adminsmart-knowledge-popover__action adminsmart-knowledge-popover__action--primary',
                        disabled: loading || !selectionChanged,
                        onClick: () => { void saveSelection(draftSelectedIds) },
                        children: loading ? '保存中...' : '应用'
                      })
                    ]
                  })
                ]
              })
            : null
        ]
      })
    }

    /** Render current-question image intake beside the independent knowledge-range selector. */
    function AdminSmartComposerTools({
      session,
      inputActions,
      createDraftImages,
      releaseDraftImages
    }) {
      const sessionId = String(session?.sessionId ?? '') // Images are admitted only into the currently scoped Harness Session.
      const imageInputRef = useRef(null) // Hidden image input owns Harness message attachment selection.
      const [uploadMessage, setUploadMessage] = useState('') // 当前图片进入消息草稿时的错误反馈。
      const [uploadMessageLevel, setUploadMessageLevel] = useState('info') // info 或 error feedback tone.

      /** Convert selected browser images into official Harness draft attachments. */
      function acceptImages(event) {
        const selectedFiles = Array.from(event.target.files ?? []) // Operator-selected local images from the native picker.
        event.target.value = '' // Re-selecting the same file must fire a new change event.
        if (selectedFiles.length === 0) return
        setUploadMessage('')
        const unsupportedFiles = selectedFiles.filter(file => !CHAT_IMAGE_MIME_TYPES.has(file.type)) // 非白名单图片或伪装文件不得进入 Harness 草稿。
        if (unsupportedFiles.length > 0) {
          setUploadMessageLevel('error')
          setUploadMessage('仅支持 PNG、JPEG、WebP 或 GIF 图片')
          return
        }
        let draftImages = [] // Official conversation-owned draft objects with preview URLs and stable attachment IDs.
        try {
          draftImages = createDraftImages(selectedFiles)
          const accepted = inputActions.addImages(draftImages.map(image => image.id)) // Session input machine rejects images while its admission phase is locked.
          if (!accepted) {
            releaseDraftImages(draftImages)
            setUploadMessageLevel('error')
            setUploadMessage('当前会话暂时不能添加图片')
          }
        } catch (reason) {
          if (draftImages.length > 0) releaseDraftImages(draftImages)
          setUploadMessageLevel('error')
          setUploadMessage(String(reason?.message || '图片添加失败'))
        }
      }

      return jsxs('div', {
        className: 'adminsmart-composer-tools',
        'data-adminsmart-composer-tools': 'true',
        children: [
          jsx('input', {
            ref: imageInputRef,
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            multiple: true,
            hidden: true,
            onChange: acceptImages
          }),
          jsx('button', {
            type: 'button',
            className: 'adminsmart-upload-button',
            disabled: !sessionId,
            'aria-label': '上传图片',
            title: '上传图片',
            onClick: () => { imageInputRef.current?.click() },
            children: jsx(IconPlusOutline16, { size: 15, 'aria-hidden': 'true' })
          }),
          jsx(KnowledgeScopeSelector, { session }),
          uploadMessage
            ? jsx('span', {
                className: 'adminsmart-upload-message',
                'data-level': uploadMessageLevel,
                role: uploadMessageLevel === 'error' ? 'alert' : 'status',
                title: uploadMessage,
                children: uploadMessage
              })
            : null
        ]
      })
    }

    /** Replace exact official chrome copy without depending on CSS Module hash names. */
    function reconcileAdminSmartChrome(root) {
      const replacements = new Map([
        ['探索未至之境', 'AuraSearch'],
        ['Into the Unknown', 'AuraSearch'],
        ['工作区', '会话'],
        ['Workspace', 'Sessions']
      ]) // Only exact standalone UI text is replaced; user messages and knowledge content are never inspected.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      while (textNode) {
        const originalText = String(textNode.nodeValue ?? '').trim()
        const replacementText = replacements.get(originalText)
        if (replacementText !== undefined && textNode.nodeValue !== replacementText) {
          textNode.nodeValue = replacementText
        }
        if (originalText === '预览版' || originalText === 'Preview') {
          const badge = textNode.parentElement
          if (badge && !badge.hidden) badge.hidden = true
        }
        textNode = walker.nextNode()
      }

      for (const workspaceButton of root.querySelectorAll(
        'button[aria-label="选择工作区"],button[aria-label="Choose workspace"]'
      )) {
        const displayValue = workspaceButton.style.getPropertyValue('display') // Inline display must defeat the upstream button class that overrides [hidden].
        const displayPriority = workspaceButton.style.getPropertyPriority('display') // Important priority prevents later class rules from restoring the picker.
        if (
          !workspaceButton.hidden
          || workspaceButton.getAttribute('aria-hidden') !== 'true'
          || displayValue !== 'none'
          || displayPriority !== 'important'
        ) {
          workspaceButton.hidden = true
          workspaceButton.setAttribute('aria-hidden', 'true')
          workspaceButton.style.setProperty('display', 'none', 'important') // Fixed tenant Workspace is automatic, so no visible or focusable picker remains.
        }
      }
      for (const accessModeButton of root.querySelectorAll(
        'button[aria-label^="访问模式"],button[aria-label^="Access mode"]'
      )) {
        const accessModeDisplay = accessModeButton.style.getPropertyValue('display') // Knowledge Q&A never exposes coding Workspace write modes.
        if (
          !accessModeButton.hidden
          || accessModeButton.getAttribute('aria-hidden') !== 'true'
          || accessModeDisplay !== 'none'
        ) {
          accessModeButton.hidden = true
          accessModeButton.setAttribute('aria-hidden', 'true')
          accessModeButton.style.setProperty('display', 'none', 'important') // Remove the irrelevant write-access control from layout and focus order.
        }
      }
      for (const commandButton of root.querySelectorAll(
        'button[aria-label="指令"],button[aria-label="Commands"]'
      )) {
        const commandDisplay = commandButton.style.getPropertyValue('display') // Official plus opens coding commands; AdminSmart supplies a real image picker instead.
        if (
          !commandButton.hidden
          || commandButton.getAttribute('aria-hidden') !== 'true'
          || commandDisplay !== 'none'
        ) {
          commandButton.hidden = true
          commandButton.setAttribute('aria-hidden', 'true')
          commandButton.style.setProperty('display', 'none', 'important')
        }
      }
      for (const composerTools of root.querySelectorAll('[data-adminsmart-composer-tools="true"]')) {
        const slotWrapper = composerTools.parentElement // Renderer-owned wrapper around the AdminSmart list-slot occupant.
        const officialToolsRow = slotWrapper?.parentElement // Official left toolbar group whose row padding must remain the only outer inset.
        if (!slotWrapper || !officialToolsRow) continue
        for (const sibling of Array.from(officialToolsRow.children)) {
          if (sibling === slotWrapper) continue
          const candidateControls = [
            ...(sibling.matches('button,input,select,[role="button"]') ? [sibling] : []),
            ...sibling.querySelectorAll('button,input,select,[role="button"]')
          ] // Official command/mode containers may remain in layout after all of their controls are semantically hidden.
          const hasVisibleControl = candidateControls.some(control => (
            !control.hidden
            && control.getAttribute('aria-hidden') !== 'true'
            && control.style.getPropertyValue('display') !== 'none'
          )) // Only genuinely interactive siblings keep their place in the official 16px flex-gap account.
          const alreadyRemovedFromLayout = (
            sibling.getAttribute('aria-hidden') === 'true'
            && sibling.style.getPropertyValue('display') === 'none'
            && sibling.style.getPropertyPriority('display') === 'important'
          ) // Attribute-observing reconciliation must not rewrite an already stable hidden state.
          if (!hasVisibleControl && !alreadyRemovedFromLayout) {
            sibling.setAttribute('aria-hidden', 'true')
            sibling.style.setProperty('display', 'none', 'important')
          }
        }
      }
      for (const input of root.querySelectorAll('textarea,[contenteditable="true"]')) {
        const placeholderCandidates = [
          input.getAttribute('placeholder'),
          input.getAttribute('data-placeholder'),
          input.getAttribute('aria-label')
        ].filter(value => typeof value === 'string') // Visible copy and accessible copy may diverge while the official Workspace trigger is inert.
        const carriesWorkspaceCopy = placeholderCandidates.some(value => (
          value.includes('工作区')
          || value.includes('构建的内容')
          || value.includes('发送消息或做任务')
          || value.includes('调用指令')
          || value.includes('文件或对话')
          || value.includes('workspace')
          || value.includes('want to build')
          || value.includes('Send a message or do a task')
        )) // Any stale coding/workspace phrase causes every composer label source to be reconciled together.
        if (carriesWorkspaceCopy) {
          const knowledgePlaceholder = '请输入知识问题…' // AdminSmart composer copy must describe knowledge Q&A rather than coding workspaces.
          if (input.hasAttribute('placeholder')) input.setAttribute('placeholder', knowledgePlaceholder)
          if (input.hasAttribute('data-placeholder')) input.setAttribute('data-placeholder', knowledgePlaceholder)
          if (input.hasAttribute('aria-label')) input.setAttribute('aria-label', knowledgePlaceholder)
        }
      }
      for (const placeholderNode of root.querySelectorAll('[data-composer-placeholder="true"]')) {
        const placeholderText = String(placeholderNode.textContent ?? '').trim() // Visible Lexical placeholder copy lives in a dedicated sibling node.
        if (
          placeholderText.includes('工作区')
          || placeholderText.includes('构建的内容')
          || placeholderText.includes('发送消息或做任务')
          || placeholderText.includes('调用指令')
          || placeholderText.includes('文件或对话')
          || placeholderText.includes('workspace')
          || placeholderText.includes('want to build')
          || placeholderText.includes('Send a message or do a task')
        ) {
          placeholderNode.textContent = '请输入知识问题…'
        }
      }
      for (const reasoningRoot of root.querySelectorAll('[data-variant="think"]')) {
        const reasoningToggle = reasoningRoot.querySelector('button[aria-expanded="false"]') // Official reasoning disclosure before AdminSmart's one-time expansion.
        if (!reasoningToggle || reasoningToggle.getAttribute('data-adminsmart-auto-expanded') === 'true') continue
        reasoningToggle.setAttribute('data-adminsmart-auto-expanded', 'true')
        queueMicrotask(() => {
          if (reasoningToggle.isConnected && reasoningToggle.getAttribute('aria-expanded') === 'false') reasoningToggle.click()
        })
      }
      for (const paragraph of root.querySelectorAll('p')) {
        const paragraphText = String(paragraph.textContent ?? '') // Historical assistant prose may contain a provider tool protocol from before normalization.
        if (!paragraphText.includes('<tool_call>') && !paragraphText.includes('<function=')) continue
        if (paragraph.getAttribute('data-adminsmart-protocol-hidden') === 'true') continue
        paragraph.setAttribute('data-adminsmart-protocol-hidden', 'true')
        paragraph.setAttribute('aria-hidden', 'true')
        paragraph.style.setProperty('display', 'none', 'important')
      }
      for (const modelSurface of root.querySelectorAll(
        'button[aria-label^="选择模型"],[role="menu"][aria-label="模型与推理等级"]'
      )) {
        const modelWalker = document.createTreeWalker(modelSurface, NodeFilter.SHOW_TEXT) // Scope wording changes to the official model trigger and menu only.
        let modelTextNode = modelWalker.nextNode() // Current text node inside the model-selection surface.
        while (modelTextNode) {
          const modelText = String(modelTextNode.nodeValue ?? '').trim() // Exact official model or effort label currently rendered.
          const modelReplacement = modelText === '推理等级'
            ? '思考模式'
            : modelText === 'Off'
              ? '关闭'
              : modelText === 'Max'
                ? '开启'
                : undefined
          if (modelReplacement !== undefined && modelTextNode.nodeValue !== modelReplacement) {
            modelTextNode.nodeValue = modelReplacement
          }
          modelTextNode = modelWalker.nextNode()
        }
        for (const attributeName of ['aria-label', 'title']) {
          const attributeValue = modelSurface.getAttribute(attributeName) // Accessible or tooltip copy supplied by the official control.
          if (!attributeValue) continue
          const normalizedValue = attributeValue
            .replaceAll('推理等级', '思考模式')
            .replaceAll('Off', '关闭')
            .replaceAll('Max', '开启')
          if (normalizedValue !== attributeValue) modelSurface.setAttribute(attributeName, normalizedValue)
        }
      }
    }

    /** Install the AdminSmart sidebar, conversation seats, and semantic adapters for remaining official copy. */
    function apply(ctx) {
      const currentTheme = ctx.theme.getTheme() // Knowledge Q&A follows the AdminSmart host's permanent light appearance.
      if (currentTheme.preference !== 'light' || currentTheme.colorScheme !== 'light') {
        ctx.theme.setTheme('light') // Official theme service updates tokens, DOM attributes, and the isolated Runtime preference together.
      }
      const styleElement = installAdminSmartStyles() // CSS is installed before custom Slot occupants can render.
      ctx.effect(() => () => {
        if (styleElement.isConnected) styleElement.remove()
      }, 'adminsmart-client-ui: owned styles')
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AdminSmartMark))
      ctx.slots.inject('conversation.session.header', () =>
        ctx.slots.register({
          name: 'conversation.session.header',
          priority: -100
        }, AdminSmartHiddenSessionHeader))
      for (const hiddenNodeKind of ['system-prompt', 'context']) {
        ctx.slots.inject('conversation.chat.node', () =>
          ctx.slots.register({
            name: 'conversation.chat.node',
            key: hiddenNodeKind,
            priority: -100
          }, AdminSmartHiddenChatNode))
      }
      ctx.slots.inject('conversation.chat.node', () =>
        ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'turn-process',
          priority: -100
        }, AdminSmartTurnProcessNode))
      ctx.slots.inject('sidebar', () =>
        ctx.slots.register({
          name: 'sidebar',
          id: 'adminsmart-sidebar',
          priority: -100, // Single-slot precedence: the lowest priority legally replaces the shipped Workspace-facing sidebar shell.
          store: createAdminSmartSidebarStore(), // Harness Store persists only user-controlled pin membership.
          inject: () => ({
            startSession: () => { ctx.uiWorkspace.startSession() }, // New Session inherits the current or fixed recent Workspace through the official navigator.
            toggleSidebar: () => { ctx.layout.toggleSidebar() }, // Column collapse remains owned by the official layout service.
            openSession: sessionId => { ctx.sessions.open(sessionId) }, // History rows navigate through the official Session Controller.
            searchSessions: (query, signal) => searchSessionHistory(query, signal), // Host wrapper keeps Harness's exact match seq/time instead of the reduced public Session list projection.
            loadOlderSession: async sessionId => {
              const session = ctx.sessions.binding(sessionId)?.session // Search navigation loads history through the public Session face only.
              if (session === undefined) return false
              const snapshot = session.getSnapshot() // Current pagination state prevents duplicate or exhausted loads.
              if (!snapshot.hasMore || snapshot.loadingOlder) return false
              await session.loadOlder()
              return true
            },
            renameSession: async (sessionId, title) => {
              const session = ctx.sessions.binding(sessionId)?.session // Rename is a per-Session public verb, not a list mutation.
              if (session === undefined) throw new Error('会话不存在或已失效')
              const result = await session.rename(title) // Host normalizes and durably records the explicit user title.
              if (!result.ok) throw new Error(result.error.message || '会话重命名失败')
            },
            archiveSession: sessionId => ctx.uiWorkspace.archiveSession(sessionId) // “删除” uses Harness reversible archive semantics and preserves durable logs.
          })
        }, AdminSmartSidebar))
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register({
          name: 'conversation.input.left',
          id: 'adminsmart-composer-tools',
          order: -100,
          inject: () => ({
            createDraftImages: files => ctx.conversation.createDraftImages(files), // Official conversation service owns previews and media validation.
            releaseDraftImages: images => { ctx.conversation.releaseDraftImages(images) } // Rejected batches release every generated preview URL.
          })
        }, AdminSmartComposerTools))

      ctx.effect(() => {
        let disposed = false // Client plugin teardown prevents late navigation after HMR or page disposal.
        let connecting = false // At most one fixed Workspace Session creation can be in flight.
        const reconcileSession = () => {
          if (disposed || connecting) return
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot()
          const sessionSnapshot = ctx.sessions.list.getSnapshot()
          if (workspaceSnapshot.phase !== 'ready' || sessionSnapshot.phase !== 'ready') return
          if (sessionSnapshot.current !== undefined) return
          const fixedWorkspace = workspaceSnapshot.items[0] // Host plugin creates exactly one tenant-local “知识问答” Workspace.
          if (!fixedWorkspace) return
          connecting = true
          void ctx.uiWorkspace.connectWorkspace(fixedWorkspace.workspaceId).then(
            (sessionId) => {
              if (!disposed && ctx.sessions.list.getSnapshot().current === undefined) {
                ctx.sessions.open(sessionId)
              }
            },
            (reason) => {
              if (!disposed) console.warn('AdminSmart 固定知识会话连接失败：', reason)
            }
          ).finally(() => { connecting = false })
        }
        const disposeWorkspaces = ctx.workspaces.list.subscribe(reconcileSession)
        const disposeSessions = ctx.sessions.list.subscribe(reconcileSession)
        reconcileSession()
        return () => {
          disposed = true
          disposeSessions()
          disposeWorkspaces()
        }
      }, 'adminsmart-client-ui: fixed knowledge workspace session')

      ctx.effect(() => {
        let reconciling = false // MutationObserver callbacks may be triggered by the adapter's own text updates.
        const reconcile = () => {
          if (reconciling) return
          reconciling = true
          try {
            reconcileAdminSmartChrome(document.body)
          } finally {
            reconciling = false
          }
        }
        const observer = new MutationObserver(reconcile) // React rerenders and locale changes are reapplied without polling.
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
        queueMicrotask(reconcile)
        return () => { observer.disconnect() }
      }, 'adminsmart-client-ui: brand and fixed-workspace chrome')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
