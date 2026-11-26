import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(process.cwd(), 'src/app');

function declaredScreens(layoutPath: string): string[] {
  const source = readFileSync(join(appRoot, layoutPath), 'utf8');
  return [...source.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]);
}

function actualChildRoutes(dir: string, base: string): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (existsSync(join(full, '_layout.tsx'))) {
        routes.push(entry.name);
      } else {
        routes.push(...actualChildRoutes(full, base));
      }
      continue;
    }

    if (!entry.name.endsWith('.tsx')) continue;
    const relativePath = relative(base, full).replace(/\\/g, '/').replace(/\.tsx$/, '');
    const route = relativePath.endsWith('/index')
      ? relativePath.slice(0, -'/index'.length)
      : relativePath;
    routes.push(route || 'index');
  }

  return [...new Set(routes)].sort();
}

describe('Expo Router layouts', () => {
  it('declares only real root routes', () => {
    expect(declaredScreens('_layout.tsx').sort()).toEqual(
      actualChildRoutes(appRoot, appRoot),
    );
  });

  it('declares only real team routes', () => {
    expect(declaredScreens('team/[teamId]/_layout.tsx').sort()).toEqual(
      actualChildRoutes(join(appRoot, 'team/[teamId]'), join(appRoot, 'team/[teamId]')),
    );
  });

  it('declares only real tab routes', () => {
    expect(declaredScreens('team/[teamId]/(tabs)/_layout.tsx').sort()).toEqual(
      actualChildRoutes(
        join(appRoot, 'team/[teamId]/(tabs)'),
        join(appRoot, 'team/[teamId]/(tabs)'),
      ),
    );
  });

  it('shows the exact route tree for the phone checks', () => {
    expect(actualChildRoutes(join(appRoot, 'team/[teamId]'), join(appRoot, 'team/[teamId]'))).toEqual(
      [
        '(tabs)',
        'invite',
        'shift/[shiftId]',
        'shifts/[shiftId]/edit',
        'shifts/[shiftId]/swap',
        'shifts/new',
      ],
    );
    expect(
      actualChildRoutes(
        join(appRoot, 'team/[teamId]/(tabs)'),
        join(appRoot, 'team/[teamId]/(tabs)'),
      ),
    ).toEqual(['activity', 'index', 'members', 'swaps']);
  });
});
