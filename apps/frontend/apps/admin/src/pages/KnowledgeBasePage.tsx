import {
  batchDeleteKnowledgeDocuments,
  deleteKnowledgeDocument,
  fetchKnowledgeDocumentSource,
  type KnowledgeDocument,
  listKnowledgeDocuments,
  uploadKnowledgeDocuments,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Muted,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "components";
import { DownloadIcon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage, randomId } from "shared";
import { KnowledgeDocumentDialog } from "../components/KnowledgeDocumentDialog";

function formatBytes(size: number): string {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function statusBadge(doc: KnowledgeDocument) {
  const status = doc.ingest_status ?? "ready";
  if (status === "failed") return <Badge variant="destructive">失败</Badge>;
  if (status === "ready") return <Badge variant="outline">就绪</Badge>;
  return <Badge variant="secondary">处理中</Badge>;
}

export function KnowledgeBasePage() {
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listKnowledgeDocuments({ kind: "source" }, { skipErrorNotify: true })
      .then((rows) => {
        setDocs(rows);
        setSelected(new Set());
      })
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).map((file) => ({
      clientRef: randomId(),
      file,
    }));
    setUploading(true);
    let succeeded = 0;
    try {
      await uploadKnowledgeDocuments(files, {
        onEvent: (event) => {
          if (event.type === "file_ready") succeeded += 1;
          else if (event.type === "file_failed") {
            toast.error(`导入失败：${event.error}`);
          }
        },
      });
      if (succeeded > 0) toast.success(`成功导入 ${succeeded} 个文档`);
    } catch (e) {
      // 上传走 fetch/SSE 流(不经 axios 拦截器),错误在此提示
      toast.error(getErrorMessage(e));
    } finally {
      setUploading(false);
      load();
    }
  }

  async function download(doc: KnowledgeDocument) {
    try {
      const blob = await fetchKnowledgeDocumentSource(doc.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.source_filename || doc.filename || doc.title;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {}
  }

  async function remove(doc: KnowledgeDocument) {
    if (!window.confirm(`确认删除「${doc.title}」？`)) return;
    try {
      await deleteKnowledgeDocument(doc.id);
      toast.success("已删除");
      load();
    } catch {}
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(`确认删除选中的 ${ids.length} 个文档？此操作不可恢复。`)
    ) {
      return;
    }
    try {
      const res = await batchDeleteKnowledgeDocuments(ids);
      toast.success(`已删除 ${res.deleted} 个文档`);
      load();
    } catch {}
  }

  const allSelected =
    docs !== null && docs.length > 0 && selected.size === docs.length;

  function toggleAll() {
    if (!docs) return;
    setSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>知识库管理</PageTitle>
          <PageDescription>
            上传企业文档（接受任意格式，自动转换为 Markdown
            并建立检索索引）。支持本地导入、列表查询、批量删除、单个下载与在线编辑。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button
            variant="outline"
            onClick={removeSelected}
            disabled={selected.size === 0}
          >
            <Trash2Icon className="size-4" />
            批量删除{selected.size > 0 ? `（${selected.size}）` : ""}
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <UploadIcon className="size-4" />
            {uploading ? "导入中…" : "本地导入"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>企业文档</CardTitle>
          <CardDescription>
            {loading ? "加载中…" : docs ? `共 ${docs.length} 篇` : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : docs && docs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>文件名</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(doc.id)}
                        onCheckedChange={() => toggle(doc.id)}
                        aria-label={`选择 ${doc.title}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{doc.title}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {doc.filename}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(doc.source_size)}
                    </TableCell>
                    <TableCell>{statusBadge(doc)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(doc.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setEditingId(doc.id)}
                      >
                        <PencilIcon className="size-3.5" />
                        阅览/编辑
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => download(doc)}
                      >
                        <DownloadIcon className="size-3.5" />
                        下载
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => remove(doc)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>
              还没有任何文档。点击「本地导入」上传企业文档，构建你的知识库。
            </Muted>
          )}
        </CardContent>
      </Card>

      <KnowledgeDocumentDialog
        documentId={editingId}
        onOpenChange={(open) => !open && setEditingId(null)}
        onSaved={load}
      />
    </Page>
  );
}
