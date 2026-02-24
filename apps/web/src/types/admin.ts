export type AdminRole = "ADMIN" | "BROADCASTER" | "VIEWER";

export type AdminUser = {
  id: string;
  name: string;
  role: AdminRole;
  createdAt: string;
  sessions?: Array<{
    id: string;
    name: string;
  }>;
};

export type SessionAssignableUser = AdminUser & {
  assigned: boolean;
};
