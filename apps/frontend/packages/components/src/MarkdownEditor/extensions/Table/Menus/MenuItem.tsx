import { Menu } from "../../../../compat/legacy-ui";
import React from "react";
import { slotClassNameFactory } from "../../../../compat/className";

const cssPrefix = slotClassNameFactory("markdown-editor-table-menu");

export const menuStyles = {
  bubbleMenu: cssPrefix`bubble-menu`,
  menuItem: cssPrefix`menu-item`,
};

export const MenuItem = (props: React.ComponentProps<typeof Menu.Item>) => (
  <Menu.Item {...props} className={menuStyles.menuItem}>
    {props.children}
  </Menu.Item>
);

/** Stable reference — avoids BubbleMenu re-renders caused by inline arrow functions */
export const ALWAYS_SHOW = () => true;
