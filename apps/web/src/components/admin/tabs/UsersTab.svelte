<script lang="ts">
  import AdminUsersPanel from "../../AdminUsersPanel.svelte";
  import { app } from "../../../stores/app";
  import { createAdminUser, deleteAdminUser, loadAdminUsers, updateAdminUser } from "../../../controllers/admin/users";
</script>

<AdminUsersPanel
  adminAuthenticatedName={$app.adminAuthenticatedName}
  adminUsers={$app.adminUsers}
  adminRoles={$app.adminRoles}
  createUserName={$app.createUserName}
  createUserPassword={$app.createUserPassword}
  createUserRole={$app.createUserRole}
  on:refreshUsers={loadAdminUsers}
  on:createUser={createAdminUser}
  on:updateUser={(event) => updateAdminUser(event.detail)}
  on:deleteUser={(event) => deleteAdminUser(event.detail)}
  on:createUserNameChange={(event) => app.update((s) => ({ ...s, createUserName: event.detail.value }))}
  on:createUserPasswordChange={(event) => app.update((s) => ({ ...s, createUserPassword: event.detail.value }))}
  on:createUserRoleChange={(event) => app.update((s) => ({ ...s, createUserRole: event.detail.value }))}
/>

