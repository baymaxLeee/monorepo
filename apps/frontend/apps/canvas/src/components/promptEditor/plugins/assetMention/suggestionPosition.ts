interface AnchorRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export function getSuggestionPosition({
  anchorRect,
  popupHeight,
  popupWidth,
  viewportHeight,
  viewportPadding = 12,
  viewportWidth,
}: {
  anchorRect: AnchorRect;
  popupHeight: number;
  popupWidth: number;
  viewportHeight: number;
  viewportPadding?: number;
  viewportWidth: number;
}) {
  const fitsToAnchorRight = anchorRect.left + popupWidth <= viewportWidth - viewportPadding;
  const fitsToAnchorLeft = anchorRect.right - popupWidth >= viewportPadding;
  const left = fitsToAnchorRight
    ? anchorRect.left
    : fitsToAnchorLeft
      ? anchorRect.right - popupWidth
      : Math.max(viewportPadding, Math.min(anchorRect.left, viewportWidth - popupWidth - viewportPadding));
  const preferredTop = anchorRect.bottom + 8;
  const top =
    preferredTop + popupHeight <= viewportHeight - viewportPadding
      ? preferredTop
      : Math.max(viewportPadding, anchorRect.top - popupHeight - 8);

  return { left, top };
}
