// Source presentation model retained for the imported UI. Network calls use @repo/api OpenAPI clients.

import { CanvasBenefitPackageScopeType as BenefitPackageScopeType } from "@repo/api";

export { BenefitPackageScopeType };

export type Int64 = number;

/** BenefitPackage 是高级创作使用的权益包。预置与自定义权益包共享同一数据模型。 */
export interface BenefitPackage {
  PackageID: string;
  IsPreset: boolean;
  Name: string;
  ProjectName: string;
  /** HasAccessKeyID 仅表示 AK 已配置；服务端永不返回明文或密文。 */
  HasAccessKeyID: boolean;
  /** HasSecretAccessKey 仅表示密钥已配置；服务端永不返回 Secret Access Key 明文或密文。 */
  HasSecretAccessKey: boolean;
  Enabled: boolean;
  /** ModelIDs 仅用于自定义权益包，逐项保存生效的视频模型。 */
  ModelIDs: Array<string>;
  /** MaterialUsed 是使用该权益包完成送审的素材数量，只读且由送审记录聚合得到。 */
  MaterialUsed: Int64;
  Revision: Int64;
  CreatedBy: string;
  UpdatedBy: string;
  CreatedAt: string;
  UpdatedAt: string;
  /** SYSTEM_PRESET_MODELS 是动态范围，自动覆盖当前及未来全部系统预制模型。 */
  ScopeType: BenefitPackageScopeType;
}
