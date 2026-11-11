import { AppError } from "./errors.js";

// Editors and JSON saves materialize text. Keep their memory budget separate
// from Storage's streaming binary upload limit; operators can tune this budget.
export function editableFileByteLimit(): number {
  const value = Number(process.env.CHAT_EDITABLE_FILE_MAX_BYTES ?? 2 * 1024 * 1024);
  if (!Number.isSafeInteger(value) || value < 1 || value > Math.floor(Number.MAX_SAFE_INTEGER / 6)) {
    throw new Error("CHAT_EDITABLE_FILE_MAX_BYTES must be a positive safe byte limit");
  }
  return value;
}

export function assertEditableFileSize(bytes: number): void {
  if (bytes > editableFileByteLimit())
    throw new AppError("file exceeds the text editing byte budget", 413, "file_too_large");
}
