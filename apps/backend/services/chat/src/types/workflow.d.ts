import "workflow";

declare module "workflow" {
  export function getWritable<T = unknown>(): WritableStream<T>;
}
