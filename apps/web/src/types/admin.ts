export type AdminRole = "ADMIN" | "BROADCASTER" | "VIEWER";

export type AdminUser = {
  id: string;
  name: string;
  role: AdminRole;
  createdAt: string;
};
