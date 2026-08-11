import { platform } from "@tauri-apps/plugin-os";

// 缓存平台检测结果
let cachedResult: boolean | null = null;
let cachedTauriResult: boolean | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 异步检查是否为移动设备的函数
export function isMobileDevice() {
  // 如果已经检测过，直接返回缓存结果
  if (cachedResult !== null) {
    return cachedResult;
  }

  if (!isTauriRuntime()) {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    cachedResult = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
    return cachedResult
  }

  try {
    const platformName = platform();
    cachedResult = platformName === 'android';
    return cachedResult;
  } catch (error) {
    console.error('Error detecting platform:', error);
    // 如果 Tauri API 失败，尝试使用 user agent 检测
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase();
      cachedResult = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      return cachedResult;
    }
    cachedResult = false;
    return false;
  }
}

// 检查是否在 Tauri 环境中运行
export function checkIsTauri(): boolean {
  // 如果已经检测过，直接返回缓存结果
  if (cachedTauriResult !== null) {
    return cachedTauriResult;
  }

  cachedTauriResult = isTauriRuntime();
  return cachedTauriResult;
}
