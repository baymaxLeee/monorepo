import { cn } from "shared";
import {
  Fullscreen,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import MindMap from "simple-mind-map";
import { Button } from "../../Button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../Tooltip";
import type {
  XMindFullData,
  XMindNode,
  XMindPreviewerProps,
  XMindPreviewerRef,
} from "../interface";
import xmindParser from "./xmindParser";

const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const SCALE_STEP = 0.1;

const isFullData = (
  data?: XMindNode | XMindFullData,
): data is XMindFullData => {
  return Boolean(data && typeof data === "object" && "root" in data);
};

const canUseMindMap = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (
    typeof SVGElement === "undefined" &&
    typeof (window as any).SVGGraphicsElement === "undefined"
  ) {
    return false;
  }
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  return (
    typeof (svgEl as any).getBBox === "function" ||
    typeof (window as any).SVGGraphicsElement?.prototype?.getBBox === "function"
  );
};

const XMindPreviewerInner = forwardRef<XMindPreviewerRef, XMindPreviewerProps>(
  (
    {
      src,
      data,
      file,
      height,
      width = "100%",
      readonly = true,
      layout = "mindMap",
      theme = "default",
      themeConfig,
      fit = true,
      collapsible = true,
      zoomable = true,
      toolbar = true,
      emptyText = "暂无脑图数据",
      loadingText = "脑图文件解析中...",
      errorText = "脑图文件解析失败",
      unsupportedText = "当前环境暂不支持脑图预览",
      onReady,
      onNodeClick,
      onParseSuccess,
      onParseError,
      style,
      className,
    },
    ref,
  ) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const mindMapRef = useRef<MindMap | null>(null);
    const autoFitFrameRef = useRef<number | null>(null);
    const autoFitInnerFrameRef = useRef<number | null>(null);
    const layoutRenderEndHandlerRef = useRef<(() => void) | null>(null);
    const prevEffectiveDataRef = useRef<
      XMindNode | XMindFullData | null | undefined
    >();
    const prevFitRef = useRef(fit);
    const onReadyRef = useRef(onReady);
    const onNodeClickRef = useRef(onNodeClick);
    const onParseSuccessRef = useRef(onParseSuccess);
    const onParseErrorRef = useRef(onParseError);
    const [parsedData, setParsedData] = useState<XMindNode | null>(null);
    const [parseStatus, setParseStatus] = useState<
      "idle" | "loading" | "error"
    >("idle");
    const [viewportScale, setViewportScale] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);

    onReadyRef.current = onReady;
    onNodeClickRef.current = onNodeClick;
    onParseSuccessRef.current = onParseSuccess;
    onParseErrorRef.current = onParseError;

    const supported = useMemo(canUseMindMap, []);
    const effectiveData = file || src ? parsedData : data;
    const normalizedData = effectiveData ?? undefined;
    const hasData = Boolean(
      effectiveData &&
      (isFullData(effectiveData) ? effectiveData.root : effectiveData),
    );
    const canInteract = supported && parseStatus === "idle" && hasData;

    const rootData = useMemo(() => {
      if (!effectiveData) return undefined;
      return isFullData(effectiveData) ? effectiveData.root : effectiveData;
    }, [effectiveData]);

    const syncViewportScale = () => {
      const nextScale = mindMapRef.current?.view?.scale;
      if (typeof nextScale === "number" && Number.isFinite(nextScale)) {
        setViewportScale(nextScale);
      }
    };

    const fitView = () => {
      mindMapRef.current?.view.fit(() => {}, false, undefined);
      window.requestAnimationFrame(syncViewportScale);
    };

    const clearAutoFitFrames = () => {
      if (autoFitFrameRef.current !== null) {
        window.cancelAnimationFrame(autoFitFrameRef.current);
        autoFitFrameRef.current = null;
      }
      if (autoFitInnerFrameRef.current !== null) {
        window.cancelAnimationFrame(autoFitInnerFrameRef.current);
        autoFitInnerFrameRef.current = null;
      }
    };

    const clearLayoutRenderEndHandler = () => {
      if (!mindMapRef.current || !layoutRenderEndHandlerRef.current) {
        return;
      }
      mindMapRef.current.off(
        "node_tree_render_end",
        layoutRenderEndHandlerRef.current,
      );
      layoutRenderEndHandlerRef.current = null;
    };

    const scheduleLayoutAutoFit = (instance: MindMap) => {
      clearLayoutRenderEndHandler();
      const handleRenderEnd = () => {
        instance.off("node_tree_render_end", handleRenderEnd);
        if (layoutRenderEndHandlerRef.current === handleRenderEnd) {
          layoutRenderEndHandlerRef.current = null;
        }
        scheduleAutoFit();
      };
      layoutRenderEndHandlerRef.current = handleRenderEnd;
      instance.on("node_tree_render_end", handleRenderEnd);
    };

    const scheduleAutoFit = () => {
      clearAutoFitFrames();
      autoFitFrameRef.current = window.requestAnimationFrame(() => {
        autoFitInnerFrameRef.current = window.requestAnimationFrame(() => {
          fitView();
          autoFitFrameRef.current = null;
          autoFitInnerFrameRef.current = null;
        });
      });
    };

    const setScaleByStep = (delta: number) => {
      const currentScale = mindMapRef.current?.view?.scale ?? 1;
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Number((currentScale + delta).toFixed(2))),
      );
      mindMapRef.current?.view?.setScale(nextScale, undefined, undefined);
      syncViewportScale();
    };

    const tooltipContainer = isFullscreen ? rootRef.current : null;

    const isRootFullscreen = () => {
      if (!rootRef.current || typeof document === "undefined") {
        return false;
      }

      const fullscreenElement = document.fullscreenElement;
      return Boolean(
        fullscreenElement &&
        (fullscreenElement === rootRef.current ||
          rootRef.current.contains(fullscreenElement)),
      );
    };

    const toggleFullscreen = async () => {
      if (!rootRef.current || typeof document === "undefined") {
        return;
      }

      if (isFullscreen) {
        document.exitFullscreen();
        return;
      }

      rootRef.current.requestFullscreen();
    };

    useEffect(() => {
      if (!file && !src) {
        setParsedData(null);
        setParseStatus("idle");
        return;
      }

      if (!supported) {
        return;
      }

      let cancelled = false;

      const run = async () => {
        setParseStatus("loading");
        try {
          let source: Blob;
          if (file) {
            source = file;
          } else {
            const response = await fetch(src!);
            if (!response.ok) {
              throw new Error(`failed to fetch xmind file: ${response.status}`);
            }
            source = await response.blob();
          }

          const nextData = (await xmindParser.parseXmindFile(
            source,
          )) as XMindNode;
          if (!nextData || typeof nextData !== "object") {
            throw new Error("invalid xmind content");
          }
          if (cancelled) return;
          setParsedData(nextData);
          setParseStatus("idle");
          onParseSuccessRef.current?.(nextData);
        } catch (error) {
          if (cancelled) return;
          setParsedData(null);
          setParseStatus("error");
          onParseErrorRef.current?.(error as Error);
          console.error(error);
        }
      };

      run();

      return () => {
        clearAutoFitFrames();
        clearLayoutRenderEndHandler();
        cancelled = true;
      };
    }, [file, src, supported]);

    useImperativeHandle(
      ref,
      () => ({
        fit: () => {
          fitView();
        },
        resize: () => {
          mindMapRef.current?.resize();
          syncViewportScale();
        },
        zoomIn: () => {
          setScaleByStep(SCALE_STEP);
        },
        zoomOut: () => {
          setScaleByStep(-SCALE_STEP);
        },
        getInstance: () => mindMapRef.current,
        getData: (withConfig = true) => {
          if (!mindMapRef.current) return null;
          return mindMapRef.current.getData(withConfig);
        },
      }),
      [],
    );

    useEffect(() => {
      if (!supported || !canvasRef.current || !rootData) {
        return;
      }

      const instance = new MindMap({
        el: canvasRef.current,
        data: rootData,
        layout: isFullData(normalizedData)
          ? (normalizedData.layout ?? layout)
          : layout,
        theme: isFullData(normalizedData)
          ? (normalizedData.theme?.template ?? theme)
          : theme,
        themeConfig: isFullData(normalizedData)
          ? (normalizedData.theme?.config ?? themeConfig ?? {})
          : (themeConfig ?? {}),
        readonly,
        fit,
        disableMouseWheelZoom: !zoomable,
        notShowExpandBtn: !collapsible,
      } as any);

      const handleNodeClick = (node: any, event: MouseEvent) => {
        onNodeClickRef.current?.({
          node,
          data: node?.nodeData?.data,
          event,
        });
      };
      const handleScaleChange = (scale?: number) => {
        if (typeof scale === "number" && Number.isFinite(scale)) {
          setViewportScale(scale);
          return;
        }
        syncViewportScale();
      };

      instance.on("node_click", handleNodeClick);
      instance.on("scale", handleScaleChange);
      if (isFullData(normalizedData)) {
        instance.setFullData(normalizedData);
      }

      mindMapRef.current = instance;
      syncViewportScale();
      onReadyRef.current?.(instance);

      return () => {
        instance.off("node_click", handleNodeClick);
        instance.off("scale", handleScaleChange);
        instance.destroy();
        mindMapRef.current = null;
        clearAutoFitFrames();
        clearLayoutRenderEndHandler();
      };
    }, [supported, hasData]);

    useEffect(() => {
      const instance = mindMapRef.current;
      if (!instance) return;
      let layoutChanged = false;
      const dataChanged = prevEffectiveDataRef.current !== effectiveData;
      const fitEnabled = fit && !prevFitRef.current;

      instance.updateConfig({
        readonly,
        fit,
        disableMouseWheelZoom: !zoomable,
        notShowExpandBtn: !collapsible,
      });

      if (isFullData(normalizedData)) {
        instance.setFullData(normalizedData);
      } else if (effectiveData) {
        instance.setData(effectiveData);
        if (instance.getLayout() !== layout) {
          instance.setLayout(layout);
          layoutChanged = true;
        }
        if (instance.getTheme() !== theme) {
          instance.setTheme(theme);
        }
        instance.setThemeConfig(themeConfig ?? {});
      }

      if (fit) {
        if (layoutChanged) {
          scheduleLayoutAutoFit(instance);
        } else if (dataChanged || fitEnabled) {
          clearLayoutRenderEndHandler();
          scheduleAutoFit();
        }
      } else {
        clearAutoFitFrames();
        clearLayoutRenderEndHandler();
        syncViewportScale();
      }

      prevEffectiveDataRef.current = effectiveData;
      prevFitRef.current = fit;
    }, [
      effectiveData,
      layout,
      theme,
      themeConfig,
      readonly,
      fit,
      zoomable,
      collapsible,
    ]);

    useEffect(() => {
      if (!supported || !rootRef.current) {
        return;
      }

      const handleResize = () => {
        const instance = mindMapRef.current;
        if (!instance) return;
        instance.resize();
        if (fit) {
          clearLayoutRenderEndHandler();
          scheduleAutoFit();
        } else {
          clearAutoFitFrames();
          clearLayoutRenderEndHandler();
          syncViewportScale();
        }
      };

      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", handleResize);
        };
      }

      const observer = new ResizeObserver(handleResize);
      observer.observe(rootRef.current);

      return () => {
        clearAutoFitFrames();
        clearLayoutRenderEndHandler();
        observer.disconnect();
      };
    }, [supported, fit]);

    useEffect(() => {
      if (typeof document === "undefined") {
        return;
      }

      const handleFullscreenChange = () => {
        setIsFullscreen(isRootFullscreen());
      };

      handleFullscreenChange();
      document.addEventListener("fullscreenchange", handleFullscreenChange);

      return () => {
        document.removeEventListener(
          "fullscreenchange",
          handleFullscreenChange,
        );
      };
    }, []);

    return (
      <div
        ref={rootRef}
        style={{ ...style, width, height }}
        className={cn(
          "relative overflow-hidden rounded-md border bg-background",
          className,
        )}
      >
        {toolbar ? (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
            <ToolbarGroup>
              <ToolbarIconButton
                icon={Minus}
                label="缩小"
                disabled={!canInteract || !zoomable}
                tooltipContainer={tooltipContainer}
                onClick={() => setScaleByStep(-SCALE_STEP)}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="h-7 min-w-12 rounded-none px-2 font-mono text-xs disabled:opacity-100"
              >
                {Math.round(viewportScale * 100)}%
              </Button>
              <ToolbarIconButton
                icon={Plus}
                label="放大"
                disabled={!canInteract || !zoomable}
                tooltipContainer={tooltipContainer}
                onClick={() => setScaleByStep(SCALE_STEP)}
              />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarIconButton
                icon={Scan}
                label="适配画布"
                disabled={!canInteract}
                tooltipContainer={tooltipContainer}
                onClick={fitView}
              />
              <ToolbarIconButton
                icon={Maximize2}
                label="全部展开"
                disabled={!canInteract || !collapsible}
                tooltipContainer={tooltipContainer}
                onClick={() => mindMapRef.current?.renderer?.expandAllNode()}
              />
              <ToolbarIconButton
                icon={Minimize2}
                label="全部收起"
                disabled={!canInteract || !collapsible}
                tooltipContainer={tooltipContainer}
                onClick={() => mindMapRef.current?.renderer?.unexpandAllNode()}
              />
              <ToolbarIconButton
                icon={Fullscreen}
                label={isFullscreen ? "退出全屏" : "全屏"}
                disabled={!canInteract}
                tooltipContainer={tooltipContainer}
                onClick={() => void toggleFullscreen()}
              />
            </ToolbarGroup>
          </div>
        ) : null}
        <div ref={canvasRef} className="size-full" />
        {(!supported ||
          parseStatus !== "idle" ||
          (parseStatus === "idle" && !hasData)) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {!supported
              ? unsupportedText
              : parseStatus === "loading"
                ? loadingText
                : parseStatus === "error"
                  ? errorText
                  : emptyText}
          </div>
        )}
      </div>
    );
  },
);

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex divide-x divide-border overflow-hidden rounded-md border bg-background shadow-sm">
      {children}
    </div>
  );
}

interface ToolbarIconButtonProps {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  tooltipContainer?: HTMLElement | null;
}

function ToolbarIconButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  tooltipContainer,
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          className="size-7 rounded-none p-0"
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent container={tooltipContainer}>{label}</TooltipContent>
    </Tooltip>
  );
}

XMindPreviewerInner.displayName = "XMindPreviewerInner";

export default XMindPreviewerInner;
