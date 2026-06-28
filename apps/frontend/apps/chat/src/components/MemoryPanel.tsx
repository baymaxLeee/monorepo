import type { MemoryCandidate, MemoryCategory, UserMemory } from "api";
import { Badge, Button, Textarea, toast } from "components";
import { MessageResponse } from "components/ai-chat";
import { useEffect, useState } from "react";
import { useMemoryStore } from "../store/useMemoryStore";

export interface MemoryPanelProps {
  open: boolean;
}

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "偏好",
  profile: "档案",
  project: "项目",
  instruction: "指令",
};

const CATEGORY_ORDER: MemoryCategory[] = [
  "preference",
  "profile",
  "project",
  "instruction",
];

export function MemoryPanel({ open }: MemoryPanelProps) {
  const {
    candidates,
    memories,
    loading,
    loaded,
    error,
    refresh,
    approve,
    reject,
    edit,
    remove,
  } = useMemoryStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleApprove = async (id: string) => {
    setPendingActionId(id);
    try {
      await approve(id);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPendingActionId(null);
    }
  };

  const handleReject = async (id: string) => {
    setPendingActionId(id);
    try {
      await reject(id);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPendingActionId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setPendingActionId(id);
    try {
      await remove(id);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPendingActionId(null);
    }
  };

  const handleSaveEdit = (
    id: string,
    patch: { category?: MemoryCategory; content?: string },
  ) => {
    void edit(id, patch)
      .then(() => setEditingId(null))
      .catch((err) => toast.error(String(err)));
  };

  const renderCandidate = (candidate: MemoryCandidate) => {
    if (editingId === candidate.id) {
      return (
        <CandidateEditor
          key={candidate.id}
          candidate={candidate}
          onCancel={() => setEditingId(null)}
          onSave={(patch) => handleSaveEdit(candidate.id, patch)}
        />
      );
    }
    return (
      <div
        key={candidate.id}
        className="space-y-2 rounded-md border bg-muted/30 p-3"
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {CATEGORY_LABELS[candidate.category]}
          </Badge>
          {candidate.supersedesId ? (
            <Badge variant="outline" className="text-[10px]">
              更新已有记忆
            </Badge>
          ) : null}
        </div>
        <MessageResponse className="text-sm leading-relaxed">
          {candidate.content}
        </MessageResponse>
        {candidate.reason ? (
          <div className="text-xs text-muted-foreground">
            <span>理由：</span>
            <MessageResponse className="inline text-xs">
              {candidate.reason}
            </MessageResponse>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={pendingActionId === candidate.id}
            onClick={() => void handleApprove(candidate.id)}
          >
            记住
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pendingActionId === candidate.id}
            onClick={() => setEditingId(candidate.id)}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pendingActionId === candidate.id}
            onClick={() => void handleReject(candidate.id)}
          >
            忽略
          </Button>
        </div>
      </div>
    );
  };

  const renderMemory = (memory: UserMemory) => (
    <div
      key={memory.id}
      className="flex items-start justify-between gap-2 rounded-md border bg-background px-3 py-2"
    >
      <div className="min-w-0 space-y-1">
        <Badge variant="outline" className="text-[10px]">
          {CATEGORY_LABELS[memory.category]}
        </Badge>
        <MessageResponse className="text-sm leading-relaxed">
          {memory.content}
        </MessageResponse>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        disabled={pendingActionId === memory.id}
        onClick={() => void handleRemove(memory.id)}
      >
        删除
      </Button>
    </div>
  );

  const renderPending = () => (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">待确认</h3>
        {candidates.length > 0 ? (
          <Badge variant="secondary" className="text-[10px]">
            {candidates.length}
          </Badge>
        ) : null}
      </div>
      {candidates.length > 0 ? (
        <div className="space-y-2">{candidates.map(renderCandidate)}</div>
      ) : (
        <p className="text-xs text-muted-foreground">
          暂无待确认的记忆。对话后系统会自动整理候选项。
        </p>
      )}
    </section>
  );

  const renderActive = () => (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">已记住</h3>
      {memories.length > 0 ? (
        <div className="space-y-2">{memories.map(renderMemory)}</div>
      ) : (
        <p className="text-xs text-muted-foreground">还没有长期记忆。</p>
      )}
    </section>
  );

  if (loading && !loaded) {
    return <div className="p-4 text-xs text-muted-foreground">加载记忆...</div>;
  }

  if (error && !loaded) {
    return <div className="p-4 text-xs text-destructive">{error}</div>;
  }

  return (
    <div className="space-y-5 p-4">
      {renderPending()}
      {renderActive()}
    </div>
  );
}

function CandidateEditor({
  candidate,
  onCancel,
  onSave,
}: {
  candidate: MemoryCandidate;
  onCancel: () => void;
  onSave: (patch: { category: MemoryCategory; content: string }) => void;
}) {
  const [content, setContent] = useState(candidate.content);
  const [category, setCategory] = useState<MemoryCategory>(candidate.category);
  const trimmed = content.trim();
  const canSave = trimmed.length >= 5 && trimmed.length <= 500;

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap gap-1">
        {CATEGORY_ORDER.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={category === value ? "default" : "outline"}
            onClick={() => setCategory(value)}
          >
            {CATEGORY_LABELS[value]}
          </Button>
        ))}
      </div>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => onSave({ category, content: trimmed })}
        >
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
