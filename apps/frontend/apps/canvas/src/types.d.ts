declare module "*.css";
declare module "*.png" {
  const source: string;
  export default source;
}

declare module "*.module.less" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.svg" {
  const source: string;
  export default source;
}
