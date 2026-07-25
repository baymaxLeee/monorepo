import { fetchKnowledgeDocument, updateKnowledgeDocument } from "api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  toast,
} from "components";
import { MarkdownEditor } from "components/markdown-editor";
import { useEffect, useState } from "react";

export interface KnowledgeDocumentDialogProps {
  /** Non-null id opens the dialog and loads that document. */
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * View + edit a knowledge document. The body is rendered/edited as Markdown via
 * the shared MarkdownEditor; saving re-indexes the RAG store server-side.
 */
export function KnowledgeDocumentDialog({ documentId, onOpenChange, onSaved }: KnowledgeDocumentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!documentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchKnowledgeDocument(documentId)
      .then((doc) => {
        if (cancelled) {
          return;
        }
        setTitle(doc.title);
        setFilename(doc.filename);
        setContent(doc.content_md ?? "");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function save() {
    if (!documentId) {
      return;
    }
    setSaving(true);
    try {
      await updateKnowledgeDocument(documentId, {
        title: title.trim() || filename,
        content_md: content,
      });
      toast.success("文档已保存，知识库索引已更新");
      onSaved();
      onOpenChange(false);
    } catch {
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(documentId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>阅览 / 编辑文档</DialogTitle>
          <DialogDescription>正文以 Markdown 呈现与编辑；保存后知识库会自动重建检索索引（时效性）。</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex-1 space-y-3">
            <Skeleton className="h-9 w-1/2" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
            <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
              <MarkdownEditor
                value={content}
                contentType="markdown"
                editable
                onChange={setContent}
                className="h-full w-full"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={save} disabled={loading || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
