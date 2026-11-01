import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Whether the browser thinks it's online (offline: the app shows cached data). */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
