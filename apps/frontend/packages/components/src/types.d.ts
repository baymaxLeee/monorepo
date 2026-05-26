declare module "jszip/dist/jszip.min.js" {
  export { default } from "jszip";
}

declare module "simple-mind-map/src/utils/index" {
  export function getTextFromHtml(value: string): string;
  export function isUndef(value: unknown): boolean;
}

declare module "simple-mind-map/src/utils/xmind" {
  export const addSummaryData: any;
  export const getItemByName: any;
  export const getRoot: any;
  export const getSummaryText: any;
  export const getSummaryText2: any;
  export const getXmindContentXmlData: any;
  export const handleNodeImageFromXmind: any;
  export const handleNodeImageToXmind: any;
  export const parseNodeGeneralizationToXmind: any;
}
