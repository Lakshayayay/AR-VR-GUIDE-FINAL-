/** Tracks drawing IDs for one call so late worker messages cannot revive removed marks. */
export function drawingLifetime() {
  const seen = new Set<string>();
  const retired = new Set<string>();
  return {
    put(id: string) {
      if (retired.has(id)) return false;
      seen.add(id);
      return true;
    },
    remove(id: string) {
      seen.add(id);
      retired.add(id);
    },
    clear() {
      for (const id of seen) retired.add(id);
    },
    reconcile(ids: string[]) {
      const active = new Set(ids);
      for (const id of seen) if (!active.has(id)) retired.add(id);
      for (const id of ids) {
        seen.add(id);
        retired.delete(id);
      }
    },
  };
}
