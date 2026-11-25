import { allowArtifactNavigation } from "@repo/ai-elements/conversation/store/artifactNavigationGuard";
import { create } from "zustand";

export type LocalArtifact = { threadId: string; path: string };

export const useLocalArtifact = create<{ selected: LocalArtifact | null }>(() => ({ selected: null }));

export async function selectLocalArtifact(selected: LocalArtifact | null) {
  if (await allowArtifactNavigation()) useLocalArtifact.setState({ selected });
}
