import { ResourceGenerationStatus } from "./ResourceGenerationStatus";

export function ResourceGenerationFailureStatus({ fileName }: { fileName: string }) {
  return <ResourceGenerationStatus fileName={fileName} status="failed" variant="card" />;
}
