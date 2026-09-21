export const RESOURCE_PAGE_SIZE_OPTIONS = [20, 40, 100] as const;
export const DEFAULT_RESOURCE_PAGE_SIZE = 20;

export function normalizeResourcePageSize(value?: number | null) {
  return RESOURCE_PAGE_SIZE_OPTIONS.includes(value as (typeof RESOURCE_PAGE_SIZE_OPTIONS)[number])
    ? (value as (typeof RESOURCE_PAGE_SIZE_OPTIONS)[number])
    : DEFAULT_RESOURCE_PAGE_SIZE;
}

export function shouldHideResourcePagination(total: number, pageSize: number) {
  return total <= 20 && total <= normalizeResourcePageSize(pageSize);
}
