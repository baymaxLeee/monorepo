import t from "@/utils/i18n";

const MAX_CANVAS_NODE_NAME_LENGTH = 50;

export function validateCanvasNodeName(name: string) {
  const characters = [...name];
  if (characters.length < 1) return t("请输入节点名称");
  if (characters.length > MAX_CANVAS_NODE_NAME_LENGTH) {
    return t("节点名称不能超过 50 个字符");
  }
  const invalidBoundary = (character: string) => character === "-" || character === "_" || /\s/u.test(character);
  if (invalidBoundary(characters[0]) || invalidBoundary(characters[characters.length - 1])) {
    return t("节点名称不能以连接符或空格开头或结尾");
  }
  return "";
}
