import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import AdminLoginCard from "../AdminLoginCard.svelte";

describe("AdminLoginCard", () => {
  it("keeps submit button disabled until name and password are set", async () => {
    render(AdminLoginCard, {
      props: {
        adminName: "",
        adminPassword: "",
        adminStatus: "Bitte anmelden."
      }
    });

    const button = screen.getByRole("button", { name: "Anmelden" });
    expect(button).toBeDisabled();

    const nameInput = screen.getByLabelText("Name");
    const passwordInput = screen.getByLabelText("Passwort");

    await fireEvent.input(nameInput, { target: { value: "admin" } });
    await fireEvent.input(passwordInput, { target: { value: "secret" } });

    expect(button).not.toBeDisabled();
  });

  it("emits login event when submit button is clicked", async () => {
    const { component } = render(AdminLoginCard, {
      props: {
        adminName: "admin",
        adminPassword: "secret",
        adminStatus: "Bereit"
      }
    });

    let emitted = false;
    component.$on("login", () => {
      emitted = true;
    });

    await fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));

    expect(emitted).toBe(true);
  });
});
