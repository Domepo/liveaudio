import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import AdminUsersPanel from "../AdminUsersPanel.svelte";

describe("AdminUsersPanel", () => {
  it("renders user list and sends update payload from edit row", async () => {
    const { component } = render(AdminUsersPanel, {
      props: {
        adminAuthenticatedName: "Admin",
        adminUsers: [
          { id: "u1", name: "Max", role: "VIEWER", createdAt: new Date().toISOString() }
        ],
        adminRoles: ["ADMIN", "BROADCASTER", "VIEWER"],
        createUserName: "",
        createUserPassword: "",
        createUserRole: "VIEWER"
      }
    });
    const events: Array<Record<string, unknown>> = [];
    component.$on("updateUser", (event) => {
      events.push(event.detail as Record<string, unknown>);
    });

    expect(screen.getByText("Max")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));

    const passwordInput = screen.getByPlaceholderText("Neues Passwort eingeben");
    await fireEvent.input(passwordInput, { target: { value: "newpass1" } });

    await fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: "u1",
      name: "Max",
      role: "VIEWER",
      password: "newpass1"
    });
  });
});
