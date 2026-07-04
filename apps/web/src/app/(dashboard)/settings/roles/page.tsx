"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@bmp/ui";

import { useRoles } from "@/hooks/use-roles";

export default function RolesPage() {
  const rolesQuery = useRoles();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
        <p className="text-sm text-muted-foreground">
          System-defined roles and the permissions granted to each. Roles cannot be edited in Phase 1.
        </p>
      </div>

      {rolesQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rolesQuery.data?.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle className="text-base">{role.name.replaceAll("_", " ")}</CardTitle>
                {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {role.permissions.length === 0 ? (
                  <span className="text-sm text-muted-foreground">No explicit permissions</span>
                ) : (
                  role.permissions.map((permission) => (
                    <Badge key={permission.id} variant="outline">
                      {permission.key}
                    </Badge>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
