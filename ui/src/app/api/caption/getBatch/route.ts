/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDatasetsRoot } from '@/server/settings';

function isUnderRoot(filepath: string, root: string): boolean {
  const resolved = path.resolve(filepath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 499 });
  }

  if (request.signal.aborted) {
    return new NextResponse(null, { status: 499 });
  }

  const { imgPaths, ext } = body as { imgPaths?: string[]; ext?: string };
  if (!Array.isArray(imgPaths)) {
    return NextResponse.json({ error: 'imgPaths must be an array' }, { status: 400 });
  }

  const captionExt = ((ext || 'txt') as string).replace(/^\.+/, '').trim() || 'txt';
  const allowedDir = await getDatasetsRoot();
  const captions: Record<string, string> = {};
  const meta: Record<string, { width?: number; height?: number; size?: number }> = {};

  // Read any cached dimensions from .aitk_size.json per parent directory
  const sizeCacheByDir = new Map<string, Record<string, any> | null>();
  const uniqueDirs = Array.from(
    new Set(
      imgPaths
        .filter((p): p is string => typeof p === 'string' && isUnderRoot(p, allowedDir))
        .map(p => path.dirname(path.resolve(p))),
    ),
  );
  await Promise.all(
    uniqueDirs.map(async dir => {
      try {
        const raw = await fs.promises.readFile(path.join(dir, '.aitk_size.json'), 'utf-8');
        sizeCacheByDir.set(dir, JSON.parse(raw));
      } catch {
        sizeCacheByDir.set(dir, null);
      }
    }),
  );

  // Read every caption file and metadata concurrently instead of blocking on each one in turn.
  await Promise.all(
    imgPaths.map(async imgPath => {
      if (typeof imgPath !== 'string') return;
      if (!isUnderRoot(imgPath, allowedDir)) return;

      const captionPath = imgPath.replace(/\.[^/.]+$/, '') + '.' + captionExt;
      try {
        // Missing file (ENOENT) or any read error falls back to an empty caption.
        captions[imgPath] = await fs.promises.readFile(captionPath, 'utf-8');
      } catch {
        captions[imgPath] = '';
      }

      const resolved = path.resolve(imgPath);
      const dir = path.dirname(resolved);
      const baseKey = '/' + path.basename(resolved);
      const dirCache = sizeCacheByDir.get(dir);
      const entry = dirCache ? dirCache[baseKey] : null;
      const itemMeta: { width?: number; height?: number; size?: number } = {};
      if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
        itemMeta.width = entry[0];
        itemMeta.height = entry[1];
        if (typeof entry[2] === 'string') {
          const parsedSize = parseInt(entry[2].split(':')[0], 10);
          if (!isNaN(parsedSize)) itemMeta.size = parsedSize;
        }
      }
      if (itemMeta.size === undefined) {
        try {
          const st = await fs.promises.stat(resolved);
          itemMeta.size = st.size;
        } catch {
          // ignore
        }
      }
      meta[imgPath] = itemMeta;
    }),
  );

  return NextResponse.json({ captions, meta });
}
