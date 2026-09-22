// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import { CanvasSortDirection as SortDirection } from "@repo/api";

export { SortDirection };

export type Int64 = number;

/** Page 是列表请求的标准分页参数。 */
export interface Page {
  /** PageSize 是每页返回数量。 */
  PageSize: number;
  /** PageNum 是从 1 开始的页码。 */
  PageNum: number;
}

/** PageOutput 是列表响应的标准分页信息。 */
export interface PageOutput {
  /** PageSize 是请求的每页数量。 */
  PageSize: number;
  /** PageNum 是请求的当前页码。 */
  PageNum: number;
  /** Total 是符合条件的记录总数。 */
  Total: Int64;
  /** TotalPage 是按 PageSize 计算的总页数。 */
  TotalPage: Int64;
}
/* eslint-enable */
