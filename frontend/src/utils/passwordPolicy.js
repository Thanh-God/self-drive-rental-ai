const common = new Set(["password1!", "password123!", "qwerty123!", "admin123!", "welcome1!", "12345678", "password"]);
export const passwordHint = "Ít nhất 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt. Tối đa 72 byte UTF-8.";
export function passwordError(value) {
  if (value.length < 8 || value.length > 72 || new globalThis.TextEncoder().encode(value).length > 72 ||
    !/\p{Lu}/u.test(value) || !/\p{Ll}/u.test(value) || !/\p{Nd}/u.test(value) || !/[^\p{L}\p{N}\s]/u.test(value)) return passwordHint;
  return common.has(value.toLowerCase()) ? "Mật khẩu quá phổ biến. Vui lòng chọn mật khẩu khác." : "";
}
