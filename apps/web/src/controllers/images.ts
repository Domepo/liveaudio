import { app } from "../stores/app";

export function handleCreateImageUpload(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    app.update((s) => ({ ...s, createSessionImageUrl: String(reader.result ?? "") }));
  };
  reader.readAsDataURL(file);
  target.value = "";
}

export function handleEditImageUpload(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    app.update((s) => ({ ...s, sessionImageUrl: String(reader.result ?? "") }));
  };
  reader.readAsDataURL(file);
  target.value = "";
}

