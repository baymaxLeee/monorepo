import { getAdminService, type UpdateCanvasSettings } from "../generated/admin-server/index";
export type {
  CanvasSettings,
  CanvasDefaults,
  CanvasModelSelection,
  CanvasModelParameters,
} from "../generated/admin-server/index";
export function fetchCanvasSettings() {
  return getAdminService().getCanvasSettings({ baseURL: "/api/admin-server" });
}
export function saveCanvasSettings(input: UpdateCanvasSettings) {
  return getAdminService().updateCanvasSettings(input, { baseURL: "/api/admin-server" });
}
