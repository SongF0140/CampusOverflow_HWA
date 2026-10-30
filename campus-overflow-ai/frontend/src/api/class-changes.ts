import { apiFetch } from "./client";

export interface ClassChange {
  request_id: string; course_id: number; course_name: string; action: "add" | "remove";
  status: "pending" | "executed" | "expired" | "cancelled"; executed: boolean; requires_confirmation: boolean;
  students: Array<{ user_id: number; username: string; joined: boolean }>;
}
export const fetchClassChange = (id: string) => apiFetch<ClassChange>(`/class-changes/${encodeURIComponent(id)}`);
export const confirmClassChange = (id: string, operation: "confirm" | "cancel") =>
  apiFetch<ClassChange>(`/class-changes/${encodeURIComponent(id)}/${operation}`, { method: "POST" });
