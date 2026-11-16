export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

export function xmlSection(
  tag: string,
  body: string | null | undefined,
  attrs?: Record<string, string>,
): string | null {
  const trimmed = body?.trim();
  if (!trimmed) {
    return null;
  }
  const attrString = attrs
    ? Object.entries(attrs)
        .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
        .join("")
    : "";
  return `<${tag}${attrString}>\n${trimmed}\n</${tag}>`;
}

export function xmlLeaf(tag: string, text: string): string {
  return `<${tag}>${escapeXmlText(text)}</${tag}>`;
}
