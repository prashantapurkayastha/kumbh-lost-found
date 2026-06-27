import { useState, useEffect } from "react";

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const dn = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", dn);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", dn); };
  }, []);
  return online;
}
