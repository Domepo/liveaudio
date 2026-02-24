import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { app, prisma, server } from "../main";

async function resetDatabase(): Promise<void> {
  await prisma.analyticsPoint.deleteMany();
  await prisma.accessLog.deleteMany();
  await prisma.joinToken.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.sessionUserAccess.deleteMany();
  await prisma.templateChannel.deleteMany();
  await prisma.sessionTemplate.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appConfig.deleteMany();
}

describe("admin auth and branding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    server.close();
  });

  it("rejects unauthenticated access to /api/admin/me", async () => {
    const response = await request(app).get("/api/admin/me");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  it("allows admin login and logo branding update", async () => {
    const password = "secret123";
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Admin Test",
        email: "admin-test@local.admin",
        role: "ADMIN",
        passwordHash: hash
      }
    });

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Admin Test", password });
    expect(loginResponse.status).toBe(200);

    const meResponse = await agent.get("/api/admin/me");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.authenticated).toBe(true);
    expect(meResponse.body.role).toBe("ADMIN");

    const logoDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const logoUpdate = await agent.put("/api/admin/settings/logo").send({ logoDataUrl });
    expect(logoUpdate.status).toBe(200);
    expect(logoUpdate.body.logoUrl).toBe(logoDataUrl);

    const branding = await request(app).get("/api/public/branding");
    expect(branding.status).toBe(200);
    expect(branding.body.logoUrl).toBe(logoDataUrl);
  });

  it("renews the admin session cookie when the JWT is close to expiry", async () => {
    const password = "secret123";
    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Admin Renew",
        email: "admin-renew@local.admin",
        role: "ADMIN",
        passwordHash: hash
      }
    });

    const shortLivedToken = jwt.sign(
      {
        role: "ADMIN",
        authType: "user",
        userName: user.name,
        userId: user.id,
        sv: 0
      },
      process.env.JWT_SECRET ?? "dev-secret",
      { expiresIn: "5m", issuer: process.env.JWT_ISSUER ?? "liveaudio-api", subject: user.id, algorithm: "HS256" }
    );

    const response = await request(app)
      .get("/api/admin/me")
      .set("Cookie", [`admin_session=${encodeURIComponent(shortLivedToken)}`]);

    expect(response.status).toBe(200);
    const setCookieHeader = response.headers["set-cookie"] as unknown;
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join("\n") : String(setCookieHeader ?? "");
    expect(cookieStr).toContain("admin_session=");
  });

  it("prevents viewer from opening user administration", async () => {
    const password = "viewer123";
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Viewer Test",
        email: "viewer-test@local.admin",
        role: "VIEWER",
        passwordHash: hash
      }
    });

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Viewer Test", password });
    expect(loginResponse.status).toBe(200);

    const usersResponse = await agent.get("/api/admin/users");
    expect(usersResponse.status).toBe(403);
    expect(usersResponse.body.error).toBe("Insufficient permissions");
  });

  it("invalidates old admin cookie after logout", async () => {
    const password = "logout123";
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Admin Logout",
        email: "admin-logout@local.admin",
        role: "ADMIN",
        passwordHash: hash
      }
    });

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Admin Logout", password });
    expect(loginResponse.status).toBe(200);
    const loginCookie = loginResponse.headers["set-cookie"]?.[0];
    expect(loginCookie).toBeTruthy();

    const logoutResponse = await agent.post("/api/admin/logout");
    expect(logoutResponse.status).toBe(200);

    const replayResponse = await request(app).get("/api/admin/me").set("Cookie", [String(loginCookie)]);
    expect(replayResponse.status).toBe(401);
  });

  it("invalidates current cookie after password change", async () => {
    const password = "Pw-change-1!";
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Admin PW",
        email: "admin-pw@local.admin",
        role: "ADMIN",
        passwordHash: hash
      }
    });

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Admin PW", password });
    expect(loginResponse.status).toBe(200);
    const oldCookie = loginResponse.headers["set-cookie"]?.[0];
    expect(oldCookie).toBeTruthy();

    const changeResponse = await agent.post("/api/admin/change-password").send({
      currentPassword: password,
      newPassword: "Pw-change-2!",
      confirmPassword: "Pw-change-2!"
    });
    expect(changeResponse.status).toBe(200);

    const replayResponse = await request(app).get("/api/admin/me").set("Cookie", [String(oldCookie)]);
    expect(replayResponse.status).toBe(401);
  });

  it("requires immediate password change for bootstrap admin login", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "admin", password: "test" });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.mustChangePassword).toBe(true);

    const meResponse = await agent.get("/api/admin/me");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.mustChangePassword).toBe(true);

    const blockedResponse = await agent.get("/api/admin/users");
    expect(blockedResponse.status).toBe(403);
    expect(blockedResponse.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const weakChangeResponse = await agent.post("/api/admin/change-password").send({
      currentPassword: "test",
      newPassword: "abc123",
      confirmPassword: "abc123"
    });
    expect(weakChangeResponse.status).toBe(400);

    const validChangeResponse = await agent.post("/api/admin/change-password").send({
      currentPassword: "test",
      newPassword: "Admin-test-2A!",
      confirmPassword: "Admin-test-2A!"
    });
    expect(validChangeResponse.status).toBe(200);
  });

  it("limits broadcaster session access to assigned sessions", async () => {
    const adminPassword = "admin123";
    const broadcasterPassword = "broadcaster123";
    const adminHash = await bcrypt.hash(adminPassword, 12);
    const broadcasterHash = await bcrypt.hash(broadcasterPassword, 12);

    const [adminUser, broadcaster] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Scope",
          email: "admin-scope@local.admin",
          role: "ADMIN",
          passwordHash: adminHash
        }
      }),
      prisma.user.create({
        data: {
          name: "Broadcaster Scope",
          email: "broadcaster-scope@local.admin",
          role: "BROADCASTER",
          passwordHash: broadcasterHash
        }
      })
    ]);

    const [sessionA, sessionB] = await Promise.all([
      prisma.session.create({
        data: {
          name: "Session A",
          broadcastCode: "123456",
          broadcastCodeHash: await bcrypt.hash("123456", 10),
          createdByUserId: adminUser.id
        }
      }),
      prisma.session.create({
        data: {
          name: "Session B",
          broadcastCode: "654321",
          broadcastCodeHash: await bcrypt.hash("654321", 10),
          createdByUserId: adminUser.id
        }
      })
    ]);

    await prisma.sessionUserAccess.create({
      data: {
        sessionId: sessionA.id,
        userId: broadcaster.id
      }
    });

    const broadcasterAgent = request.agent(app);
    const loginResponse = await broadcasterAgent.post("/api/admin/login").send({
      name: "Broadcaster Scope",
      password: broadcasterPassword
    });
    expect(loginResponse.status).toBe(200);

    const sessionsResponse = await broadcasterAgent.get("/api/admin/sessions");
    expect(sessionsResponse.status).toBe(200);
    expect(sessionsResponse.body).toHaveLength(1);
    expect(sessionsResponse.body[0].id).toBe(sessionA.id);

    const allowedSession = await broadcasterAgent.get(`/api/admin/sessions/${sessionA.id}`);
    expect(allowedSession.status).toBe(200);
    expect(allowedSession.body.session.id).toBe(sessionA.id);

    const blockedSession = await broadcasterAgent.get(`/api/admin/sessions/${sessionB.id}`);
    expect(blockedSession.status).toBe(404);
    expect(blockedSession.body.error).toBe("Session not found");
  });

  it("allows admin to delete another user but not self", async () => {
    const adminPassword = "admin123";
    const adminHash = await bcrypt.hash(adminPassword, 12);

    const [adminUser, deletableUser] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Delete",
          email: "admin-delete@local.admin",
          role: "ADMIN",
          passwordHash: adminHash
        }
      }),
      prisma.user.create({
        data: {
          name: "Delete Me",
          email: "delete-me@local.admin",
          role: "VIEWER",
          passwordHash: await bcrypt.hash("deleteme", 12)
        }
      })
    ]);

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Admin Delete", password: adminPassword });
    expect(loginResponse.status).toBe(200);

    const deleteOther = await agent.delete(`/api/admin/users/${deletableUser.id}`);
    expect(deleteOther.status).toBe(200);
    expect(deleteOther.body.ok).toBe(true);

    const deletedLookup = await prisma.user.findUnique({ where: { id: deletableUser.id } });
    expect(deletedLookup).toBeNull();

    const deleteSelf = await agent.delete(`/api/admin/users/${adminUser.id}`);
    expect(deleteSelf.status).toBe(400);
  });

  it("returns analytics v2 compare data for selected sessions", async () => {
    const password = "admin123";
    const hash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        name: "Admin Analytics",
        email: "admin-analytics@local.admin",
        role: "ADMIN",
        passwordHash: hash
      }
    });
    const [sessionA, sessionB] = await Promise.all([
      prisma.session.create({
        data: {
          name: "A",
          broadcastCode: "111111",
          broadcastCodeHash: await bcrypt.hash("111111", 10),
          createdByUserId: admin.id
        }
      }),
      prisma.session.create({
        data: {
          name: "B",
          broadcastCode: "222222",
          broadcastCodeHash: await bcrypt.hash("222222", 10),
          createdByUserId: admin.id
        }
      })
    ]);

    await prisma.analyticsPoint.createMany({
      data: [
        { sessionId: sessionA.id, metric: "listeners_total", value: 4, ts: new Date("2026-01-01T10:00:00.000Z") },
        { sessionId: sessionA.id, metric: "listeners_total", value: 7, ts: new Date("2026-01-01T10:01:00.000Z") },
        { sessionId: sessionB.id, metric: "listeners_total", value: 3, ts: new Date("2026-01-01T10:00:00.000Z") },
        { sessionId: sessionB.id, metric: "listeners_total", value: 9, ts: new Date("2026-01-01T10:01:00.000Z") }
      ]
    });

    const agent = request.agent(app);
    const loginResponse = await agent.post("/api/admin/login").send({ name: "Admin Analytics", password });
    expect(loginResponse.status).toBe(200);

    const response = await agent.get(
      `/api/admin/analytics/v2/compare?sessionIds=${sessionA.id},${sessionB.id}&from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z&metric=listeners_total&granularity=1m`
    );
    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(2);
    expect(response.body.ranking?.length).toBe(2);
  });
});
