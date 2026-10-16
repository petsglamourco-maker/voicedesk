/** Reads a text field from FormData ("" when missing or a file). */
export function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
