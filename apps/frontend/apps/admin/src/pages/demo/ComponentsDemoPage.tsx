import { Page, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/design-system";
import { useState } from "react";

import { type DemoTab, defaultDemoTab, resolveDemoTab } from "./data";
import { BasicTab } from "./tabs/BasicTab";
import { CodeEditorTab } from "./tabs/CodeEditorTab";
import { DataTab } from "./tabs/DataTab";
import { FileWorkspaceTab } from "./tabs/FileWorkspaceTab";
import { FormTab } from "./tabs/FormTab";
import { MarkdownEditorTab } from "./tabs/MarkdownEditorTab";
import { OverlayTab } from "./tabs/OverlayTab";
import { PdfPreviewerTab } from "./tabs/PdfPreviewerTab";
import { XMindPreviewerTab } from "./tabs/XMindPreviewerTab";

/**
 * 组件演示页：每个组件独立一个 tab，统一通过 DemoCard 包装；
 * Page 占满 Main 剩余高度（由 AdminLayout 给出），TabsContent 通过 flex-1 + min-h-0
 * 把可用空间交给 DemoCard，单 demo 单卡的场景（CodeEditor / FileWorkspace /
 * MarkdownEditor / PdfPreviewer / XMindPreviewer）会自动撑满。
 */
export function ComponentsDemoPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>(defaultDemoTab);

  return (
    <Page className="h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden pb-6">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(resolveDemoTab(value))}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <TabsList className="h-auto shrink-0 flex-wrap">
          <TabsTrigger value="basic">基础</TabsTrigger>
          <TabsTrigger value="form">表单</TabsTrigger>
          <TabsTrigger value="overlay">浮层</TabsTrigger>
          <TabsTrigger value="data">数据</TabsTrigger>
          <TabsTrigger value="code-editor">CodeEditor</TabsTrigger>
          <TabsTrigger value="file-workspace">FileWorkspace</TabsTrigger>
          <TabsTrigger value="markdown-editor">MarkdownEditor</TabsTrigger>
          <TabsTrigger value="pdf-previewer">PdfPreviewer</TabsTrigger>
          <TabsTrigger value="xmind-previewer">XMindPreviewer</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <BasicTab />
        </TabsContent>
        <TabsContent value="form" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <FormTab />
        </TabsContent>
        <TabsContent value="overlay" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <OverlayTab />
        </TabsContent>
        <TabsContent value="data" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <DataTab />
        </TabsContent>
        <TabsContent value="code-editor" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <CodeEditorTab />
        </TabsContent>
        <TabsContent value="file-workspace" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <FileWorkspaceTab />
        </TabsContent>
        <TabsContent value="markdown-editor" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <MarkdownEditorTab />
        </TabsContent>
        <TabsContent value="pdf-previewer" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <PdfPreviewerTab />
        </TabsContent>
        <TabsContent value="xmind-previewer" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-4">
          <XMindPreviewerTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
