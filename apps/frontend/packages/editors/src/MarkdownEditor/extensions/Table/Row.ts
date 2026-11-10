import { TableRow } from "@tiptap/extension-table/row";

export const createTableRowExtension = () =>
  TableRow.extend({
    allowGapCursor: false,
    content: "(tableCell | tableHeader)*",
  });
