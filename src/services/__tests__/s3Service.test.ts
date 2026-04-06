import { describe, expect, it } from 'bun:test';
import { resolvePublicUrl } from '../s3Service';

describe('s3Service public URL resolution', () => {
  it('keeps wallpaper preset paths compatible with CDN style URLs', () => {
    const key = 'wallpapers/presets/ph_vibes/jeepney_art.jpg';
    const fallback = resolvePublicUrl(key);

    expect(fallback.endsWith(key)).toBe(true);
    expect(fallback.includes('wallpapers/presets')).toBe(true);
  });
});
