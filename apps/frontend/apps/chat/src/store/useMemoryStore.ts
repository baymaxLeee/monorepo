import {
  approveMemoryCandidate,
  deleteMemory as deleteMemoryApi,
  fetchActiveMemories,
  fetchMemoryCandidates,
  type MemoryCandidate,
  type MemoryCategory,
  rejectMemoryCandidate,
  type UserMemory,
  updateMemoryCandidate,
} from "api";
import { getErrorMessage } from "shared";
import { create } from "zustand";

export interface MemoryState {
  candidates: MemoryCandidate[];
  memories: UserMemory[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  refreshCandidates: () => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  edit: (
    id: string,
    patch: { category?: MemoryCategory; content?: string },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  candidates: [],
  memories: [],
  loading: false,
  error: null,
  loaded: false,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const [candidatesRes, memoriesRes] = await Promise.all([
        fetchMemoryCandidates(),
        fetchActiveMemories(),
      ]);
      set({
        candidates: candidatesRes.candidates,
        memories: memoriesRes.memories,
        loaded: true,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  async refreshCandidates() {
    try {
      const { candidates } = await fetchMemoryCandidates();
      set({ candidates });
    } catch (error) {
      set({ error: getErrorMessage(error) });
    }
  },

  async approve(id) {
    await approveMemoryCandidate(id);
    await get().refresh();
  },

  async reject(id) {
    await rejectMemoryCandidate(id);
    set((state) => ({
      candidates: state.candidates.filter((candidate) => candidate.id !== id),
    }));
  },

  async edit(id, patch) {
    const { candidate } = await updateMemoryCandidate(id, patch);
    set((state) => ({
      candidates: state.candidates.map((current) =>
        current.id === id ? candidate : current,
      ),
    }));
  },

  async remove(id) {
    await deleteMemoryApi(id);
    set((state) => ({
      memories: state.memories.filter((memory) => memory.id !== id),
    }));
    await get().refreshCandidates();
  },
}));
