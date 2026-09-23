import {
  Music as IconMusic,
  Package as IconPropsAsset,
  UserRound as IconRole,
  Building2 as IconScene,
} from "lucide-react";

import { resource } from "@/domain";

export function ResourceTypeIcon({ className, type }: { className?: string; type: resource.ResourceType }) {
  const iconProps = { "aria-hidden": true, className, size: "1em", strokeWidth: 1.5 } as const;

  switch (type) {
    case resource.ResourceType.CHARACTER:
      return <IconRole {...iconProps} />;
    case resource.ResourceType.SCENE:
      return <IconScene {...iconProps} />;
    case resource.ResourceType.PROP:
      return <IconPropsAsset {...iconProps} />;
    case resource.ResourceType.AUDIO:
      return <IconMusic {...iconProps} />;
  }
}
