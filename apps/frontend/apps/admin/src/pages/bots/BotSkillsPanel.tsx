import {
  attachBotSkill,
  detachBotSkill,
  fetchBotSkills,
  fetchSkills,
  type SkillSummary,
} from "api";
import { Badge, Button, Skeleton, Switch, toast } from "components";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function isEffective(skill: SkillSummary) {
  return skill.is_enabled && skill.status === "published";
}

/**
 * Bind / unbind skills for a bot. Attach/detach are their own endpoints, so each
 * toggle takes effect immediately (independent of any surrounding form's save) —
 * the caller should make that clear in its surrounding copy.
 */
export function BotSkillsPanel({ botId }: { botId: string }) {
  const [attached, setAttached] = useState<SkillSummary[] | null>(null);
  const [all, setAll] = useState<SkillSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setAttached(null);
    setAll(null);
    Promise.all([fetchBotSkills(botId), fetchSkills()])
      .then(([bound, every]) => {
        if (!alive) return;
        setAttached(bound);
        setAll(every);
      })
      .catch(() => {
        if (!alive) return;
        setAttached([]);
        setAll([]);
      });
    return () => {
      alive = false;
    };
  }, [botId]);

  const boundIds = useMemo(
    () => new Set((attached ?? []).map((s) => s.id)),
    [attached],
  );

  async function toggle(skill: SkillSummary, next: boolean) {
    setBusyId(skill.id);
    try {
      const list = next
        ? await attachBotSkill(botId, skill.id)
        : await detachBotSkill(botId, skill.id);
      setAttached(list);
      toast.success(next ? "已挂载技能" : "已移除技能");
    } catch {
    } finally {
      setBusyId(null);
    }
  }

  const loading = attached === null || all === null;
  const skills = all ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          已挂载 {boundIds.size} 个 · 仅「已发布且已启用」的技能会进入模型
        </p>
        <Button
          variant="link"
          size="sm"
          className="h-auto shrink-0 p-0"
          asChild
        >
          <Link to="/platform/admin/skills">管理技能 →</Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          还没有任何技能。先到「技能管理」创建，再回来挂载。
        </div>
      ) : (
        <ul className="space-y-2">
          {skills.map((skill) => {
            const bound = boundIds.has(skill.id);
            return (
              <li
                key={skill.id}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{skill.name}</span>
                    {isEffective(skill) ? (
                      <Badge variant="outline">可用</Badge>
                    ) : (
                      <Badge variant="secondary">未发布</Badge>
                    )}
                  </div>
                  {skill.description ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {skill.description}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={bound}
                  disabled={busyId === skill.id}
                  onCheckedChange={(next) => void toggle(skill, next)}
                  aria-label={
                    bound ? `移除 ${skill.name}` : `挂载 ${skill.name}`
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
