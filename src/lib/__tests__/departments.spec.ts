import { describe, it, expect } from 'vitest';
import { buildHierarchy } from '@/lib/departments';

describe('departments hierarchy', () => {
  it('builds tree from flat list', () => {
    const flat = [
      { id: '1', name: 'Ops', parentId: null },
      { id: '2', name: 'FO', parentId: '1' },
      { id: '3', name: 'FNB', parentId: '1' },
      { id: '4', name: 'Bar', parentId: '3' },
    ];
    const tree = buildHierarchy(flat as any);
    expect(tree.length).toBe(1);
    expect(tree[0].children?.length).toBe(2);
    const fnb = tree[0].children?.find(n => n.name === 'FNB');
    expect(fnb?.children?.length).toBe(1);
    expect(fnb?.children?.[0].name).toBe('Bar');
  });
});

