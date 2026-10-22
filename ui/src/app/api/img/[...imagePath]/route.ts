/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { getDatasetsRoot, getTrainingFolder, getDataRoot } from '@/server/settings';
import { catchAllToFilePath } from '@/server/catchAllPath';
import { TOOLKIT_ROOT } from '@/paths';

const execFileAsync = promisify(execFile);

const contentTypeMap: { [key: string]: string } = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  // Videos
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.flv': 'video/x-flv',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

export async function GET(request: NextRequest, { params }: { params: { imagePath: string | string[] } }) {
  const { imagePath } = await params;
  try {
    // Segments are already URL-decoded by Next.js; accepts both the legacy
    // single-segment form and the `<folder>/<filename>` form.
    const filepath = catchAllToFilePath(imagePath);

    // Get allowed directories
    const datasetRoot = await getDatasetsRoot();
    const trainingRoot = await getTrainingFolder();
    const dataRoot = await getDataRoot();

    const allowedDirs = [datasetRoot, trainingRoot, dataRoot];

    // Security check: resolve the path so any `..` segments are collapsed,
    // then ensure it's still under an allowed root. (Plain `.includes('..')`
    // false-positives on filenames that contain `..` as text, e.g. an ellipsis.)
    let resolved = path.resolve(filepath);
    const isAllowed = allowedDirs.some(
      allowedDir => resolved === allowedDir || resolved.startsWith(allowedDir + path.sep),
    );

    if (!isAllowed) {
      console.warn(`Access denied: ${resolved} not in ${allowedDirs.join(', ')}`);
      return new NextResponse('Access denied', { status: 403 });
    }

    // ?thumb=1 serves the pre-generated 300x300 thumb from the sibling .thumbs
    // folder when it exists; otherwise falls through to the full file exactly
    // as before. A source with alpha gets a <name>.<ext>.png thumb so the
    // transparency survives, everything else stays <name>.<ext>.jpg.
    const origExt = path.extname(resolved).toLowerCase();
    const isHeic = origExt === '.heic' || origExt === '.heif';
    const wantThumb = request.nextUrl.searchParams.has('thumb');

    if (wantThumb) {
      const thumbBase = path.join(/*turbopackIgnore: true*/ path.dirname(resolved), '.thumbs', path.basename(resolved));
      let foundThumb = false;
      for (const thumbPath of [`${thumbBase}.png`, `${thumbBase}.jpg`]) {
        const thumbStat = await fs.promises.stat(/*turbopackIgnore: true*/ thumbPath).catch(() => null);
        if (thumbStat && thumbStat.isFile()) {
          resolved = thumbPath;
          foundThumb = true;
          break;
        }
      }
      if (!foundThumb && isHeic) {
        const thumbJpg = `${thumbBase}.jpg`;
        const scriptPath = path.join(/*turbopackIgnore: true*/ TOOLKIT_ROOT, 'toolkit', 'heic_preview.py');
        await execFileAsync('python3', [scriptPath, resolved, thumbJpg, '300']).catch(() => null);
        const thumbStat = await fs.promises.stat(/*turbopackIgnore: true*/ thumbJpg).catch(() => null);
        if (thumbStat && thumbStat.isFile()) {
          resolved = thumbJpg;
        }
      }
    } else if (isHeic) {
      // Chrome/Firefox on Linux do not natively decode image/heic in <img> tags;
      // serve a cached full-resolution JPEG preview from .thumbs/ instead.
      const previewJpg = path.join(
        /*turbopackIgnore: true*/ path.dirname(resolved),
        '.thumbs',
        `${path.basename(resolved)}.preview.jpg`,
      );
      let previewStat = await fs.promises.stat(/*turbopackIgnore: true*/ previewJpg).catch(() => null);
      if (!previewStat || !previewStat.isFile()) {
        const scriptPath = path.join(/*turbopackIgnore: true*/ TOOLKIT_ROOT, 'toolkit', 'heic_preview.py');
        await execFileAsync('python3', [scriptPath, resolved, previewJpg, '0']).catch(() => null);
        previewStat = await fs.promises.stat(/*turbopackIgnore: true*/ previewJpg).catch(() => null);
      }
      if (previewStat && previewStat.isFile()) {
        resolved = previewJpg;
      }
    }

    // Bail out early if the client already gave up
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    // Stat file (async)
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ resolved).catch(() => null);
    if (!stat || !stat.isFile()) {
      return new NextResponse('File not found', { status: 404 });
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    // Weak ETag from inode/size/mtime — cheap and stable enough for revalidation
    const etag = `W/"${stat.ino.toString(36)}-${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    const cacheControl = 'public, max-age=86400, immutable';

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': cacheControl,
        },
      });
    }

    const buildBody = (start?: number, end?: number) => {
      const nodeStream =
        start !== undefined && end !== undefined
          ? fs.createReadStream(/*turbopackIgnore: true*/ resolved, { start, end })
          : fs.createReadStream(/*turbopackIgnore: true*/ resolved);

      // Wire client disconnect → destroy the file stream so we don't keep
      // reading bytes for a request the browser has already cancelled.
      const onAbort = () => nodeStream.destroy();
      if (request.signal.aborted) {
        nodeStream.destroy();
      } else {
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      nodeStream.once('close', () => request.signal.removeEventListener('abort', onAbort));

      return Readable.toWeb(nodeStream) as unknown as ReadableStream;
    };

    // Support range requests for video/audio seeking
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      return new NextResponse(buildBody(start, end) as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          ETag: etag,
        },
      });
    }

    return new NextResponse(buildBody() as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Cache-Control': cacheControl,
        'Accept-Ranges': 'bytes',
        ETag: etag,
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
