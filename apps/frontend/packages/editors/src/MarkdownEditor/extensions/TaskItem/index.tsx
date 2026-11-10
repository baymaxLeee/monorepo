import type { Node } from "@tiptap/core";
import TiptapTaskItem from "@tiptap/extension-task-item";

export const createTaskItemExtension = (): Node => TiptapTaskItem.configure({ nested: true });
