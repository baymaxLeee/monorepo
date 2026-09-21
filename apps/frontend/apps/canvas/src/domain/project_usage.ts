// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

export type Int64 = number;

export interface DownloadProjectUsageXLSXRequest {
  /** WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。 */
  WorkspaceID?: string;
  /** ProjectID 是待导出用量的项目唯一标识。 */
  ProjectID: string;
}

export interface DownloadProjectUsageXLSXResponse {
  /** FileName 是浏览器下载时使用的展示文件名。 */
  FileName: string;
  /** DownloadURL 是带鉴权能力的临时下载链接，禁止记录到日志。 */
  DownloadURL: string;
  /** ExpiresAt 是下载链接的 UTC RFC3339Nano 过期时间。 */
  ExpiresAt: string;
  /** RowCount 是 XLSX 中的项目用量明细行数，不包含表头和汇总行。 */
  RowCount: Int64;
  /** FileSize 是 XLSX 文件的字节数。 */
  FileSize: Int64;
  /** PendingBillingCount 是费用尚未最终确定的任务数量。 */
  PendingBillingCount: Int64;
}
/* eslint-enable */
