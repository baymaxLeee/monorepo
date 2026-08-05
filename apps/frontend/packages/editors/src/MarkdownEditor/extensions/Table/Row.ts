import TiptapTableRow from "@tiptap/extension-table-row";

export const createTableRowExtension = () =>
  TiptapTableRow.extend({
    allowGapCursor: false,
    content: "(tableCell | tableHeader)*",
  });
