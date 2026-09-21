import {
  Music as IconMusic,
  Briefcase as IconPropsAsset,
  UserRound as IconRole,
  Building2 as IconScene,
} from "lucide-react";

import { resource } from "@/domain";

export function ResourceTypeIcon({ className, type }: { className?: string; type: resource.ResourceType }) {
  switch (type) {
    case resource.ResourceType.CHARACTER:
      return <IconRole className={className} />;
    case resource.ResourceType.SCENE:
      return <IconScene className={className} />;
    case resource.ResourceType.PROP:
      return <IconPropsAsset className={className} />;
    case resource.ResourceType.AUDIO:
      return <IconMusic className={className} />;
  }
}
