import {
  createSkillNode,
  deleteSkillNode,
  fetchSkill,
  fetchSkillFile,
  fetchSkillWorkspace,
  moveSkillNode,
  publishSkill,
  renameSkillNode,
  type Skill,
  type SkillFileNode,
  type SkillNodeMutationResult,
  type SkillValidationResult,
  updateSkillFileContent,
  validateSkill,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Skeleton,
  toast,
} from "components";
import {
  ChangeAction,
  type FileChange,
  type FileNode,
  FileWorkspace,
  type FileWorkspaceRef,
} from "components/file-workspace";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getErrorMessage } from "shared";

function notifyValidationResult(result: SkillValidationResult) {
  if (result.ok) {
    toast.success("验证通过，当前工作区可以发布");
    return;
  }
  const detail = result.issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("；");
  toast.error(detail || "验证未通过");
}

export function SkillWorkspacePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const workspaceRef = useRef<FileWorkspaceRef>(null);
  const etagsRef = useRef(new Map<string, string>());
  const [skill, setSkill] = useState<Skill | null>(null);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [workspaceSeq, setWorkspaceSeq] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, workspace] = await Promise.all([
        fetchSkill(id),
        fetchSkillWorkspace(id),
      ]);
      const etags = new Map<string, string>();
      const collectEtags = (nodes: SkillFileNode[]) => {
        for (const node of nodes) {
          etags.set(node.id, node.etag);
          if (node.children) collectEtags(node.children);
        }
      };
      collectEtags(workspace.tree);
      etagsRef.current = etags;
      setSkill(detail);
      setTree(workspace.tree);
      setWorkspaceSeq(workspace.workspace_seq);
      setDirty(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save(): Promise<number> {
    const changes = workspaceRef.current?.getChanges() ?? [];
    if (!changes.length) return workspaceSeq;
    let nextWorkspaceSeq = workspaceSeq;
    for (const change of changes) {
      const result = await persistChange(change);
      nextWorkspaceSeq = result.workspace_seq;
      if (result.etag) etagsRef.current.set(result.node_id, result.etag);
      else etagsRef.current.delete(result.node_id);
    }
    setWorkspaceSeq(nextWorkspaceSeq);
    workspaceRef.current?.resetBaseline();
    setDirty(false);
    setSkill(await fetchSkill(id));
    toast.success("工作区已保存");
    return nextWorkspaceSeq;
  }

  function etag(nodeId: string): string {
    const value = etagsRef.current.get(nodeId);
    if (!value) throw new Error(`文件 ${nodeId} 已变化，请刷新后重试`);
    return value;
  }

  function persistChange(change: FileChange): Promise<SkillNodeMutationResult> {
    switch (change.action) {
      case ChangeAction.CREATE:
        return createSkillNode(id, {
          id: change.id,
          parent_id: change.parent_id,
          name: change.name,
          type: change.type,
          ...(change.content === undefined ? {} : { content: change.content }),
        });
      case ChangeAction.UPDATE:
        return updateSkillFileContent(
          id,
          change.id,
          etag(change.id),
          change.content,
        );
      case ChangeAction.RENAME:
        return renameSkillNode(id, change.id, etag(change.id), change.name);
      case ChangeAction.MOVE:
        return moveSkillNode(id, change.id, etag(change.id), change.parent_id);
      case ChangeAction.DELETE:
        return deleteSkillNode(id, change.id, etag(change.id));
    }
    const unsupported: never = change;
    throw new Error(`不支持的文件变更：${JSON.stringify(unsupported)}`);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function stateBadge() {
    if (skill?.status !== "published")
      return <Badge variant="secondary">草稿</Badge>;
    if (skill.has_unpublished_changes || dirty) {
      return <Badge variant="secondary">有未发布修改</Badge>;
    }
    return <Badge>已发布</Badge>;
  }

  const skillMdId = tree?.find(
    (node) => node.type === "file" && node.name === "SKILL.md",
  )?.id;

  return (
    <Page className="min-h-0 flex-1 overflow-hidden">
      <PageHeader className="shrink-0">
        <PageHeaderContent>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("..")}>
              返回
            </Button>
            <PageTitle>{skill?.name ?? "技能工作区"}</PageTitle>
            {stateBadge()}
          </div>
          <PageDescription>
            编辑文件树并保存；只有点击发布后，智能体才会读取新的完整快照。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button
            variant="outline"
            disabled={busy || !dirty}
            onClick={() =>
              void run(async () => {
                await save();
              })
            }
          >
            保存
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await save();
                notifyValidationResult(await validateSkill(id));
              })
            }
          >
            验证
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const seq = await save();
                const result = await publishSkill(id, seq);
                setSkill(result.skill);
                if (!result.validation.ok) {
                  notifyValidationResult(result.validation);
                  return;
                }
                toast.success("技能已发布");
              })
            }
          >
            发布
          </Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!tree ? (
        <Skeleton className="min-h-0 flex-1" />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileWorkspace
            ref={workspaceRef}
            value={tree}
            defaultSelectedFileId={skillMdId}
            onLoadContent={async (nodeId) => {
              const file = await fetchSkillFile(id, nodeId);
              etagsRef.current.set(nodeId, file.etag);
              return file.content;
            }}
            onChange={() => setDirty(true)}
            height="100%"
            codeEditorProps={{
              onSave: () =>
                void run(async () => {
                  await save();
                }),
            }}
          />
        </div>
      )}
    </Page>
  );
}
