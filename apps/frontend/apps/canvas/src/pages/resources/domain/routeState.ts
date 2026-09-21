import { resource } from "@/domain";

import { normalizeResourcePageSize } from "./paginationRules";

const DEFAULT_PAGE = 1;

const RESOURCE_TYPE_BY_PARAM: Record<string, resource.ResourceType> = {
  audio: resource.ResourceType.AUDIO,
  character: resource.ResourceType.CHARACTER,
  prop: resource.ResourceType.PROP,
  scene: resource.ResourceType.SCENE,
};

export interface ResourceListRouteState {
  page: number;
  pageSize: number;
  type: resource.ResourceType;
}

function parsePositiveInteger(value: string | null) {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
}

function serializeResourceType(type: resource.ResourceType) {
  switch (type) {
    case resource.ResourceType.SCENE:
      return "scene";
    case resource.ResourceType.PROP:
      return "prop";
    case resource.ResourceType.AUDIO:
      return "audio";
    default:
      return "character";
  }
}

export function parseResourceListRouteState(searchParams: URLSearchParams): ResourceListRouteState {
  return {
    page: parsePositiveInteger(searchParams.get("page")) ?? DEFAULT_PAGE,
    pageSize: normalizeResourcePageSize(parsePositiveInteger(searchParams.get("pageSize"))),
    type: RESOURCE_TYPE_BY_PARAM[searchParams.get("type") ?? ""] ?? resource.ResourceType.CHARACTER,
  };
}

export function writeResourceListRouteState(searchParams: URLSearchParams, patch: Partial<ResourceListRouteState>) {
  const current = parseResourceListRouteState(searchParams);
  const next = { ...current, ...patch };
  const result = new URLSearchParams(searchParams);
  result.set("type", serializeResourceType(next.type));
  result.set("page", String(next.page > 0 ? Math.floor(next.page) : DEFAULT_PAGE));
  result.set("pageSize", String(normalizeResourcePageSize(next.pageSize)));
  return result;
}
