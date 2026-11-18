import type { DesktopBridge, LocalDirectoryEntry } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useEffect, useState } from "react";

import { LocalFileBrowser } from "./LocalFileBrowser";

export function LocalFiles({
  bridge,
  id,
  onOpen,
}: {
  bridge: DesktopBridge;
  id: string;
  onOpen: (path: string) => void;
}) {
  const [directory, setDirectory] = useState(".");
  const [entries, setEntries] = useState<LocalDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(100);
  useEffect(() => {
    let mounted = true;
    setEntries(null);
    setError(null);
    setVisible(100);
    void bridge
      .listFiles(id, directory)
      .then((value) => {
        if (mounted) setEntries(value);
      })
      .catch((cause) => {
        if (mounted) setError(getErrorMessage(cause));
      });
    return () => {
      mounted = false;
    };
  }, [bridge, id, directory, revision]);
  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type === "files" && event.threadId === id) setRevision((value) => value + 1);
      }),
    [bridge, id],
  );
  return (
    <div className="min-h-0 w-full flex-1 overflow-auto">
      <LocalFileBrowser
        directory={directory}
        entries={entries}
        selectedPath={null}
        dirty={false}
        visible={visible}
        onDirectoryChange={setDirectory}
        onOpen={onOpen}
        onRefresh={() => setRevision((value) => value + 1)}
        onShowMore={() => setVisible((value) => value + 100)}
      />
      {error ? (
        <p
          role="alert"
          className="mx-3 mb-3 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
