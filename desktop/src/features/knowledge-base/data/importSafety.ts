/** Refuse unsupported, binary or oversized input before loading parsers. */
export function validateKnowledgeFile(name: string, size: number): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!["pdf", "docx", "txt", "md"].includes(extension))
    throw new Error(
      "Выберите PDF, DOCX, TXT или Markdown / Unsupported file type.",
    );
  if (size < 1 || size > 10 * 1024 * 1024)
    throw new Error("Размер файла: от 1 байта до 10 МБ / File limit: 10 MB.");
  return extension;
}

/** Bound DOCX inflation before handing ZIP input to the parser. */
export function validateDocxArchive(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Повреждённый DOCX / Invalid DOCX archive.");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (
    count > 1500 ||
    offset >= end ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw new Error("Слишком сложный DOCX / DOCX archive limits exceeded.");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("Повреждённый DOCX / Invalid DOCX archive.");
    total += view.getUint32(cursor + 24, true);
    if (
      total > 25 * 1024 * 1024 ||
      (view.getUint16(cursor + 8, true) & 1) !== 0
    )
      throw new Error(
        "DOCX слишком большой или защищён / DOCX is too large or encrypted.",
      );
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
  if (cursor > end)
    throw new Error("Повреждённый DOCX / Invalid DOCX archive.");
}

export function plainTextMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/([\\`*_{}[\]<>#])/g, "\\$1");
}
export function validateExtractedText(text: string): string {
  if (!text.trim())
    throw new Error(
      "Текст не найден. Для скана добавьте текст вручную / No readable text; scans need manual text.",
    );
  if (text.includes("\0") || text.length > 50000)
    throw new Error(
      "Материал слишком большой или содержит нетекстовые данные. Разделите его / Split this material into smaller documents.",
    );
  return text.trim();
}
