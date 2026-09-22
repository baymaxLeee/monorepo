import { getAdminService, type UpdateCanvasSettings } from "../generated/admin-server/index";
export type {
  CanvasSettings,
  CanvasDefaults,
  CanvasModelParameters,
} from "../generated/admin-server/index";
export type { CanvasModelSelection as AdminCanvasModelSelection } from "../generated/admin-server/index";
export function fetchCanvasSettings() {
  return getAdminService().getCanvasSettings({ baseURL: "/api/admin-server" });
}
export function saveCanvasSettings(input: UpdateCanvasSettings) {
  return getAdminService().updateCanvasSettings(input, { baseURL: "/api/admin-server" });
}
