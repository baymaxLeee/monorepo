// Composer controls sit inside an already-bordered surface. Keep keyboard focus
// visible without stacking shadcn's default 3px ring on that surrounding border.
export const composerControlClassName =
  "focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-ring/40";

export const composerSurfaceClassName =
  "has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/40";
