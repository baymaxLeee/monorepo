/**
 * 生成 BEM-style class 模板函数：`bem("foo")\`bar\`` → `"foo-bar"`，
 * `bem("foo")\`\`` 或 `bem("foo")()` → `"foo"`。
 *
 * 提取自原 paas-cloud-material 的 `eaClassNamePrefixFactory`，本仓里仅作为
 * 衔接 ProseMirror 节点 / 全局 less 选择器与 React class 拼装的工具。
 */
export function bemClassFactory(base: string) {
  return (slot: TemplateStringsArray | string = "") => {
    const value = typeof slot === "string" ? slot : slot[0];
    return value ? `${base}-${value}` : base;
  };
}
