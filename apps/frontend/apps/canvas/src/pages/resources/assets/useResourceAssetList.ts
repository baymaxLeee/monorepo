import { useDebounce } from "ahooks";
import { useCallback, useRef, useState } from "react";

import { resource } from "@/domain";
import t from "@/utils/i18n";

import { getResource, listResourceFiles, listResourceFilesPage } from "../domain/actions";
import { DEFAULT_RESOURCE_PAGE_SIZE } from "../domain/paginationRules";

export function useResourceAssetList({
  projectId,
  resourceId,
  item,
  onLoaded,
}: {
  projectId: string;
  resourceId: string;
  item?: resource.Resource;
  onLoaded: (items: resource.ResourceAsset[]) => void;
}) {
  const loadSequenceRef = useRef(0);
  const [files, setFiles] = useState<resource.ResourceAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_RESOURCE_PAGE_SIZE);
  const [currentResource, setCurrentResource] = useState<resource.Resource>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebounce(keyword, { wait: 300 });

  const resourceType = currentResource?.Type ?? item?.Type;
  const materialName = resourceType === resource.ResourceType.CHARACTER ? t("形象") : t("素材");
  const materialNameRef = useRef(materialName);
  materialNameRef.current = materialName;

  const load = useCallback(
    async (showLoading = true) => {
      if (!resourceId) return;
      const sequence = ++loadSequenceRef.current;
      if (showLoading) setLoading(true);
      setError("");
      try {
        const normalizedKeyword = debouncedKeyword.trim().toLocaleLowerCase();
        const [nextResource, nextPage] = await Promise.all([
          getResource(projectId, resourceId),
          normalizedKeyword
            ? listResourceFiles(projectId, resourceId).then((allFiles) => {
                const matchedFiles = allFiles.filter((file) =>
                  file.Name.toLocaleLowerCase().includes(normalizedKeyword),
                );
                const start = (pageNum - 1) * pageSize;
                return {
                  items: matchedFiles.slice(start, start + pageSize),
                  total: matchedFiles.length,
                };
              })
            : listResourceFilesPage(projectId, resourceId, pageNum, pageSize),
        ]);
        if (sequence !== loadSequenceRef.current) return;
        if (pageNum > 1 && !nextPage.items.length && nextPage.total > 0) {
          setPageNum(Math.max(1, Math.ceil(nextPage.total / pageSize)));
          return;
        }
        setCurrentResource(nextResource);
        setFiles(nextPage.items);
        setTotal(nextPage.total);
        onLoaded(nextPage.items);
        return nextPage.items;
      } catch {
        if (sequence !== loadSequenceRef.current) return;
        setError(
          t("{materialName}列表加载失败", {
            materialName: materialNameRef.current,
          }),
        );
        return undefined;
      } finally {
        if (showLoading && sequence === loadSequenceRef.current) setLoading(false);
      }
    },
    [debouncedKeyword, onLoaded, pageNum, pageSize, projectId, resourceId],
  );

  const resetList = () => {
    loadSequenceRef.current += 1;
    setCurrentResource(item);
    setFiles([]);
    setTotal(0);
    setPageNum(1);
    setPageSize(DEFAULT_RESOURCE_PAGE_SIZE);
  };
  const invalidateLoad = () => {
    loadSequenceRef.current += 1;
  };
  return {
    files,
    setFiles,
    total,
    pageNum,
    setPageNum,
    pageSize,
    setPageSize,
    currentResource,
    setCurrentResource,
    loading,
    error,
    setError,
    keyword,
    setKeyword,
    debouncedKeyword,
    load,
    resetList,
    invalidateLoad,
  };
}
