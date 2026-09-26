import fs from 'node:fs';
import path from 'node:path';
import { VideoClipInfo } from './simulator-types.js';

const getBaseDir = () => {
  const candidate1 = path.resolve(process.cwd(), 'tools', 'cctv-simulator');
  if (fs.existsSync(candidate1)) return candidate1;
  const candidate2 = path.dirname(process.execPath);
  if (fs.existsSync(path.resolve(candidate2, 'media'))) return candidate2;
  return process.cwd();
};

const MEDIA_DIR = path.resolve(getBaseDir(), 'media');

// Ensure media folder exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export const BUILTIN_CLIPS: VideoClipInfo[] = [
  {
    id: 'clip-gate',
    title: 'Gate 1 - Main Barrier & Vehicle Traffic',
    category: 'gate',
    filename: 'gate-traffic.mp4',
    durationSeconds: 45,
    resolution: '1920x1080',
    fps: 25,
    description: 'Vehicle barrier arm, truck entrance, visitor car check',
    hasAudio: false,
  },
  {
    id: 'clip-warehouse',
    title: 'Warehouse - Loading Bay & Forklifts',
    category: 'warehouse',
    filename: 'warehouse-forklift.mp4',
    durationSeconds: 60,
    resolution: '1920x1080',
    fps: 25,
    description: 'Forklifts moving pallets, high rack storage, dispatch bay',
    hasAudio: false,
  },
  {
    id: 'clip-production',
    title: 'Production Floor - Machinery & Conveyor',
    category: 'production',
    filename: 'production-assembly.mp4',
    durationSeconds: 50,
    resolution: '1920x1080',
    fps: 25,
    description: 'Conveyor belt with items, robotic arms, warning beacons',
    hasAudio: false,
  },
  {
    id: 'clip-perimeter',
    title: 'Perimeter - North Fence Line (Night IR)',
    category: 'perimeter',
    filename: 'perimeter-patrol.mp4',
    durationSeconds: 60,
    resolution: '1920x1080',
    fps: 25,
    description: 'Chainlink boundary fence, moving tree shadows, IR monochrome',
    hasAudio: false,
  },
  {
    id: 'clip-office',
    title: 'Corporate HQ - Lobby & Reception',
    category: 'office',
    filename: 'office-lobby.mp4',
    durationSeconds: 40,
    resolution: '1920x1080',
    fps: 25,
    description: 'Glass entry doors, reception desk, visitor badges',
    hasAudio: false,
  },
  {
    id: 'clip-procedural-canvas',
    title: 'Procedural CCTV Canvas Stream (Live OSD Clock)',
    category: 'procedural',
    filename: 'procedural-cctv',
    durationSeconds: 0,
    resolution: '1920x1080',
    fps: 25,
    description: 'Real-time procedural surveillance canvas with millisecond timecode and scanlines',
    hasAudio: false,
  },
];

export class MediaLibraryService {
  private customDirs: string[];

  constructor(customDirs?: string[]) {
    this.customDirs = customDirs || [];
  }

  public getSearchDirs(): string[] {
    const dirs: string[] = [];
    // 1. Root media directory (next to executable or cwd)
    const rootMedia = path.resolve(process.cwd(), 'media');
    if (!dirs.includes(rootMedia)) dirs.push(rootMedia);

    // 2. Tools media directory
    const toolsMedia = path.resolve(process.cwd(), 'tools', 'cctv-simulator', 'media');
    if (!dirs.includes(toolsMedia)) dirs.push(toolsMedia);

    // 3. Executable adjacent media directory
    try {
      const execDirMedia = path.resolve(path.dirname(process.execPath), 'media');
      if (!dirs.includes(execDirMedia)) dirs.push(execDirMedia);
    } catch {}

    for (const d of this.customDirs) {
      if (!dirs.includes(d)) dirs.push(d);
    }

    // Ensure all directories exist
    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }

    return dirs;
  }

  public getPrimaryMediaDir(): string {
    const dirs = this.getSearchDirs();
    return dirs[0] || path.resolve(process.cwd(), 'media');
  }

  public getAvailableClips(): VideoClipInfo[] {
    const list: VideoClipInfo[] = [...BUILTIN_CLIPS];
    const seenFilenames = new Set<string>(BUILTIN_CLIPS.map((b) => b.filename));

    for (const dir of this.getSearchDirs()) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (ext === '.mp4' || ext === '.webm' || ext === '.m4v') {
              if (!seenFilenames.has(file)) {
                seenFilenames.add(file);
                const nameWithoutExt = path.basename(file, ext);
                list.push({
                  id: `custom-${nameWithoutExt}`,
                  title: `Custom Video: ${nameWithoutExt.replace(/[-_]/g, ' ').toUpperCase()} (${file})`,
                  category: 'custom',
                  filename: file,
                  durationSeconds: 60,
                  resolution: '1920x1080',
                  fps: 25,
                  description: `User-provided video loop (${file}) in ${dir}`,
                  hasAudio: false,
                });
              }
            }
          }
        }
      } catch {}
    }

    return list;
  }

  public getMediaFilePath(filename: string): string | null {
    for (const dir of this.getSearchDirs()) {
      const target = path.resolve(dir, filename);
      if (fs.existsSync(target)) {
        return target;
      }
    }
    return null;
  }
}

export const mediaLibrary = new MediaLibraryService();
