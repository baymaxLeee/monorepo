export function slotClassNameFactory(base: string) {
  return (slot: TemplateStringsArray | string = "") => {
    const value = typeof slot === "string" ? slot : slot[0];
    return value ? `${base}-${value}` : base;
  };
}
