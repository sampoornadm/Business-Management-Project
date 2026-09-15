import type { Prisma } from "@bmp/database";
import type { ProjectFilterField, ProjectSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const PROJECT_FILTER_COLUMNS: Record<ProjectFilterField, FilterableColumnDescriptor> = {
  name: { type: "text", prismaPath: ["name"] },
  status: { type: "enum", prismaPath: ["status"] },
  budget: { type: "number", prismaPath: ["budget"] },
  startDate: { type: "date", prismaPath: ["startDate"] },
  endDate: { type: "date", prismaPath: ["endDate"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.ProjectOrderByWithRelationInput;

export const PROJECT_SORT_COLUMNS: Record<ProjectSortField, OrderByBuilder> = {
  name: (dir) => ({ name: dir }),
  status: (dir) => ({ status: dir }),
  budget: (dir) => ({ budget: dir }),
  startDate: (dir) => ({ startDate: dir }),
  endDate: (dir) => ({ endDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};
