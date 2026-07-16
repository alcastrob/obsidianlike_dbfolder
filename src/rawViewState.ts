// Tracks URIs the user deliberately asked to view as plain markdown source, so
// the tab-open auto-switch (extension.ts) doesn't immediately redirect that
// tab back to our custom editor - which would otherwise defeat the whole
// point of the "view raw source" action.
const viewingRaw = new Set<string>();

export function markViewingRaw(uri: string): void {
  viewingRaw.add(uri);
}

export function isViewingRaw(uri: string): boolean {
  return viewingRaw.has(uri);
}

export function clearViewingRaw(uri: string): void {
  viewingRaw.delete(uri);
}
