import { Metadata, readMetadata, writeMetadata } from './store';

let cache: Metadata | null = null;

async function get(): Promise<Metadata> {
  if (!cache) cache = await readMetadata();
  return cache;
}

export async function listStars(): Promise<Record<string, boolean>> {
  const m = await get();
  return { ...m.stars };
}

export async function toggleStar(path: string, starred: boolean): Promise<void> {
  const m = await get();
  if (starred) m.stars[path] = true;
  else delete m.stars[path];
  await writeMetadata(m);
}

export async function listTags(): Promise<Record<string, string[]>> {
  const m = await get();
  return { ...m.tags };
}

export async function setTags(path: string, tags: string[]): Promise<void> {
  const m = await get();
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (cleaned.length) m.tags[path] = cleaned;
  else delete m.tags[path];
  await writeMetadata(m);
}

export async function listNotes(): Promise<Record<string, string>> {
  const m = await get();
  return { ...m.notes };
}

export async function setNote(path: string, note: string): Promise<void> {
  const m = await get();
  const trimmed = note.trim();
  if (trimmed) m.notes[path] = trimmed;
  else delete m.notes[path];
  await writeMetadata(m);
}

// When a session is soft-deleted, drop all its metadata (star/tags/note).
export async function clearSessionMeta(path: string): Promise<void> {
  const m = await get();
  let changed = false;
  if (path in m.stars) {
    delete m.stars[path];
    changed = true;
  }
  if (path in m.tags) {
    delete m.tags[path];
    changed = true;
  }
  if (path in m.notes) {
    delete m.notes[path];
    changed = true;
  }
  if (changed) await writeMetadata(m);
}
