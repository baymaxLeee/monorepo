import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

/** Match platform host mount: `/platform/admin/*` */
const ADMIN_BASENAME = "/platform/admin";

createRoot(container).render(
  <BrowserRouter basename={ADMIN_BASENAME}>
    <div
      style={{
        padding: 16,
        background: "#fef3c7",
        marginBottom: 8,
        fontFamily: "system-ui",
      }}
    >
      Running <strong>admin</strong> standalone — open via platform (:3000) for
      Tailwind styles, or styles will be unstyled here.
    </div>
    <App />
  </BrowserRouter>,
);
