-- Hove have withdrawn; Kidane Mihret take their place in Group B.
-- The internal id 'hove' is retained so fixtures, squad rows and events
-- keep their references — only the visible identity changes.
-- They wear white: same treatment as SMPK, dark text on the white block.

update public.teams set
  name = 'Kidane Mihret',
  city = 'Willesden',
  colour = '#FFFFFF',
  text_colour = '#14161A'
where id = 'hove';
