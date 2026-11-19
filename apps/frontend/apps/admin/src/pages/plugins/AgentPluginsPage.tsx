import {
  type AgentPluginListItem,
  type AgentPluginManifestInput,
  installAgentPlugin,
  listAgentPlugins,
  publishAgentPlugin,
  setAgentPluginEnabled,
  uninstallAgentPlugin,
} from "@repo/api/admin";
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
  Muted,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useState } from "react";

import { useAdminIdentity } from "../../identity";
import {
  type InstallValues,
  InstallDialog,
  type PublishValues,
  PublishDialog,
  useInstallPluginForm,
  usePublishPluginForm,
} from "./AgentPluginDialogs";

function parseRecord(raw: string): Record<string, string> {
  return JSON.parse(raw) as Record<string, string>;
}

function status(item: AgentPluginListItem) {
  if (!item.installed) return <Badge variant="outline">未安装</Badge>;
  return item.enabled ? <Badge>已启用</Badge> : <Badge variant="secondary">已停用</Badge>;
}

export function AgentPluginsPage() {
  const { isSuperAdmin } = useAdminIdentity();
  const [plugins, setPlugins] = useState<AgentPluginListItem[] | null>(null);
  const [installing, setInstalling] = useState<AgentPluginListItem | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishForm = usePublishPluginForm();
  const installForm = useInstallPluginForm();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listAgentPlugins({ skipErrorNotify: true })
      .then(setPlugins)
      .catch((cause) => setError(getErrorMessage(cause)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  function openInstall(plugin: AgentPluginListItem) {
    setInstalling(plugin);
    installForm.reset({
      releaseDigest: plugin.latestReleaseDigest,
      enabled: plugin.installed ? plugin.enabled : true,
      config: "{}",
      secrets: "{}",
    });
  }

  async function publish(values: PublishValues) {
    try {
      await publishAgentPlugin({
        manifest: JSON.parse(values.manifest) as AgentPluginManifestInput,
        installPolicy: values.installPolicy,
        availability: values.availability,
        listed: values.listed,
      });
      toast.add({ type: "success", title: "插件 Release 已发布" });
      setPublishOpen(false);
      load();
    } catch {}
  }

  async function install(values: InstallValues) {
    if (!installing) return;
    try {
      await installAgentPlugin(installing.pluginId, {
        releaseDigest: values.releaseDigest,
        enabled: values.enabled,
        config: parseRecord(values.config),
        secrets: parseRecord(values.secrets),
      });
      toast.add({ type: "success", title: `${installing.displayName} 已安装` });
      setInstalling(null);
      load();
    } catch {}
  }

  async function toggle(plugin: AgentPluginListItem, enabled: boolean) {
    try {
      await setAgentPluginEnabled(plugin.pluginId, { enabled });
      load();
    } catch {}
  }

  async function uninstall(plugin: AgentPluginListItem) {
    if (!window.confirm(`确认从当前工作空间卸载「${plugin.displayName}」？`)) return;
    try {
      await uninstallAgentPlugin(plugin.pluginId);
      toast.add({ type: "success", title: "插件已卸载" });
      load();
    } catch {}
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>插件管理</PageTitle>
          <PageDescription>
            Admin 只管理不可变 Release、工作空间安装与加密凭据。MCP 连接、工具调用和 Turn 清理由 Runtime 或 Desktop
            执行宿主负责。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          {isSuperAdmin ? <Button onClick={() => setPublishOpen(true)}>发布 Release</Button> : null}
        </PageActions>
      </PageHeader>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>插件列表加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>插件资源</CardTitle>
          <CardDescription>{loading ? "加载中…" : plugins ? `共 ${plugins.length} 个` : "暂无数据"}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : plugins?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>插件</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>Release</TableHead>
                  <TableHead>工具</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map((plugin) => (
                  <TableRow key={plugin.pluginId}>
                    <TableCell>
                      <div className="font-medium">{plugin.displayName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{plugin.pluginId}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{plugin.source === "system" ? "系统" : "外部 MCP"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div>{plugin.manifest.version}</div>
                      <div
                        className="max-w-44 truncate font-mono text-xs text-muted-foreground"
                        title={plugin.latestReleaseDigest}
                      >
                        {plugin.latestReleaseDigest}
                      </div>
                    </TableCell>
                    <TableCell>
                      {plugin.manifest.mcpServers.reduce((count, server) => count + server.tools.length, 0)}
                    </TableCell>
                    <TableCell>{status(plugin)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      {plugin.installed ? (
                        <Switch
                          aria-label={`${plugin.displayName}：启用`}
                          checked={plugin.enabled}
                          onCheckedChange={(value) => toggle(plugin, value)}
                        />
                      ) : null}
                      <Button variant="link" size="sm" onClick={() => openInstall(plugin)}>
                        {plugin.installed ? "更新安装" : "安装"}
                      </Button>
                      {plugin.installed ? (
                        <Button variant="link" size="sm" onClick={() => uninstall(plugin)}>
                          卸载
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>尚无已发布插件。系统插件可由部署 seed，也可由 super admin 手工发布。</Muted>
          )}
        </CardContent>
      </Card>
      <PublishDialog open={publishOpen} form={publishForm} onOpenChange={setPublishOpen} onSubmit={publish} />
      <InstallDialog
        plugin={installing}
        form={installForm}
        onOpenChange={(open) => !open && setInstalling(null)}
        onSubmit={install}
      />
    </Page>
  );
}
