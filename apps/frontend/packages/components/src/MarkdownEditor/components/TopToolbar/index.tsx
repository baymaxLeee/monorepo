import { Editor } from "@tiptap/react";
import React from "react";
import { slotClassNameFactory } from "../../../compat/className";
import { Toolbar } from "../Toolbar";

interface IProps {
  editor: Editor;
  aiEnable?: boolean;
  commentEnable?: boolean;
}

const cssPrefix = slotClassNameFactory("markdown-editor-top-toolbar");

export const FixedToolbar: React.FC<IProps> = (props) => {
  return (
    <div className={cssPrefix`container`}>
      <Toolbar {...props} />
    </div>
  );
};
