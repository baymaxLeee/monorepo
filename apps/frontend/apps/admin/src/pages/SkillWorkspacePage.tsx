import {
  fetchSkill,
  fetchSkillFile,
  fetchSkillWorkspace,
  publishSkill,
  type Skill,
  type SkillValidationResult,
  updateSkillWorkspace,
  validateSkill,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  type FileChange,
  type FileNode,
  FileWorkspace,
  type FileWorkspaceRef,
} from "components/file-workspace";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getErrorMessage } from "shared";

export function SkillWorkspacePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const workspaceRef = useRef<FileWorkspaceRef>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [workspaceSeq, setWorkspaceSeq] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<SkillValidationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, workspace] = await Promise.all([
        fetchSkill(id),
        fetchSkillWorkspace(id),
      ]);
      setSkill(detail);
      setTree(workspace.tree);
      setWorkspaceSeq(workspace.workspace_seq);
      setDirty(false);
      setValidation(null);
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
    const workspace = await updateSkillWorkspace(
      id,
      workspaceSeq,
      changes as FileChange[],
    );
    setWorkspaceSeq(workspace.workspace_seq);
    workspaceRef.current?.resetBaseline();
    setDirty(false);
    setValidation(null);
    setSkill(await fetchSkill(id));
    toast.success("工作区已保存");
    return workspace.workspace_seq;
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
    <Page className="min-h-0">
      <PageHeader>
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
                setValidation(await validateSkill(id));
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
                setValidation(result.validation);
                toast.success("技能已发布");
              })
            }
          >
            发布
          </Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!tree ? (
        <Skeleton className="min-h-[560px] flex-1" />
      ) : (
        <div className="grid min-h-[560px] flex-1 grid-cols-[minmax(0,1fr)_280px] gap-4">
          <FileWorkspace
            ref={workspaceRef}
            value={tree}
            defaultSelectedFileId={skillMdId}
            onLoadContent={(nodeId) => fetchSkillFile(id, nodeId)}
            onChange={() => setDirty(true)}
            height="100%"
            codeEditorProps={{
              onSave: () =>
                void run(async () => {
                  await save();
                }),
            }}
          />
          <Card className="overflow-auto">
            <CardHeader>
              <CardTitle>检查结果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!validation && (
                <p className="text-muted-foreground">
                  保存后运行验证，检查 SKILL.md 和文件树结构。
                </p>
              )}
              {validation?.ok && (
                <Alert>
                  <AlertTitle>验证通过</AlertTitle>
                  <AlertDescription>当前工作区可以发布。</AlertDescription>
                </Alert>
              )}
              {validation?.issues.map((issue) => (
                <Alert
                  key={`${issue.path}-${issue.message}`}
                  variant="destructive"
                >
                  <AlertTitle>{issue.path}</AlertTitle>
                  <AlertDescription>{issue.message}</AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  );
}
