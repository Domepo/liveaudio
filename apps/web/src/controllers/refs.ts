export let listenerAudioEl: HTMLAudioElement | null = null;
export let createImageInputEl: HTMLInputElement | null = null;
export let editImageInputEl: HTMLInputElement | null = null;
export let settingsLogoInputEl: HTMLInputElement | null = null;

export function setListenerAudioEl(el: HTMLAudioElement | null): void {
  listenerAudioEl = el;
}

export function setCreateImageInputEl(el: HTMLInputElement | null): void {
  createImageInputEl = el;
}

export function setEditImageInputEl(el: HTMLInputElement | null): void {
  editImageInputEl = el;
}

export function setSettingsLogoInputEl(el: HTMLInputElement | null): void {
  settingsLogoInputEl = el;
}

