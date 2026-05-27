import { Badge, PdfPreviewer } from "components";
import { DemoCard } from "../DemoCard";

const pdfWorkerSrc =
  "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs";

const demoPdfUrl =
  "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";

export function PdfPreviewerTab() {
  return (
    <DemoCard
      title="PdfPreviewer"
      description="远程 PDF（pdf.js TraceMonkey 论文），展示页码、缩放、缩略图与关键字高亮"
      fill
    >
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
        <PdfPreviewer
          file={demoPdfUrl}
          workerSrc={pdfWorkerSrc}
          height="100%"
          defaultSidebar="thumbnail"
          highlights={[
            {
              id: "summary-keyword",
              keyword: "TraceMonkey",
            },
          ]}
          toolbarExtraRender={() => (
            <Badge variant="secondary">mozilla.github.io</Badge>
          )}
        />
      </div>
    </DemoCard>
  );
}
