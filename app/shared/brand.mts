export const EXTENSION_NAME = 'Fadewise';
export const EXPORT_PREFIX = 'fadewise-analysis';

export function exportFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');

  return (
    `${EXPORT_PREFIX}-${String(date.getFullYear())}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`
  );
}
