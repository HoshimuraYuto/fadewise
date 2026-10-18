export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string | number | null,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = String(text);
  if (cls) e.className = cls;

  return e;
}
