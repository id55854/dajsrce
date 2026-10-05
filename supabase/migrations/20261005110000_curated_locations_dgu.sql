-- Curated institutions on their DGU buildings (Caritas feedback, 2026-09-30).
--
-- The curated institutions were seeded with hand-placed points. Caritas
-- Zagrebačke nadbiskupije reported that everything at Babonićeva 121
-- (Šalata) pointed at Črnomerec, across the city: the stored point was
-- 4.3 km west of the building, and the directions link followed it. A DGU
-- audit of every curated institution (scripts/audit-dgu-address-match.mjs
-- --institutions against the INSPIRE Addresses archive of 2026-09-30) put
-- 36 of them on their building: 32 matched automatically, four by hand
-- (an address the matcher could not resolve, checked in the same archive).
-- Dom za djecu Slavonski Brod (Kumičićeva 37) is left as it is: DGU has
-- numbers 35, 36 and 38 there, but no 37.
--
-- Each point moves only if it is still the one the audit read, so a replay,
-- or a point an administrator has corrected since, is left alone. The
-- public point follows through set_institution_public_location.
--
-- The hand-typed "nearest ZET stop" text of every institution goes too. It
-- was written for the old points (Babonićeva 121 said Črnomerec), nothing
-- keeps it current, and the detail panel shows no stop section without it.

BEGIN;

UPDATE public.institutions i
SET lat = v.new_lat,
    lng = v.new_lng,
    updated_at = now()
FROM (VALUES
    -- Dom za djecu Zagreb — podružnica Laduč: Zagrebačka 106, Laduč -> DGU KB.0000328403 "Zagrebačka cesta 106 Gornji Laduč", 12944 m
    ('e8b2434a-e9ea-4101-b398-59d168e6fe69', 45.809, 15.834, 45.886338, 15.709097),
    -- Prihvatilište za beskućnike Crvenog križa: Domovinska ulica 10, Velika Kosnica -> DGU KB.0001200354 "Domovinska ulica 10 Velika Kosnica", 7795 m
    ('1469ef27-f3e4-46d0-b32b-a030946641be', 45.7195, 16.002, 45.76577643, 16.07745938),
    -- Pučka kuhinja Dobri dom — Cerska: Cerska 3, Zagreb -> DGU KB.0022048931 "Cerska ulica 3 Zagreb", 6598 m
    ('6cb236c5-dd8c-4f70-9b11-4f9dd476a7cb', 45.8028, 15.9622, 45.82398023, 16.04172797),
    -- Socijalna samoposluga Caritasa: Crnojezerska 20, Zagreb -> DGU KB.0022057252 "Crnojezerska ulica 20 Zagreb", 5498 m
    ('9a7e6e43-a963-4e46-a2fc-4285a8d622b8', 45.7975, 15.951, 45.816156, 15.88531381),
    -- Prihvatilište Caritasa Zagrebačke nadbiskupije: Dugoselska 71, Sesvetski Kraljevec -> DGU KB.0022002002 "Dugoselska cesta 71 Sesvete-Kraljevec", 5017 m
    ('7be2648a-65d2-4c5a-996c-23d8b17c5897', 45.8273, 16.1185, 45.815241, 16.180882),
    -- Kuća sv. Franje — Caritas (djeca): Vugrovec Augusta Šenoe 52, Sesvete -> DGU KB.0022023603 "Ulica Augusta Šenoe 52 Vugrovec", 4396 m
    ('535ef328-8746-4d20-b65c-fce7a5f1186b', 45.8538, 16.0682, 45.881062, 16.109321),
    -- Caritas Zagrebačke nadbiskupije — Socijalna služba: Babonićeva 121, Zagreb -> DGU KB.0022123368 "Ulica Stjepana Babonića 121 Zagreb", 4284 m
    ('c7d3ce6a-7fda-4fc6-8d85-64d0afa896be', 45.809, 15.9372, 45.82437414, 15.98788045),
    -- Caritas — Obiteljsko savjetovalište: Babonićeva 121, Zagreb -> DGU KB.0022123368 "Ulica Stjepana Babonića 121 Zagreb", 4284 m
    ('ca1ed63a-96e2-4022-95a9-792964af2732', 45.809, 15.9372, 45.82437414, 15.98788045),
    -- Caritas — Pomoć u kući starijima: Babonićeva 121, Zagreb -> DGU KB.0022123368 "Ulica Stjepana Babonića 121 Zagreb", 4284 m
    ('b98d9a90-a372-4a15-b16e-62a9c8ecdffc', 45.809, 15.9372, 45.82437414, 15.98788045),
    -- Udruga Pet Plus — dnevni boravak: Ščitarjevska 11, Zagreb -> DGU KB.0022083131 "Šćitarjevska ulica 11 Zagreb", 3713 m
    ('1b93f228-c596-4ed6-b267-eef31d249b1b', 45.7815, 15.988, 45.80872002, 16.01573104),
    -- Kuća Bl. Alojzije Stepinac — Brezovica (djeca s teškoćama): Brezovička cesta 98, Brezovica -> DGU KB.0022016025 "Brezovička cesta 98 Brezovica", 3650 m
    ('627f126b-a904-40a2-813d-d38ae78cbb4b', 45.758, 15.919, 45.7257752, 15.91002474),
    -- Dom za djecu "Maslina" — Dubrovnik: Vlahe Bukovca 5, Dubrovnik -> DGU KB.0000244406 "Vlaha Bukovca 5 Dubrovnik", 3482 m
    ('ebb03fef-6d78-48ec-8ee7-c7cbfb161776', 42.651, 18.087, 42.63933723, 18.12651338),
    -- Kuća ljubavi — Caritas (trudnice i bebe): Budaševska 20, Zagreb -> DGU KB.0022105093 "Budaševska ulica 20 Zagreb", 2715 m
    ('5631a6d9-b88a-454d-9a21-11251898737d', 45.791, 15.985, 45.78887732, 16.01988582),
    -- Pučka kuhinja Dobri dom — Alfirevićeva: Alfirevićeva 6, Zagreb -> DGU KB.0022083517 "Ulica Frana Alfirevića 6 Zagreb", 2093 m
    ('8591f671-1096-489d-b09b-5a4ffc1a43da', 45.8152, 15.9933, 45.81013108, 16.01931093),
    -- Stambena zajednica za osobe s invaliditetom — Trešnjevka: Nijemčanska 14, Zagreb -> DGU KB.0022065730 "Nijemčanska ulica 14 Zagreb", 1642 m
    ('74036df1-4e13-4521-9439-87b6b098c4aa', 45.802, 15.952, 45.79949968, 15.93112486),
    -- Udruga Dom nade — poludnevni boravak: Harambašićeva 20, Zagreb -> DGU KB.0022077074 "Ulica Augusta Harambašića 20 Zagreb", 1461 m
    ('9e64b4a3-c7d8-4118-86b6-5df55d7530c7', 45.8095, 15.991, 45.81541805, 16.00782303),
    -- Dom za djecu "Pula": Pino Budićin 17, Pula -> DGU KB.0000872678 "Budicinova ulica - Via Pino Budicin 17 Pula", 1357 m
    ('8d88178a-d10b-49b5-a516-e356492fde8a', 44.8697, 13.841, 44.85750021, 13.84111096),
    -- Dom za djecu "Sveta Ana" — Vinkovci: Anina 2d, Vinkovci -> DGU KB.0001199682 "Anina ulica 2D Vinkovci", 1110 m
    ('beb85638-c64f-4fed-a27e-633308c4f312', 45.2886, 18.7952, 45.29139679, 18.80881668),
    -- Dom za djecu "Klasje" — Osijek: Ružina 32, Osijek -> DGU KB.0000743208 "Ružina ulica 32 Osijek", 916 m
    ('f330a3a1-4532-4cf6-b36b-53d2836cefc0', 45.555, 18.6835, 45.55797988, 18.67253267),
    -- Dom za djecu Zagreb — podružnica I.G. Kovačić: I.G. Kovačića 23, Zagreb -> DGU KB.0022074391 "Ulica Ivana Gorana Kovačića 23 Zagreb", 866 m
    ('51512659-1e17-46ea-9a20-1bf71c5d1233', 45.8112, 15.9665, 45.81878343, 15.96902913),
    -- Dom za djecu "Lipik": Matije Gupca 3, Lipik -> DGU KB.0001507194 "Ulica Matije Gupca 3 Lipik", 761 m
    ('611557d7-e5e7-4a32-8869-e73a0d69f394', 45.4088, 17.1505, 45.41397063, 17.15689111),
    -- Kuća za mlade "Da život imaju!": Selska cesta 165, Zagreb -> DGU KB.2141692431 "Selska cesta 165 Zagreb", 749 m
    ('eb5e3c16-5a20-4d5c-a5c3-28bf8d9139bf', 45.8, 15.935, 45.79702828, 15.94367539),
    -- Organizirano stanovanje za mlade iz alternativne skrbi: Selska cesta 165, Zagreb -> DGU KB.2141692431 "Selska cesta 165 Zagreb", 749 m
    ('44cff414-d47b-4c38-b8df-fe4b0517ba99', 45.8, 15.935, 45.79702828, 15.94367539),
    -- Dom za djecu "Maestral" — Split: Jurja Šižgorića 4, Split -> DGU KB.0001469707 "Šižgorićeva 4 Split", 736 m
    ('1603c123-fc84-4a75-9614-62e78e6c59b1', 43.5125, 16.4505, 43.508965, 16.45822),
    -- Dom za djecu Zagreb — podružnica A.G. Matoš: Selska cesta 132, Zagreb -> DGU KB.0022098013 "Selska cesta 132 Zagreb", 734 m
    ('31c254b4-a4d9-42d0-84b1-23a3e8254d65', 45.8025, 15.94, 45.79631593, 15.94332732),
    -- Dom za djecu "I. Brlić Mažuranić" — Lovran: Omladinska 1, Lovran -> DGU KB.0000585801 "Omladinska 1 Lovran", 684 m
    ('653519da-872c-4a76-bbe4-d08202f5ca06', 45.2917, 14.2723, 45.29768031, 14.27437011),
    -- Dom za djecu "Svitanje" — Koprivnica: Đure Basaričeka 13, Koprivnica -> DGU KB.0000489304 "Ulica Đure Basaričeka 13 Koprivnica", 473 m
    ('d29b51ff-478f-4109-b23e-95d11493935a', 46.1628, 16.8311, 46.16365321, 16.82508879),
    -- Dom za djecu Zagreb — Nazorova: Nazorova 49, Zagreb -> DGU KB.0022071396 "Ulica Vladimira Nazora 49 Zagreb", 434 m
    ('1032a844-0eb6-4930-86b2-431e33c35e2d', 45.814, 15.9643, 45.8177011, 15.96608161),
    -- Pučka kuhinja župe Sv. Antuna Padovanskog: Sveti Duh 31, Zagreb -> DGU KB.0022070595 "Sveti Duh 31 Zagreb", 392 m
    ('f612e61e-7f68-4638-9392-173160c69174', 45.8198, 15.9438, 45.81665016, 15.94152212),
    -- Dom za djecu "Braća Mažuranići" — Novi Vinodolski: A. Mažuranića 5, Novi Vinodolski -> DGU KB.0000689434 "Antona Mažuranića 5 Novi Vinodolski", 373 m
    ('76a40c54-46fc-4896-83af-a99ac77d5645', 45.126, 14.7894, 45.12932383, 14.79006431),
    -- Misionarke ljubavi — sestre Majke Terezije: Jukićeva 24, Zagreb -> DGU KB.0022073256 "Jukićeva ulica 24 Zagreb", 304 m
    ('6d49b269-533e-4ba8-bb64-0220790efa69', 45.8082, 15.9668, 45.80690675, 15.96334394),
    -- Dom za djecu "Izvor" — Selce: E. Antića 20, Selce -> DGU KB.0000961672 "Emila Antića 20 Selce", 235 m
    ('6ccfe8bf-d39e-4a22-8bd6-77ddbc73c644', 45.158, 14.721, 45.15861411, 14.71812804),
    -- Pučka kuhinja Dobri dom — Branimirova: Branimirova 35, Zagreb -> DGU KB.0022134947 "Ulica kneza Branimira 35 Zagreb", 233 m
    ('2605ef07-8f33-4dba-a1f0-07242d7d8da0', 45.8053, 15.983, 45.80574407, 15.98593492),
    -- Prenoćište Dobri dom — Ilica: Ilica 29, Zagreb -> DGU KB.0022071603 "Ilica 29 Zagreb", 208 m
    ('d77a17a5-df33-49f5-b4b2-c1a6831ffbb4', 45.8128, 15.9687, 45.81313635, 15.97134592),
    -- Dom za djecu "Vrbina" — Sisak: Tomislavova 16, Sisak -> DGU KB.0000171918 "Ulica kralja Tomislava 16 Sisak", 138 m
    ('5a2eb712-f004-4457-9f4e-ed2dce95e26c', 45.4831, 16.3728, 45.48336232, 16.37453155),
    -- Dom za djecu "Vladimir Nazor" — Karlovac: Nazorova 10, Karlovac -> DGU KB.0000444757 "Vladimira Nazora 10 Karlovac", 44 m
    ('cc590628-6fa1-4089-a671-4fc28b380049', 45.4906, 15.5494, 45.49096027, 15.5491715)
) AS v(id, old_lat, old_lng, new_lat, new_lng)
WHERE i.id = v.id::uuid
  AND i.source = 'curated'
  AND i.lat = v.old_lat AND i.lng = v.old_lng;

UPDATE public.institutions
SET nearest_zet_stop = NULL, zet_lines = NULL
WHERE nearest_zet_stop IS NOT NULL OR zet_lines IS NOT NULL;

COMMIT;
