import type { ComponentProps } from "react";

import t from "@/utils/i18n";

import { CoverImage, CoverImageUploader } from "../../components/CoverImageUploader";

export const ProjectCoverImage = CoverImage;

export function ProjectCoverUploader(props: ComponentProps<typeof CoverImageUploader>) {
  return (
    <CoverImageUploader
      {...props}
      imageAlt={props.imageAlt ?? t("项目封面")}
      removeAriaLabel={props.removeAriaLabel ?? t("移除项目封面")}
    />
  );
}
