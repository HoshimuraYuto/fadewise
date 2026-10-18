export function byId(id: string, doc: Document = document): HTMLElement {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);

  return e;
}

export const inputById = (id: string, doc?: Document) => byId(id, doc) as HTMLInputElement;
export const selectById = (id: string, doc?: Document) => byId(id, doc) as HTMLSelectElement;
