import { describe, expect, test } from 'bun:test';
import { residentRoutes, searchResidentRoutes } from './resident';

describe('居民巴士路線搜尋', () => {
  test('運輸署三區名單完整保留官方路線及文件連結', () => {
    expect(residentRoutes.length).toBe(255);
    expect(new Set(residentRoutes.map(r => r.region)).size).toBe(3);
    expect(residentRoutes.every(r => r.description && r.source.startsWith('https://www.td.gov.hk/'))).toBe(true);
  });
  test('可省略 NR 前綴並優先顯示完全符合號碼', () => {
    expect(searchResidentRoutes('330')[0].route).toBe('NR330');
    expect(searchResidentRoutes('  nr332  ')[0].route).toBe('NR332');
    expect(searchResidentRoutes('338S')[0].route).toBe('NR338S');
  });
  test('可搜尋屋苑及目的地，不相關號碼不回傳結果', () => {
    expect(searchResidentRoutes('馬灣').some(r => r.route === 'NR332')).toBe(true);
    expect(searchResidentRoutes('青衣').some(r => r.route === 'NR330')).toBe(true);
    expect(searchResidentRoutes('不存在的路線')).toEqual([]);
    expect(searchResidentRoutes('DB01R')[0].route).toBe('DB01R');
  });
});
