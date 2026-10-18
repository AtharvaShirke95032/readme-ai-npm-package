interface Dir {
  dirs: Map<string, Dir>;
  files: string[];
  count: number;
}

const newDir = (): Dir => ({ dirs: new Map(), files: [], count: 0 });

/**
 * A compact ASCII tree. Deep folders and long file lists are collapsed
 * so the tree stays readable for both people and the model.
 */
export function buildTree(paths: string[], opts: { maxDepth?: number; maxLines?: number; perDir?: number } = {}): string {
  const maxDepth = opts.maxDepth ?? 4;
  const maxLines = opts.maxLines ?? 150;
  const perDir = opts.perDir ?? 12;

  const root = newDir();
  for (const p of paths) {
    const parts = p.split('/');
    let cur = root;
    cur.count++;
    for (const part of parts.slice(0, -1)) {
      let next = cur.dirs.get(part);
      if (!next) {
        next = newDir();
        cur.dirs.set(part, next);
      }
      next.count++;
      cur = next;
    }
    cur.files.push(parts[parts.length - 1]!);
  }

  const lines: string[] = [];
  const walk = (dir: Dir, prefix: string, depth: number) => {
    const dirNames = [...dir.dirs.keys()].sort();
    const fileNames = [...dir.files].sort();
    const items: { name: string; dir?: Dir }[] = [
      ...dirNames.map((name) => ({ name, dir: dir.dirs.get(name)! })),
      ...fileNames.map((name) => ({ name })),
    ];
    const shown = items.slice(0, perDir);
    const hidden = items.length - shown.length;
    shown.forEach((item, i) => {
      if (lines.length >= maxLines) return;
      const last = i === shown.length - 1 && hidden === 0;
      const branch = last ? '└── ' : '├── ';
      if (item.dir) {
        const collapsed = depth + 1 >= maxDepth && item.dir.count > 0;
        lines.push(`${prefix}${branch}${item.name}/${collapsed ? ` (${item.dir.count} files)` : ''}`);
        if (!collapsed) walk(item.dir, prefix + (last ? '    ' : '│   '), depth + 1);
      } else {
        lines.push(`${prefix}${branch}${item.name}`);
      }
    });
    if (hidden > 0 && lines.length < maxLines) lines.push(`${prefix}└── … ${hidden} more`);
  };
  walk(root, '', 0);
  if (lines.length >= maxLines) lines.push('… (tree truncated)');
  return lines.join('\n');
}
