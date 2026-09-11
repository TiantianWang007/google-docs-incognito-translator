export const DEFAULT_TAB_COUNT = 10;
export const MIN_TAB_COUNT = 1;
export const MAX_TAB_COUNT = 100;

export function isValidTabCount(count) {
  return Number.isInteger(count) && count >= MIN_TAB_COUNT && count <= MAX_TAB_COUNT;
}

export function validateTabCount(count) {
  if (!isValidTabCount(count)) {
    throw new Error(`请输入 ${MIN_TAB_COUNT}–${MAX_TAB_COUNT} 之间的整数作为打开数量。`);
  }
  return count;
}
