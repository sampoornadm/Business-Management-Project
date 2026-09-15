"use client";

import type { UserDto } from "@bmp/types";
import { Avatar, AvatarFallback, AvatarImage, Badge, formatDateTime, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface UserColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<UserDto>["cell"];
}

function initials(user: UserDto): string {
  return `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
}

export const USER_COLUMNS: UserColumnConfig[] = [
  {
    key: "firstName",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    // Sorts/filters by first name (the underlying DB field) while the cell itself shows the
    // full name + avatar — same "one column, richer cell" idea as Tenders' title column.
    cell: ({ row }) => {
      const user = row.original;
      return (
        <Link href={`/users/${user.id}`} className="flex items-center gap-3 hover:underline">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatar?.thumbnailUrl ?? undefined} alt={user.firstName} />
            <AvatarFallback>{initials(user)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">
            {user.firstName} {user.lastName}
          </span>
        </Link>
      );
    },
  },
  {
    key: "lastName",
    label: "Last Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.lastName,
  },
  {
    key: "email",
    label: "Email",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.email,
  },
  {
    key: "role",
    label: "Role",
    // Placeholder "text" — users/page.tsx overrides this to "enum" at runtime with enumOptions
    // from useRoles() (role ids come from the seeded Role table, not a static list).
    type: "text",
    // Role is reached through UserBusiness, a to-many relation from User's side — Prisma can't
    // orderBy a nested relation's own relation field (User -> UserBusiness -> Role.name) without
    // raw SQL, so this stays filterable-only (see users.filter-columns.ts).
    sortable: false,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => <Badge variant="secondary">{row.original.role.name}</Badge>,
  },
  {
    key: "isActive",
    label: "Status",
    type: "boolean",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="success">Active</Badge>
      ) : (
        <Badge variant="destructive">Deactivated</Badge>
      ),
  },
  {
    key: "lastLoginAt",
    label: "Last Login",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => (row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : "Never"),
  },
];

export const USER_DEFAULT_VISIBLE_KEYS = USER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const USER_DEFAULT_ORDER = USER_COLUMNS.map((c) => c.key);

export function buildUserColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<UserDto>[] {
  const configByKey = new Map(USER_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is UserColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      // See tender-column-registry.tsx's identical comment: TanStack needs a truthy accessorFn
      // for getCanSort() even though sorting is fully server-driven.
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
