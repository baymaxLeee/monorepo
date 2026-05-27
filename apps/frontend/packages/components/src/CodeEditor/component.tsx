import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import React, { useEffect, useRef } from "react";
import { cn } from "shared";
import { basicSetup } from "./constants";
import type { CodeEditorProps } from "./interface";
import { getLanguageExtension } from "./utils";

interface CachedEditorState {
  state: EditorState;
  scrollTop: number;
  scrollLeft: number;
}

const INTERNAL_DEFAULT_FILE_ID = "__code_editor_default__";
const externalSyncAnnotation = Annotation.define<boolean>();
const defaultExtensions: Extension = [];
const defaultLangMapExtensions: Record<string, () => Extension> = {};

export const CodeEditor: React.FC<CodeEditorProps> = ({
  fileId,
  value = "",
  fileName = "",
  readOnly = false,
  onChange,
  onSave,
  extensions = defaultExtensions,
  langMapExtensions = defaultLangMapExtensions,
  style,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, CachedEditorState>());
  const activeFileIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const langCompartmentRef = useRef(new Compartment());
  const pluginCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const onSaveRef = useRef(onSave);
  const saveKeymapRef = useRef(
    keymap.of([
      {
        key: "Mod-s",
        run: (view) => {
          const handler = onSaveRef.current;
          if (typeof handler !== "function") return false;

          handler(view.state.doc.toString(), view);
          return true;
        },
      },
    ]),
  );

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const createEditorState = (
    doc: string,
    name: string,
    nextReadOnly: boolean,
  ) => {
    const language = getLanguageExtension(name, langMapExtensions) ?? [];

    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((transaction) =>
              transaction.annotation(externalSyncAnnotation),
            )
          ) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        saveKeymapRef.current,
        langCompartmentRef.current.of(language),
        pluginCompartmentRef.current.of(extensions),
        readOnlyCompartmentRef.current.of(
          nextReadOnly ? EditorState.readOnly.of(true) : [],
        ),
      ],
    });
  };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const view = new EditorView({ parent: element });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      statesRef.current.clear();
      activeFileIdRef.current = null;
    };
  }, []);

  const cacheKey = fileId === undefined ? INTERNAL_DEFAULT_FILE_ID : fileId;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const previousKey = activeFileIdRef.current;
    if (previousKey) {
      statesRef.current.set(previousKey, {
        state: view.state,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      });
    }

    if (cacheKey === null) {
      activeFileIdRef.current = null;
      view.setState(createEditorState("", "", readOnly));
      return;
    }

    if (previousKey === cacheKey) return;

    activeFileIdRef.current = cacheKey;

    const cached = statesRef.current.get(cacheKey);
    if (cached) {
      view.setState(cached.state);
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = cached.scrollTop;
        view.scrollDOM.scrollLeft = cached.scrollLeft;
      });
      return;
    }

    view.setState(createEditorState(value, fileName, readOnly));
  }, [cacheKey, fileName, langMapExtensions, readOnly, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || cacheKey === null) return;

    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      annotations: externalSyncAnnotation.of(true),
    });
  }, [cacheKey, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || cacheKey === null) return;

    const language = getLanguageExtension(fileName, langMapExtensions) ?? [];
    view.dispatch({
      effects: langCompartmentRef.current.reconfigure(language),
    });
  }, [cacheKey, fileName, langMapExtensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || cacheKey === null) return;

    view.dispatch({
      effects: pluginCompartmentRef.current.reconfigure(extensions),
    });
  }, [cacheKey, extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || cacheKey === null) return;

    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        readOnly ? EditorState.readOnly.of(true) : [],
      ),
    });
  }, [cacheKey, readOnly]);

  return (
    <div
      ref={containerRef}
      style={style}
      className={cn("code-editor", className)}
    />
  );
};

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
