// shadcn/ui primitives (see ./shadcn). Re-exported wholesale so consumers keep
// importing from `components`. New primitives added via the shadcn CLI only need
// one line in ./shadcn/index.ts.

// `toast` is the imperative API from the sonner package (our Toaster wrapper
// lives in ./shadcn/sonner and is re-exported above).
export { toast } from "sonner";
export {
  ErrorBoundary,
  type ErrorBoundaryFallback,
  type ErrorBoundaryProps,
  type ErrorFallbackProps,
  type WithErrorBoundaryOptions,
  withErrorBoundary,
} from "./ErrorBoundary";
export { FileIcon, type FileIconProps, getFileIcon } from "./FileIcon";
export {
  ImagePreview,
  type ImagePreviewItem,
  type ImagePreviewProps,
  useImagePreview,
} from "./ImagePreview";
export type { LazyBaseProps, LazyLoader } from "./Lazy";
export { Lazy } from "./Lazy";
export {
  Aside,
  Header,
  HeaderSection,
  InlineCode,
  Layout,
  Main,
  Muted,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Section,
  SiteHeader,
  SiteHeaderActions,
  SiteHeaderBrand,
  SiteHeaderNav,
} from "./layout";
export * from "./shadcn";
