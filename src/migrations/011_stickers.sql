CREATE TABLE sticker_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  cover_url   TEXT NOT NULL,
  category    VARCHAR(50) NOT NULL DEFAULT 'general',
  is_premium  BOOLEAN NOT NULL DEFAULT FALSE,
  price_coins INTEGER,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE stickers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  file_url    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_sticker_packs (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id     UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, pack_id)
);

CREATE INDEX idx_stickers_pack ON stickers(pack_id, sort_order);

-- Seed 3 default free packs
INSERT INTO sticker_packs (id, name, cover_url, category, is_premium, sort_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Kwento Basics',  'https://cdn.kwento.app/stickers/packs/basics/cover.webp',   'general', FALSE, 1),
  ('00000000-0000-0000-0000-000000000002', 'OFW Life',       'https://cdn.kwento.app/stickers/packs/ofw/cover.webp',      'ofw',     FALSE, 2),
  ('00000000-0000-0000-0000-000000000003', 'Pinoy Vibes',    'https://cdn.kwento.app/stickers/packs/pinoy/cover.webp',    'pinoy',   FALSE, 3);

-- Kwento Basics stickers
INSERT INTO stickers (pack_id, name, file_url, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Happy',         'https://cdn.kwento.app/stickers/packs/basics/happy.webp',        1),
  ('00000000-0000-0000-0000-000000000001', 'Sad',           'https://cdn.kwento.app/stickers/packs/basics/sad.webp',          2),
  ('00000000-0000-0000-0000-000000000001', 'Love',          'https://cdn.kwento.app/stickers/packs/basics/love.webp',         3),
  ('00000000-0000-0000-0000-000000000001', 'Thumbs Up',     'https://cdn.kwento.app/stickers/packs/basics/thumbsup.webp',     4),
  ('00000000-0000-0000-0000-000000000001', 'Laughing',      'https://cdn.kwento.app/stickers/packs/basics/laughing.webp',     5),
  ('00000000-0000-0000-0000-000000000001', 'Surprised',     'https://cdn.kwento.app/stickers/packs/basics/surprised.webp',   6),
  ('00000000-0000-0000-0000-000000000001', 'Crying',        'https://cdn.kwento.app/stickers/packs/basics/crying.webp',      7),
  ('00000000-0000-0000-0000-000000000001', 'Angry',         'https://cdn.kwento.app/stickers/packs/basics/angry.webp',       8);

-- OFW Life stickers
INSERT INTO stickers (pack_id, name, file_url, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Miss Mo Ko',    'https://cdn.kwento.app/stickers/packs/ofw/miss-mo-ko.webp',     1),
  ('00000000-0000-0000-0000-000000000002', 'Calling Home',  'https://cdn.kwento.app/stickers/packs/ofw/calling-home.webp',   2),
  ('00000000-0000-0000-0000-000000000002', 'Padala',        'https://cdn.kwento.app/stickers/packs/ofw/padala.webp',         3),
  ('00000000-0000-0000-0000-000000000002', 'Fiesta',        'https://cdn.kwento.app/stickers/packs/ofw/fiesta.webp',         4),
  ('00000000-0000-0000-0000-000000000002', 'Homesick',      'https://cdn.kwento.app/stickers/packs/ofw/homesick.webp',       5),
  ('00000000-0000-0000-0000-000000000002', 'Uwi Na',        'https://cdn.kwento.app/stickers/packs/ofw/uwi-na.webp',         6);

-- Pinoy Vibes stickers
INSERT INTO stickers (pack_id, name, file_url, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000003', 'Bes!',          'https://cdn.kwento.app/stickers/packs/pinoy/bes.webp',          1),
  ('00000000-0000-0000-0000-000000000003', 'Lodi!',         'https://cdn.kwento.app/stickers/packs/pinoy/lodi.webp',         2),
  ('00000000-0000-0000-0000-000000000003', 'Ayos Yan!',     'https://cdn.kwento.app/stickers/packs/pinoy/ayos-yan.webp',     3),
  ('00000000-0000-0000-0000-000000000003', 'Charot!',       'https://cdn.kwento.app/stickers/packs/pinoy/charot.webp',       4),
  ('00000000-0000-0000-0000-000000000003', 'Grabe Naman!',  'https://cdn.kwento.app/stickers/packs/pinoy/grabe-naman.webp', 5),
  ('00000000-0000-0000-0000-000000000003', 'Sus!',          'https://cdn.kwento.app/stickers/packs/pinoy/sus.webp',          6);
