import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { app, prisma, server } from "../main";

async function resetDatabase(): Promise<void> {
  await prisma.accessLog.deleteMany();
  await prisma.joinToken.deleteMany();
  await prisma.channel.deleteMany();
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
});
