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

export interface CreateCustomBenefitPackageRequest {
  Name: string;
  ProjectName: string;
  AccessKeyID: string;
  SecretAccessKey: string;
  Enabled: boolean;
  ModelIDs: Array<string>;
}

export interface CreateCustomBenefitPackageResponse {
  Package: BenefitPackage;
}

export interface CreatePresetBenefitPackageRequest {
  AccessKeyID: string;
  SecretAccessKey: string;
}

export interface CreatePresetBenefitPackageResponse {
  Package: BenefitPackage;
}

export interface DeleteCustomBenefitPackageRequest {
  PackageID: string;
  ExpectedRevision: Int64;
  /** 省略或 false 仅使本地审核结果失效；true 还会清理外部 provider 已审核素材。 */
  DeleteExternalReviewedAssets?: boolean;
}

export interface GetPresetBenefitPackageRequest {}

export interface GetPresetBenefitPackageResponse {
  Package?: BenefitPackage;
  /** MaterialLimit 是 IAM 为当前租户配置的预置权益包素材数限额；Package 存在时返回。
optional 仅用于兼容滚动发布窗口内的旧 Server，调用方不得回退为固定值。 */
  MaterialLimit?: Int64;
}

export interface ListAvailableBenefitPackagesRequest {}

export interface ListAvailableBenefitPackagesResponse {
  Items: Array<BenefitPackage>;
}

export interface ListCustomBenefitPackagesRequest {}

export interface ListCustomBenefitPackagesResponse {
  Items: Array<BenefitPackage>;
}

export interface SetPresetBenefitPackageEnabledRequest {
  PackageID: string;
  Enabled: boolean;
  ExpectedRevision: Int64;
}

export interface SetPresetBenefitPackageEnabledResponse {
  Package: BenefitPackage;
}

export interface UpdateCustomBenefitPackageRequest {
  PackageID: string;
  Name: string;
  ProjectName: string;
  /** AccessKeyID 和 SecretAccessKey 省略时分别保留现有密钥。 */
  AccessKeyID?: string;
  SecretAccessKey?: string;
  Enabled: boolean;
  ModelIDs: Array<string>;
  ExpectedRevision: Int64;
}

export interface UpdateCustomBenefitPackageResponse {
  Package: BenefitPackage;
}

export interface UpdatePresetBenefitPackageRequest {
  PackageID: string;
  /** AccessKeyID 和 SecretAccessKey 省略时分别保留现有密钥。 */
  AccessKeyID?: string;
  SecretAccessKey?: string;
  ExpectedRevision: Int64;
}

export interface UpdatePresetBenefitPackageResponse {
  Package: BenefitPackage;
}
/* eslint-enable */
