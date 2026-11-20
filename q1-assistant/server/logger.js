const stamp = () => new Date().toISOString();

export const logger = Object.freeze({
  info: (...args) => console.log(`[${stamp()}] INFO`, ...args),
  warn: (...args) => console.warn(`[${stamp()}] WARN`, ...args),
  error: (...args) => console.error(`[${stamp()}] ERROR`, ...args),
});
