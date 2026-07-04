"use client";

import type { UserDto } from "@bmp/types";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

function initials(user: UserDto): string {
  return `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
}

export const userTableColumns: ColumnDef<UserDto>[] = [
  {
    accessorKey: "name",
    header: "Name",
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
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => <Badge variant="secondary">{row.original.role.name}</Badge>,
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge>Active</Badge>
      ) : (
        <Badge variant="destructive">Deactivated</Badge>
      ),
  },
  {
    accessorKey: "lastLoginAt",
    header: "Last Login",
    cell: ({ row }) =>
      row.original.lastLoginAt ? new Date(row.original.lastLoginAt).toLocaleString() : "Never",
  },
];
