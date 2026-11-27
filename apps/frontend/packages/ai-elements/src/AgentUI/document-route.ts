import { redirectDocument, type LoaderFunctionArgs } from "react-router-dom";

// Each federated remote can bundle its own UI SDK. All routes share the actual
// document lifetime, including the SDK's memory of controls that left the DOM.
export function openAgentUI({ url }: LoaderFunctionArgs) {
  const root = document.documentElement;
  if (root.dataset.agentUiPage && root.dataset.agentUiPage !== url.pathname) return redirectDocument(url.href);
  root.dataset.agentUiPage = url.pathname;
  return null;
}
