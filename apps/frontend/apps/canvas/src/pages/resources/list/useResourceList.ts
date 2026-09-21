import { useDebounce } from "ahooks";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { agentframeService } from "@/api";
import type { resource } from "@/domain";

import { getProjectResourceStats, listResources } from "../domain/actions";
import { parseResourceListRouteState, writeResourceListRouteState } from "../domain/routeState";

export function useResourceList(projectId: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearch = searchParams.toString();
  const canonicalSearch = writeResourceListRouteState(searchParams, {}).toString();
  const { page: pageNum, pageSize, type: selectedType } = parseResourceListRouteState(searchParams);
  const [resourceStats, setResourceStats] = useState<resource.ProjectResourceStats>();
  const [keyword, setKeyword] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const listSequenceRef = useRef(0);
  const [items, setItems] = useState<resource.Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const debouncedKeyword = useDebounce(keyword, { wait: 300 });
  const isSearching = Boolean(keyword.trim());
  const searchResultCountReady = isSearching && !loading && keyword.trim() === debouncedKeyword.trim();
  const refresh = () => setRefreshVersion((value) => value + 1);
  useEffect(() => {
    if (currentSearch !== canonicalSearch) {
      setSearchParams(canonicalSearch, { replace: true });
    }
  }, [canonicalSearch, currentSearch, setSearchParams]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void getProjectResourceStats(agentframeService, projectId)
      .then((stats) => {
        if (active) setResourceStats(stats);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId, refreshVersion, selectedType]);

  useEffect(() => {
    if (!projectId) return;
    const sequence = ++listSequenceRef.current;
    setLoading(true);
    setError(undefined);
    void listResources(agentframeService, projectId, {
      keyword: debouncedKeyword,
      ascending: false,
      pageNum,
      pageSize,
      type: selectedType,
    })
      .then((response) => {
        if (sequence !== listSequenceRef.current) return;
        if (pageNum > 1 && !response.items.length && response.total > 0) {
          setSearchParams(
            (current) =>
              writeResourceListRouteState(current, {
                page: Math.max(1, Math.ceil(response.total / pageSize)),
              }),
            { replace: true },
          );
          return;
        }
        setItems(response.items);
        setTotal(response.total);
      })
      .catch((reason) => {
        if (sequence !== listSequenceRef.current) return;
        setItems([]);
        setTotal(0);
        setError(reason);
      })
      .finally(() => {
        if (sequence === listSequenceRef.current) setLoading(false);
      });
    return () => {
      listSequenceRef.current += 1;
    };
  }, [debouncedKeyword, pageNum, pageSize, projectId, refreshVersion, selectedType, setSearchParams]);

  return {
    debouncedKeyword,
    pageNum,
    pageSize,
    selectedType,
    setSearchParams,
    keyword,
    setKeyword,
    refresh,
    resourceStats,
    items,
    total,
    loading,
    error,
    isSearching,
    searchResultCountReady,
  };
}
