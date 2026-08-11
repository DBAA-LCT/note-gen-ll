export enum ShortcutSettings {
  text = "shotcut-text",
  pin = "window-pin",
  link = "shotcut-link"
}

export enum ShortcutDefault {
  text = "Control+Shift+T",
  pin = "Control+Shift+P",
  link = "Control+Shift+L",
}

/**
 * 文件管理器快捷键
 * rename: F2 - 重命名选中的文件或文件夹（仅桌面端）
 * copy: Ctrl+C - 复制选中的文件或文件夹
 * paste: Ctrl+V - 粘贴剪贴板中的文件或文件夹
 * cut: Ctrl+X - 剪切选中的文件或文件夹
 * delete: Delete - 删除选中的文件或文件夹
 */
export const FileShortcuts = {
  rename: 'F2',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  cut: 'Ctrl+X',
  delete: 'Delete'
} as const
