// Ports of MMOcha.utils.StringFunctions: the map format and the network
// protocol encode small numbers as single letters/digits.

/** 'a'..'z' -> 0..25, 'A'..'Z' -> 26..51. */
export function fromAlphaCharacter(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 97;
  if (c >= 65 && c <= 90) return c - 39;
  return undefined;
}

/** '0'..'9' -> 0..9, 'a'..'z' -> 10..35, 'A'..'Z' -> 36..61. */
export function fromAlphaNumericCharacter(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 87;
  if (c >= 65 && c <= 90) return c - 29;
  if (c >= 48 && c <= 57) return c - 48;
  return undefined;
}

export function toAlphaNumericCharacter(n) {
  if (n < 0 || n > 61) return undefined;
  return n < 36 ? n.toString(36) : (n - 26).toString(36).toUpperCase();
}

/** Zero-pad to a fixed width; negative numbers are padded with 9s like the original. */
export function padInt(value, width) {
  value = Math.trunc(value);
  let out = '';
  if (value < 0) {
    out = '-';
    value = -value;
  }
  const digits = String(value);
  if (out.length + digits.length > width) {
    while (out.length < width) out += '9';
    return out;
  }
  while (out.length + digits.length < width) out += '0';
  return out + digits;
}
