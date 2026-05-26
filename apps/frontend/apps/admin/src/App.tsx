import { useRoutes } from "react-router-dom";
import { TooltipProvider } from "components";
import { routes } from "./router";

export default function App() {
  return <TooltipProvider>{useRoutes(routes)}</TooltipProvider>;
}
