import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { track } from "../api";

let installed = false;

export function installWebVitals(): void {
  if (installed) return;
  installed = true;
  const report = (metric: Metric) => {
    track("perform", {
      metric: metric.name.toLowerCase(),
      rating: metric.rating,
      value: metric.value,
    });
  };
  onCLS(report);
  onFCP(report);
  onINP(report);
  onLCP(report);
  onTTFB(report);
}
