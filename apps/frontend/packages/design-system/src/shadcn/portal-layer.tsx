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

function useModalLayer(): PortalLayer {
  const parentLayer = useContext(PortalLayerContext);
  const modalZIndex = parentLayer ? parentLayer.modalZIndex + MODAL_LAYER_STEP : DEFAULT_MODAL_Z_INDEX;
  return {
    modalZIndex,
    popupZIndex: modalZIndex + POPUP_LAYER_OFFSET,
  };
}

type StatefulStyle<State> = CSSProperties | ((state: State) => CSSProperties | undefined);

function withLayerZIndex<State>(style: StatefulStyle<State> | undefined, zIndex: number): StatefulStyle<State> {
  if (typeof style === "function") {
    return (state) => {
      const resolved = style(state);
      return resolved?.zIndex === undefined ? { ...resolved, zIndex } : resolved;
    };
  }
  return style?.zIndex === undefined ? { ...style, zIndex } : style;
}

function useModalLayerStyle<State>(style: StatefulStyle<State> | undefined, zIndex: number) {
  return withLayerZIndex(style, zIndex);
}

function usePortalLayerStyle<State>(style?: StatefulStyle<State>) {
  const layer = useContext(PortalLayerContext);
  if (!layer) return style;
  return withLayerZIndex(style, layer.popupZIndex);
}

export { ModalLayerProvider, useModalLayer, useModalLayerStyle, usePortalLayerStyle };
