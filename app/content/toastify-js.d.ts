// .d.ts, not .d.mts: as a script file this is a declaration, not a module augmentation
declare module 'toastify-js' {
  const Toastify: (options: Record<string, unknown>) => { showToast(): void; hideToast(): void };
  export default Toastify;
}
