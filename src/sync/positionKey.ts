const POSITION_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const POSITION_BASE = POSITION_ALPHABET.length;
const POSITION_MIDDLE_INDEX = Math.floor(POSITION_BASE / 2);

export function createInitialPositionKey(order: number): string {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new Error("Task position order must be a non-negative integer.");
  }
  return `U${order.toString(36).padStart(12, "0")}U`;
}

export function generatePositionKeyBetween(
  left: string | null,
  right: string | null,
): string {
  if (left !== null) {
    validatePositionKey(left);
  }
  if (right !== null) {
    validatePositionKey(right);
  }
  if (left !== null && right !== null && left >= right) {
    throw new Error("Position boundaries must be in ascending order.");
  }

  const leftKey = left ?? "";
  let prefix = "";
  let index = 0;

  while (true) {
    const leftDigit =
      index < leftKey.length
        ? digitAt(leftKey, index)
        : 0;
    const rightDigit =
      right === null || index >= right.length
        ? POSITION_BASE - 1
        : digitAt(right, index);

    if (leftDigit === rightDigit) {
      prefix += POSITION_ALPHABET[leftDigit]!;
      index += 1;
      continue;
    }

    if (rightDigit - leftDigit > 1) {
      const middle = Math.floor((leftDigit + rightDigit) / 2);
      return `${prefix}${POSITION_ALPHABET[middle]}`;
    }

    prefix += POSITION_ALPHABET[leftDigit]!;
    index += 1;

    if (index > 1_024) {
      throw new Error("Position key is too deeply nested.");
    }
  }
}

export function comparePositionKeys(
  left: string,
  right: string,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validatePositionKey(key: string): void {
  if (
    key.length === 0 ||
    key.endsWith(POSITION_ALPHABET[0]!) ||
    [...key].some((character) => !POSITION_ALPHABET.includes(character))
  ) {
    throw new Error(`Invalid task position key: ${key}`);
  }
}

function digitAt(key: string, index: number): number {
  const character = key[index];
  const digit = character
    ? POSITION_ALPHABET.indexOf(character)
    : POSITION_MIDDLE_INDEX;
  if (digit < 0) {
    throw new Error(`Invalid task position key: ${key}`);
  }
  return digit;
}
