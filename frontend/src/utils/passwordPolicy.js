const common = new Set(["password1!", "password123!", "qwerty123!", "admin123!", "welcome1!", "12345678", "password"]);
export const passwordHint = "Ít nhất 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt. Tối đa 72 byte UTF-8.";
export function passwordError(value) {
  const missing = [];
  if (value.length < 8) missing.push("ít nhất 8 ký tự");
  if (!/\p{Lu}/u.test(value)) missing.push("chữ hoa");
  if (!/\p{Ll}/u.test(value)) missing.push("chữ thường");
  if (!/\p{Nd}/u.test(value)) missing.push("số");
  if (!/[^\p{L}\p{N}\s]/u.test(value)) missing.push("ký tự đặc biệt");
  if (value.length > 72 || new globalThis.TextEncoder().encode(value).length > 72) return "Mật khẩu vượt quá giới hạn 72 byte UTF-8.";
  if (missing.length) return `Mật khẩu cần có: ${missing.join(", ")}.`;
  return common.has(value.toLowerCase()) ? "Mật khẩu quá phổ biến. Vui lòng chọn mật khẩu khác." : "";
}
