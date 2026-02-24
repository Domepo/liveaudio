-- Dev seed data (idempotent): 5 users + 10 sessions with images.

INSERT OR IGNORE INTO "User" ("id","name","email","passwordHash","role") VALUES
  ('dev-user-admin','admin','admin@local.admin','$2a$12$pPes64LgxM.Rss9WMrTud.g7YD7zUNf3L8avQcjLlPy.WLLHw48iu','ADMIN'),
  ('dev-user-technik','technik','technik@local.admin','$2a$12$yenMgHq0OaeqCPc3JNXKMeArlP/zbGGEnqKu2Db6vAtgAxuWKiMVa','BROADCASTER'),
  ('dev-user-regie','regie','regie@local.admin','$2a$12$Yu2QA9YFgDyXhJNtO6W5B.MI6Xa2RvkFdL7AyYOU7ByrhpPb.BORa','BROADCASTER'),
  ('dev-user-media','media','media@local.admin','$2a$12$wc47hqze/dR9u6DaL0idFuC7AXp9I.l0ch5ZT5/jHjSic0etYNaPO','VIEWER'),
  ('dev-user-gast','gast','gast@local.admin','$2a$12$YSiqGODsStO/UIAfhDX9NudEXiC4pPtdeiIERCER15Y2Z2LKvgq56','VIEWER');

-- Make dev credentials predictable: password is "test" for all seeded users.
-- Hash matches `ADMIN_PASSWORD_HASH` default in `apps/api/src/main.ts`.
UPDATE "User"
SET "passwordHash" = '$2a$12$CBpEnaQBlvvAY/Z.kqa/JOCAawr.Hdn48.x44Vae4DuyEklXWm0ea'
WHERE "id" IN ('dev-user-admin','dev-user-technik','dev-user-regie','dev-user-media','dev-user-gast');

INSERT OR IGNORE INTO "Session" ("id","name","description","imageUrl","broadcastCode","status","createdByUserId") VALUES
  ('dev-session-01','Sonntag 09:30','Hauptgottesdienst - Vormittag','https://picsum.photos/seed/liveaudio-01/1200/600','100001','ACTIVE','dev-user-admin'),
  ('dev-session-02','Sonntag 11:00','Predigt + Lobpreis','https://picsum.photos/seed/liveaudio-02/1200/600','100002','ACTIVE','dev-user-admin'),
  ('dev-session-03','Jugendabend','Jugendtreff mit Worship','https://picsum.photos/seed/liveaudio-03/1200/600','100003','ACTIVE','dev-user-admin'),
  ('dev-session-04','Bibelstunde','Mittwoch Bibelstunde','https://picsum.photos/seed/liveaudio-04/1200/600','100004','ACTIVE','dev-user-admin'),
  ('dev-session-05','Gebetsabend','Gemeinsames Gebet','https://picsum.photos/seed/liveaudio-05/1200/600','100005','ACTIVE','dev-user-admin'),
  ('dev-session-06','Taufgottesdienst','Sondergottesdienst mit Taufe','https://picsum.photos/seed/liveaudio-06/1200/600','100006','ACTIVE','dev-user-admin'),
  ('dev-session-07','Lobpreisnacht','Abendveranstaltung','https://picsum.photos/seed/liveaudio-07/1200/600','100007','ACTIVE','dev-user-admin'),
  ('dev-session-08','Hauskreis','Kleingruppe Nord','https://picsum.photos/seed/liveaudio-08/1200/600','100008','ACTIVE','dev-user-admin'),
  ('dev-session-09','Seminar','Lehrabend','https://picsum.photos/seed/liveaudio-09/1200/600','100009','ACTIVE','dev-user-admin'),
  ('dev-session-10','Weihnachtsprobe','Musikteam Probe','https://picsum.photos/seed/liveaudio-10/1200/600','100010','ACTIVE','dev-user-admin');

INSERT OR IGNORE INTO "SessionUserAccess" ("id","sessionId","userId") VALUES
  ('dev-access-01','dev-session-01','dev-user-technik'),
  ('dev-access-02','dev-session-02','dev-user-technik'),
  ('dev-access-03','dev-session-03','dev-user-technik'),
  ('dev-access-04','dev-session-04','dev-user-technik'),
  ('dev-access-05','dev-session-05','dev-user-technik'),
  ('dev-access-06','dev-session-06','dev-user-regie'),
  ('dev-access-07','dev-session-07','dev-user-regie'),
  ('dev-access-08','dev-session-08','dev-user-regie'),
  ('dev-access-09','dev-session-09','dev-user-regie'),
  ('dev-access-10','dev-session-10','dev-user-regie'),
  ('dev-access-11','dev-session-01','dev-user-admin'),
  ('dev-access-12','dev-session-02','dev-user-admin'),
  ('dev-access-13','dev-session-03','dev-user-admin'),
  ('dev-access-14','dev-session-04','dev-user-admin'),
  ('dev-access-15','dev-session-05','dev-user-admin'),
  ('dev-access-16','dev-session-06','dev-user-admin'),
  ('dev-access-17','dev-session-07','dev-user-admin'),
  ('dev-access-18','dev-session-08','dev-user-admin'),
  ('dev-access-19','dev-session-09','dev-user-admin'),
  ('dev-access-20','dev-session-10','dev-user-admin');
