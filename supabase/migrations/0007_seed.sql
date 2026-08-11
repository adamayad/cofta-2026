-- ============================================================
-- COFTA 2026 — clubs and fixtures
-- Group A: Stevenage, Hounslow, Croydon, Brighton
-- Group B: Golders Green, Hove, Rotherham, Kensington
-- Round robin: 1v2, 3v4 / 1v3, 2v4 / 1v4, 2v3
-- ============================================================

insert into public.teams (id, name, city, colour, text_colour, group_letter) values
  ('smpk', 'St Mary & Pope Kyrillos VI',  'Hounslow',      '#FFFFFF', '#14161A', 'A'),
  ('bri',  'St Mary & St Abraam',         'Brighton',      '#C9A96A', '#2A2214', 'A'),
  ('cro',  'St Mary & St Shenouda',       'Croydon',       '#4FA3DC', '#062338', 'A'),
  ('ste',  'St George',                   'Stevenage',     '#E04C45', '#FFFFFF', 'A'),
  ('gg',   'St Mary & Archangel Michael', 'Golders Green', '#14532D', '#FFFFFF', 'B'),
  ('hove', 'St Mary & Archangel Michael', 'Hove',          '#646C74', '#FFFFFF', 'B'),
  ('rot',  'St Anthony',                  'Rotherham',     '#1E2E63', '#FFFFFF', 'B'),
  ('stm',  'St Mark',                     'Kensington',    '#101014', '#FFFFFF', 'B')
on conflict (id) do nothing;

insert into public.matches (stage, day, kickoff, pitch, home_team, away_team) values
  ('A', 1, '09:30', 'Pitch One', 'ste',  'smpk'),
  ('B', 1, '09:30', 'Pitch Two', 'gg',   'hove'),
  ('A', 1, '10:15', 'Pitch One', 'cro',  'bri'),
  ('B', 1, '10:15', 'Pitch Two', 'rot',  'stm'),
  ('A', 1, '11:00', 'Pitch One', 'ste',  'cro'),
  ('B', 1, '11:00', 'Pitch Two', 'gg',   'rot'),
  ('A', 1, '11:45', 'Pitch One', 'smpk', 'bri'),
  ('B', 1, '11:45', 'Pitch Two', 'hove', 'stm'),
  ('A', 1, '12:30', 'Pitch One', 'ste',  'bri'),
  ('B', 1, '12:30', 'Pitch Two', 'gg',   'stm'),
  ('A', 1, '13:15', 'Pitch One', 'smpk', 'cro'),
  ('B', 1, '13:15', 'Pitch Two', 'hove', 'rot'),
  ('SF1',   2, '11:00', 'Pitch One', null, null),
  ('SF2',   2, '12:00', 'Pitch One', null, null),
  ('FINAL', 2, '14:00', 'Pitch One', null, null);
