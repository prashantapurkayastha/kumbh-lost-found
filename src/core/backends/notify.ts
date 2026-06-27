import type { Notification } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Notification store — fake SMS/desk-terminal alerts rendered in UI
// ─────────────────────────────────────────────────────────────────────────────

let notifications: Notification[] = [];
let nextId = 1;

export const notifyBackend = {
  send({
    centerId,
    centerName,
    message,
    urgency = "high",
  }: {
    centerId: string;
    centerName: string;
    message: string;
    urgency?: "low" | "medium" | "high";
  }): { success: true; notificationId: string } {
    const n: Notification = {
      id: `NOTIF-${String(nextId++).padStart(4, "0")}`,
      centerId,
      centerName,
      message,
      urgency,
      sentAt: new Date().toISOString(),
      read: false,
    };
    notifications.push(n);
    console.log(`[notify] → ${centerName}: ${message}`);
    return { success: true, notificationId: n.id };
  },

  getAll(): Notification[] {
    return [...notifications];
  },

  getUnread(): Notification[] {
    return notifications.filter((n) => !n.read);
  },

  markRead(id: string): void {
    const n = notifications.find((x) => x.id === id);
    if (n) n.read = true;
  },

  clear(): void {
    notifications = [];
    nextId = 1;
  },
};
