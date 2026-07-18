"use client";

import type { CategoryNodeDto } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  useToast,
} from "@bmp/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  useCategoryTree,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/hooks/use-categories";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export default function CategoriesPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canEdit = hasPermission(roleName, "rfq:update");

  const treeQuery = useCategoryTree();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const run = async (action: Promise<unknown>, failTitle: string) => {
    try {
      await action;
    } catch (error) {
      toast({
        variant: "destructive",
        title: failTitle,
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  const addTop = () => {
    const name = window.prompt("New trade (top-level category)")?.trim();
    if (name) void run(createCategory.mutateAsync({ name }), "Could not add category");
  };
  const addChild = (parentId: string) => {
    const name = window.prompt("New subcategory")?.trim();
    if (name) void run(createCategory.mutateAsync({ parentId, name }), "Could not add subcategory");
  };
  const rename = (node: CategoryNodeDto) => {
    const name = window.prompt("Rename category", node.name)?.trim();
    if (name && name !== node.name) void run(updateCategory.mutateAsync({ id: node.id, name }), "Could not rename");
  };
  const remove = (node: CategoryNodeDto) => {
    if (
      window.confirm(
        `Delete "${node.name}"${node.children.length ? " and its subcategories" : ""}? Items keep their price history but become unclassified.`,
      )
    ) {
      void run(deleteCategory.mutateAsync(node.id), "Could not delete");
    }
  };

  const renderNode = (node: CategoryNodeDto, depth: number) => (
    <div key={node.id}>
      <div
        className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
      >
        <span className={depth === 0 ? "font-medium" : ""}>{node.name}</span>
        {canEdit && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {/* Two tiers today; only let top-level nodes gain children so the tree stays shallow. */}
            {depth === 0 && (
              <Button variant="ghost" size="sm" onClick={() => addChild(node.id)} title="Add subcategory">
                <Plus className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => rename(node)} title="Rename">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(node)} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/items" className="text-sm text-muted-foreground hover:underline">
            ← Back to items
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Item categories</h1>
          <p className="text-sm text-muted-foreground">
            The taxonomy the AI classifies items into. Edit it to fit your trades.
          </p>
        </div>
        {canEdit && (
          <Button onClick={addTop} disabled={createCategory.isPending}>
            <Plus className="mr-2 h-4 w-4" /> Add trade
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxonomy</CardTitle>
        </CardHeader>
        <CardContent>
          {treeQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (treeQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet. Add a trade to start.</p>
          ) : (
            <div className="space-y-0.5">{(treeQuery.data ?? []).map((node) => renderNode(node, 0))}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
