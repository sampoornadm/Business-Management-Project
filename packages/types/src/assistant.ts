import type { SearchResultItemDto } from "./report.js";

export interface AssistantQueryInput {
  message: string;
}

export interface AssistantQueryResultDto {
  reply: string;
  results: SearchResultItemDto[];
}
