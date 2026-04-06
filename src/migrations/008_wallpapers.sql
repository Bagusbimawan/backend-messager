CREATE TABLE IF NOT EXISTS user_wallpapers (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID,
  conversation_type VARCHAR(20) CHECK (conversation_type IN ('dm', 'group', 'community_topic', 'global')),
  wallpaper_type VARCHAR(20) NOT NULL CHECK (wallpaper_type IN ('color', 'gradient', 'pattern', 'photo', 'preset')),
  wallpaper_value TEXT NOT NULL,
  brightness INTEGER DEFAULT 100 CHECK (brightness BETWEEN 0 AND 100),
  blur_amount INTEGER DEFAULT 0 CHECK (blur_amount BETWEEN 0 AND 10),
  extra_config JSONB,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, COALESCE(conversation_id, '00000000-0000-0000-0000-000000000000'::UUID))
);

CREATE TABLE IF NOT EXISTS wallpaper_presets (
  id VARCHAR(50) PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  label VARCHAR(100) NOT NULL,
  label_ph VARCHAR(100),
  thumbnail_url TEXT NOT NULL,
  full_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_wallpapers_user ON user_wallpapers(user_id);
