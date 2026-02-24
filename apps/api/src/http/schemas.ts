import { Role } from "@prisma/client";
import { z } from "zod";

const strongPasswordSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/\d/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol");

export const createSessionSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional()
});

export const createChannelSchema = z.object({ name: z.string().min(2).max(50), languageCode: z.string().max(8).optional() });

export const adminLoginSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200)
});

export const changeAdminPasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: strongPasswordSchema,
    confirmPassword: strongPasswordSchema
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export const createAdminUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  password: strongPasswordSchema,
  role: z.nativeEnum(Role)
});

export const createRecordingSchema = z.object({
  channelId: z.string().min(1).max(100),
  dataUrl: z.string().min(10)
});

export const createPreShowTrackSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(10)
});

export const updateAdminUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    password: strongPasswordSchema.optional(),
    role: z.nativeEnum(Role).optional()
  })
  .refine((input) => input.name !== undefined || input.password !== undefined || input.role !== undefined, {
    message: "At least one field is required"
  });

export const createJoinLinkSchema = z.object({
  joinBaseUrl: z.string().url().optional(),
  token: z.string().regex(/^\d{6}$/)
});

export const validateCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const updateSessionSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional()
});

export const updateSessionUserAccessSchema = z.object({
  assigned: z.boolean()
});

export const analyticsV2QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sessionIds: z.string().optional(),
  channelId: z.string().optional(),
  metric: z.string().optional(),
  granularity: z.enum(["10s", "1m", "15m"]).optional()
});

export const updateAppLogoSchema = z.object({
  logoDataUrl: z
    .string()
    .trim()
    .max(1_000_000)
    .refine((value) => value.startsWith("data:image/"), { message: "Invalid logo format" })
    .nullable()
});
