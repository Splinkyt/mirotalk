// Simple logger with consistent prefix
export function log(...args) {
  console.log('[MVP]', ...args);
}

export function warn(...args) {
  console.warn('[MVP]', ...args);
}

export function error(...args) {
  console.error('[MVP]', ...args);
}
