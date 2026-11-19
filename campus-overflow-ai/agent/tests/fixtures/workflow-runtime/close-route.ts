import { defineHandler } from "nitro";
import { useNitroApp } from "nitro/app";

export default defineHandler(async () => {
  await useNitroApp().hooks.callHook("close");
  return { closed: true };
});
