import { apiFetch } from "./client";

export interface ExperienceProposal {
  id: number;
  proposal_id: string;
  course_id: number;
  title: string;
  summary: string;
  steps: string[];
  status: "pending" | "published" | "rejected" | "withdrawn";
}

export const fetchExperienceProposals = (courseId: number) =>
  apiFetch<{ items: ExperienceProposal[]; total: number }>(`/agent-experiences/courses/${courseId}/proposals`);

export const reviewExperience = (id: number, action: "publish" | "reject" | "withdraw") =>
  apiFetch<ExperienceProposal>(`/agent-experiences/${id}/${action}`, { method: "POST" });
