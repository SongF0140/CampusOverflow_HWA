import { z } from "zod";

export interface TrustedKnowledgeTag {
  id: number;
  course_id: number;
  source: "textbook" | "teacher";
  active: boolean;
}

export const CardMetadataSchema = z.object({
  course_id: z.number().int().positive(),
  year: z.number().int().min(1000).max(9999).optional(),
  tag_ids: z.array(z.number().int().positive()).max(50),
  source: z.object({ kind: z.enum(["textbook", "teacher"]), id: z.string().min(1).max(200) }).strict(),
  body: z.object({
    path: z.string().min(1).max(500), bookmark: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  }).strict(),
}).strict();

export interface KnowledgeCard {
  id: string;
  domain: string;
  metadata: z.infer<typeof CardMetadataSchema>;
  summary: string;
}

export interface StoredCard {
  card: KnowledgeCard;
  cardHash: string;
  bodyHash: string;
}

export interface CatalogUpdate {
  version: string;
  added: string[];
  updated: string[];
  removed: string[];
  parsed: number;
  errors: { id: string; code: "invalid_source" }[];
}
