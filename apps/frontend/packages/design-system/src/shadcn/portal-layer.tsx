import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";

// Match the established Arco/Ant Design modal baseline while keeping the value
// private to the design system. Consumers express relationships, not numbers.
const DEFAULT_MODAL_Z_INDEX = 1000;
const MODAL_LAYER_STEP = 100;
const POPUP_LAYER_OFFSET = 50;

interface PortalLayer {
  modalZIndex: number;
  popupZIndex: number;
}

const PortalLayerContext = createContext<PortalLayer | undefined>(undefined);

function ModalLayerProvider({ children, layer }: { children: ReactNode; layer: PortalLayer }) {
  return <PortalLayerContext.Provider value={layer}>{children}</PortalLayerContext.Provider>;
}

function useModalLayer({ popupZIndex, zIndex }: { popupZIndex?: number; zIndex?: number } = {}): PortalLayer {
  const parentLayer = useContext(PortalLayerContext);
  const modalZIndex = zIndex ?? (parentLayer ? parentLayer.modalZIndex + MODAL_LAYER_STEP : DEFAULT_MODAL_Z_INDEX);
  return {
    modalZIndex,
    popupZIndex: popupZIndex ?? modalZIndex + POPUP_LAYER_OFFSET,
  };
}

function usePortalLayerStyle(style?: CSSProperties) {
  const layer = useContext(PortalLayerContext);
  if (!layer || style?.zIndex !== undefined) return style;
  return { ...style, zIndex: layer.popupZIndex };
}

export { ModalLayerProvider, useModalLayer, usePortalLayerStyle };
