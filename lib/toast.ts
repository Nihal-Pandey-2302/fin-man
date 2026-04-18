export type AppToastEventDetail = {
  message: string;
  tone?: "info" | "success" | "warning" | "error";
};

export function pushToast(detail: AppToastEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AppToastEventDetail>("app:toast", { detail }));
}
