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

// When a session is soft-deleted, drop the star too.
export async function clearStar(path: string): Promise<void> {
  const m = await get();
  if (path in m.stars) {
    delete m.stars[path];
    await writeMetadata(m);
  }
}
