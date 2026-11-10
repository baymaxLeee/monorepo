import type { Editor } from "@tiptap/react";
import type React from "react";

import { Toolbar } from "../Toolbar";

interface IProps {
  editor: Editor;
}

export const FixedToolbar: React.FC<IProps> = (props) => {
  return (
    <div className="w-full border-b bg-muted/30">
      <Toolbar {...props} />
    </div>
  );
};
