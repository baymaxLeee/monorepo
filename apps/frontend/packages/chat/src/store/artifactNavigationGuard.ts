export type ArtifactNavigationGuard = () => Promise<boolean>;

let activeGuard: ArtifactNavigationGuard | null = null;

export function registerArtifactNavigationGuard(guard: ArtifactNavigationGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export async function allowArtifactNavigation(): Promise<boolean> {
  return (await activeGuard?.()) ?? true;
}
