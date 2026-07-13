# Business Details & Contacts UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users view/edit a business's full details (address, GST, Udyam, MSME category, PAN, website, notes) and manage its contacts, mirroring the existing `organizations` module's UI 1:1.

**Architecture:** All backend endpoints and validation already exist (`GET/PATCH/DELETE /businesses/:id`, contact CRUD) — this is a frontend-only feature plus one small backend cleanup (moving `BusinessDto`/`BusinessContactDto` out of the server mapper into `packages/types`, matching how every other entity's DTOs are shared, since the frontend needs proper typed inputs/outputs to mirror `use-organizations.ts`). New pages: `/businesses/new`, `/businesses/[id]`, `/businesses/[id]/edit`, built from a shared `BusinessForm` component and the existing (already domain-agnostic) `ContactDialog` component.

**Tech Stack:** Next.js/React 19, React Hook Form + Zod, TanStack Query, `@bmp/ui`, Express/Prisma (no schema changes).

## Global Constraints

- Follow existing module conventions exactly — this plan mirrors `apps/web/src/app/(dashboard)/organizations/*`, `apps/web/src/components/organizations/*`, and `apps/web/src/hooks/use-organizations.ts` file-for-file.
- No backend schema or validation changes — every endpoint (`GET/POST/PATCH/DELETE /businesses`, `/businesses/:id`, `/businesses/:id/contacts[/:contactId]`) and Zod schema in `businesses.validation.ts` already exists and is correct.
- Member management (`listMembers`/`addMember`/`updateMember`/`removeMember`) is explicitly out of scope — do not build any UI for it.
- Permission checks: `businesses:create` (create page), `businesses:update` (edit page, contacts), `businesses:delete` (delete button) — via `hasPermission(roleName, ...)` from `@/lib/permissions`.

---

## File Structure

**New files:**
- `packages/types/src/business.ts` — `MSME_CATEGORIES`/`MsmeCategory`, `BusinessDto`, `BusinessContactDto`, `CreateBusinessInput`, `UpdateBusinessInput`, `CreateBusinessContactInput`, `UpdateBusinessContactInput`, `ListBusinessesQuery`.
- `apps/web/src/components/businesses/business-form.tsx` — shared create/edit form.
- `apps/web/src/app/(dashboard)/businesses/new/page.tsx`
- `apps/web/src/app/(dashboard)/businesses/[id]/page.tsx` — detail view.
- `apps/web/src/app/(dashboard)/businesses/[id]/edit/page.tsx`

**Modified files:**
- `packages/types/src/index.ts` — barrel-export `business.ts`.
- `apps/server/src/modules/businesses/businesses.mapper.ts` — import `BusinessDto`/`BusinessContactDto` from `@bmp/types` instead of declaring them locally.
- `apps/server/src/modules/businesses/businesses.service.ts` — import `BusinessDto` from `@bmp/types` instead of the mapper.
- `apps/web/src/hooks/use-businesses.ts` — replace hand-rolled `Business`/`CreateBusinessInput` with `@bmp/types` imports; add `useBusiness`, `useUpdateBusiness`, `useDeleteBusiness`, `useAddBusinessContact`, `useUpdateBusinessContact`, `useDeleteBusinessContact`.
- `apps/web/src/app/(dashboard)/businesses/page.tsx` — link to `/businesses/new` instead of the dialog; add row-links to `/businesses/[id]`.

**Deleted files:**
- `apps/web/src/components/businesses/create-business-dialog.tsx` — superseded by the `/businesses/new` page.

---

### Task 1: Shared `@bmp/types` DTOs + backend mapper cleanup

**Files:**
- Create: `packages/types/src/business.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `apps/server/src/modules/businesses/businesses.mapper.ts`
- Modify: `apps/server/src/modules/businesses/businesses.service.ts`

**Interfaces:**
- Produces: `BusinessDto`, `BusinessContactDto`, `CreateBusinessInput`, `UpdateBusinessInput`, `CreateBusinessContactInput`, `UpdateBusinessContactInput`, `ListBusinessesQuery`, `MSME_CATEGORIES`, `MsmeCategory` from `@bmp/types` — consumed by Task 2 (frontend hooks) and Task 3 (form).

- [ ] **Step 1: Create the shared types file**

Create `packages/types/src/business.ts`:

```ts
export const MSME_CATEGORIES = ["MICRO", "SMALL", "MEDIUM"] as const;
export type MsmeCategory = (typeof MSME_CATEGORIES)[number];

export interface BusinessContactDto {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface BusinessDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: MsmeCategory | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: BusinessContactDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessInput {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  udyamRegistrationNumber?: string;
  msmeCategory?: MsmeCategory;
  panNumber?: string;
  website?: string;
  notes?: string;
}

export type UpdateBusinessInput = Partial<CreateBusinessInput> & { isActive?: boolean };

export interface CreateBusinessContactInput {
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export type UpdateBusinessContactInput = Partial<CreateBusinessContactInput>;

export interface ListBusinessesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}
```

- [ ] **Step 2: Barrel-export it**

In `packages/types/src/index.ts`, change:

```ts
export * from "./boq.js";
export * from "./finance.js";
```

to:

```ts
export * from "./boq.js";
export * from "./business.js";
export * from "./finance.js";
```

(`business.js` sorts alphabetically after `boq.js` and before `finance.js`; every other line in the file is unaffected.)

- [ ] **Step 3: Point the backend mapper at the shared types**

In `apps/server/src/modules/businesses/businesses.mapper.ts`, change:

```ts
import type { BusinessWithContacts } from "./businesses.repository.js";

export interface BusinessContactDto {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface BusinessDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: string | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: BusinessContactDto[];
  createdAt: string;
  updatedAt: string;
}
```

to:

```ts
import type { BusinessContactDto, BusinessDto, MsmeCategory } from "@bmp/types";

import type { BusinessWithContacts } from "./businesses.repository.js";
```

(Delete the two local `export interface` blocks entirely — they're replaced by the import. Leave everything below them, i.e. `toContactDto`/`toBusinessDto`, unchanged except for one cast noted next.)

In the same file, `toBusinessDto`'s `msmeCategory: business.msmeCategory,` line needs a cast, since the Prisma column is a plain `string | null` but the DTO now types it as `MsmeCategory | null`:

```ts
    msmeCategory: business.msmeCategory as MsmeCategory | null,
```

- [ ] **Step 4: Update the one import site**

In `apps/server/src/modules/businesses/businesses.service.ts`, change:

```ts
import type { BusinessDto } from "./businesses.mapper.js";
import { toBusinessDto } from "./businesses.mapper.js";
```

to:

```ts
import type { BusinessDto } from "@bmp/types";

import { toBusinessDto } from "./businesses.mapper.js";
```

- [ ] **Step 5: Verify nothing broke**

```bash
pnpm --filter @bmp/types typecheck
pnpm --filter @bmp/server typecheck
pnpm --filter @bmp/server test -- businesses/__tests__/businesses.service.spec.ts
```

Expected: all three exit 0 / pass. This is a pure type-relocation — no behavior changed, so the existing test file's assertions should pass unmodified.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/business.ts packages/types/src/index.ts apps/server/src/modules/businesses/businesses.mapper.ts apps/server/src/modules/businesses/businesses.service.ts
git commit -m "refactor(businesses): move BusinessDto/BusinessContactDto to @bmp/types"
```

---

### Task 2: Frontend data hooks

**Files:**
- Modify: `apps/web/src/hooks/use-businesses.ts`

**Interfaces:**
- Consumes: `BusinessDto`, `CreateBusinessInput`, `UpdateBusinessInput`, `CreateBusinessContactInput`, `UpdateBusinessContactInput`, `ListBusinessesQuery` from `@bmp/types` (Task 1).
- Produces: `useBusiness(id)`, `useUpdateBusiness(id)`, `useDeleteBusiness()`, `useAddBusinessContact(id)`, `useUpdateBusinessContact(id)`, `useDeleteBusinessContact(id)` — consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `apps/web/src/hooks/use-businesses.ts` with:

```ts
"use client";

import type {
  ApiResponse,
  BusinessDto,
  CreateBusinessContactInput,
  CreateBusinessInput,
  ListBusinessesQuery,
  PaginatedResult,
  UpdateBusinessContactInput,
  UpdateBusinessInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export type { BusinessDto as Business };

export function useBusinesses(query: ListBusinessesQuery) {
  return useQuery({
    queryKey: ["businesses", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<BusinessDto>>>(
        "/businesses",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function useBusiness(id: string | undefined) {
  return useQuery({
    queryKey: ["businesses", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BusinessDto>>(`/businesses/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessInput) => {
      const response = await apiClient.post<ApiResponse<BusinessDto>>("/businesses", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useUpdateBusiness(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBusinessInput) => {
      const response = await apiClient.patch<ApiResponse<BusinessDto>>(`/businesses/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useDeleteBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/businesses/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useAddBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessContactInput) => {
      const response = await apiClient.post<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}

export function useUpdateBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      input,
    }: {
      contactId: string;
      input: UpdateBusinessContactInput;
    }) => {
      const response = await apiClient.patch<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts/${contactId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}

export function useDeleteBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiClient.delete<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts/${contactId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}
```

Note: `export type { BusinessDto as Business }` preserves the existing `Business` name other files may already import (the businesses list page imports `type { Business }` from this file) so Task 7's edits to that page don't need to change its type import.

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0. (This will show errors in `create-business-dialog.tsx` and `businesses/page.tsx` referencing the old narrower `CreateBusinessInput` shape/`isActive` on the table row — that's expected and fixed in Task 7; if you're executing tasks in order, don't worry about it now, but note it if running this task in isolation.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-businesses.ts
git commit -m "feat(web): add business detail/update/delete/contact hooks"
```

---

### Task 3: `BusinessForm` component

**Files:**
- Create: `apps/web/src/components/businesses/business-form.tsx`

**Interfaces:**
- Consumes: `MSME_CATEGORIES`, `MsmeCategory` from `@bmp/types` (Task 1).
- Produces: `BusinessForm({ defaultValues, onSubmit, isSubmitting, submitLabel, showActiveToggle })`, `BusinessFormValues` type — consumed by Task 4 (`new` page) and Task 6 (`edit` page).

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/businesses/business-form.tsx`:

```tsx
"use client";

import { MSME_CATEGORIES } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const businessFormSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  code: z.string().min(1, "Required").max(20),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  gstNumber: z.string().optional(),
  udyamRegistrationNumber: z.string().optional(),
  msmeCategory: z.enum(MSME_CATEGORIES).optional(),
  panNumber: z.string().optional(),
  website: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type BusinessFormValues = z.infer<typeof businessFormSchema>;

const DEFAULT_VALUES: BusinessFormValues = {
  name: "",
  code: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  gstNumber: "",
  udyamRegistrationNumber: "",
  msmeCategory: undefined,
  panNumber: "",
  website: "",
  notes: "",
  isActive: true,
};

export interface BusinessFormProps {
  defaultValues?: Partial<BusinessFormValues>;
  onSubmit: (values: BusinessFormValues) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Only edit has a meaningful "deactivate" toggle — a new business is always active. */
  showActiveToggle?: boolean;
}

export function BusinessForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  submitLabel = "Save",
  showActiveToggle = false,
}: BusinessFormProps) {
  const form = useForm<BusinessFormValues>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: { ...DEFAULT_VALUES, ...defaultValues },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {showActiveToggle && (
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                      <FormLabel className="!mt-0">Active</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registration details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="gstNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="panNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="udyamRegistrationNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Udyam registration number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="msmeCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>MSME category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MSME_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category.charAt(0) + category.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Street address</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pincode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pincode</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: no new errors introduced by this file (pre-existing errors from Task 2's rewrite in other files are still expected until Task 7).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/businesses/business-form.tsx
git commit -m "feat(web): add BusinessForm component"
```

---

### Task 4: `/businesses/new` page

**Files:**
- Create: `apps/web/src/app/(dashboard)/businesses/new/page.tsx`

**Interfaces:**
- Consumes: `BusinessForm`, `BusinessFormValues` (Task 3), `useCreateBusiness` (existing, Task 2 didn't change its signature).

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(dashboard)/businesses/new/page.tsx`:

```tsx
"use client";

import { useToast } from "@bmp/ui";
import { useRouter } from "next/navigation";

import { BusinessForm, type BusinessFormValues } from "@/components/businesses/business-form";
import { useCreateBusiness } from "@/hooks/use-businesses";

export default function NewBusinessPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createBusiness = useCreateBusiness();

  async function handleSubmit(values: BusinessFormValues) {
    try {
      const business = await createBusiness.mutateAsync(values);
      toast({ title: "Business created" });
      router.push(`/businesses/${business.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a business</h1>
        <p className="text-sm text-muted-foreground">
          Tenders, projects, and finance records are scoped to a business.
        </p>
      </div>
      <BusinessForm onSubmit={handleSubmit} isSubmitting={createBusiness.isPending} submitLabel="Create business" />
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/businesses/new/page.tsx
git commit -m "feat(web): add /businesses/new page"
```

---

### Task 5: `/businesses/[id]` detail page

**Files:**
- Create: `apps/web/src/app/(dashboard)/businesses/[id]/page.tsx`

**Interfaces:**
- Consumes: `useBusiness`, `useDeleteBusiness`, `useAddBusinessContact`, `useUpdateBusinessContact`, `useDeleteBusinessContact` (Task 2), `ContactDialog` (existing, `apps/web/src/components/organizations/contact-dialog.tsx` — reused as-is per the design spec, it's already domain-agnostic).

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(dashboard)/businesses/[id]/page.tsx`:

```tsx
"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
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
import { useParams, useRouter } from "next/navigation";

import { ContactDialog } from "@/components/organizations/contact-dialog";
import {
  useAddBusinessContact,
  useBusiness,
  useDeleteBusiness,
  useDeleteBusinessContact,
  useUpdateBusinessContact,
} from "@/hooks/use-businesses";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const MSME_LABELS: Record<string, string> = { MICRO: "Micro", SMALL: "Small", MEDIUM: "Medium" };

export default function BusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const businessQuery = useBusiness(params.id);
  const addContact = useAddBusinessContact(params.id);
  const updateContact = useUpdateBusinessContact(params.id);
  const deleteContact = useDeleteBusinessContact(params.id);
  const deleteBusiness = useDeleteBusiness();

  const canUpdate = hasPermission(roleName, "businesses:update");
  const canDelete = hasPermission(roleName, "businesses:delete");

  async function handleDelete() {
    try {
      await deleteBusiness.mutateAsync(params.id);
      toast({ title: "Business deleted" });
      router.push("/businesses");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (businessQuery.isLoading || !businessQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const business = businessQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
            <Badge variant={business.isActive ? "default" : "secondary"}>
              {business.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[business.city, business.state].filter(Boolean).join(", ") || "No address on file"}
          </p>
        </div>
        {canUpdate && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/businesses/${business.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Link>
            </Button>
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this business?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can&apos;t be undone. Businesses with existing tenders can&apos;t be
                      deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">GST Number</p>
            <p>{business.gstNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">PAN Number</p>
            <p>{business.panNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Udyam Registration Number</p>
            <p>{business.udyamRegistrationNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">MSME Category</p>
            <p>{business.msmeCategory ? MSME_LABELS[business.msmeCategory] : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Website</p>
            <p>{business.website || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Address</p>
            <p>{business.address || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pincode</p>
            <p>{business.pincode || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tenders</p>
            <p>{business.tenderCount}</p>
          </div>
        </CardContent>
      </Card>

      {business.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{business.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Contacts</CardTitle>
          {canUpdate && (
            <ContactDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="mr-2 h-4 w-4" /> Add contact
                </Button>
              }
              onSubmit={async (values) => {
                await addContact.mutateAsync(values);
                toast({ title: "Contact added" });
              }}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {business.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts added yet.</p>
          ) : (
            business.contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{contact.name}</p>
                    {contact.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[contact.designation, contact.email, contact.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {canUpdate && (
                  <div className="flex gap-2">
                    <ContactDialog
                      contact={contact}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                      onSubmit={async (values) => {
                        await updateContact.mutateAsync({ contactId: contact.id, input: values });
                        toast({ title: "Contact updated" });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await deleteContact.mutateAsync(contact.id);
                        toast({ title: "Contact removed" });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

Note: `ContactDialog`'s prop type is `contact?: OrganizationContactDto` (from `@bmp/types`) in its current signature. Since `BusinessContactDto` has the same shape (`id`/`name`/`designation`/`email`/`phone`/`isPrimary`) minus `createdAt` which `OrganizationContactDto` has but the component never reads, passing a `BusinessContactDto` should structurally satisfy it — **if TypeScript complains about the missing `createdAt` field**, see the escape hatch in Step 2 below.

- [ ] **Step 2: Verify it typechecks; handle the `ContactDialog` type mismatch if it occurs**

```bash
pnpm --filter @bmp/web typecheck
```

If this errors on `ContactDialog`'s `contact={contact}` prop (TypeScript's excess/missing-property check on the `OrganizationContactDto` parameter rejecting a `BusinessContactDto` missing `createdAt`), the fix is to widen `ContactDialogProps.contact`'s type in `apps/web/src/components/organizations/contact-dialog.tsx` from `OrganizationContactDto` to a local structural type matching only the fields the component actually reads:

```ts
export interface ContactDialogProps {
  trigger: ReactNode;
  contact?: {
    name: string;
    designation: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  };
  onSubmit: (values: ContactFormValues) => Promise<void>;
}
```

(Remove the now-unused `OrganizationContactDto` import if you make this change.) This keeps the component genuinely domain-agnostic (matching the design spec's premise) rather than coupled to one entity's DTO. Only make this edit if the typecheck actually fails without it — TypeScript's structural typing often accepts this without complaint since none of the component's internals require `createdAt`.

Expected after resolving: typecheck exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/businesses/\[id\]/page.tsx apps/web/src/components/organizations/contact-dialog.tsx
git commit -m "feat(web): add business detail page with contacts management"
```

(Only include `contact-dialog.tsx` in the `git add` if Step 2 required changing it.)

---

### Task 6: `/businesses/[id]/edit` page

**Files:**
- Create: `apps/web/src/app/(dashboard)/businesses/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `BusinessForm` (Task 3), `useBusiness`, `useUpdateBusiness` (Task 2).

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(dashboard)/businesses/[id]/edit/page.tsx`:

```tsx
"use client";

import { Skeleton, useToast } from "@bmp/ui";
import { useParams, useRouter } from "next/navigation";

import { BusinessForm, type BusinessFormValues } from "@/components/businesses/business-form";
import { useBusiness, useUpdateBusiness } from "@/hooks/use-businesses";

export default function EditBusinessPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const businessQuery = useBusiness(params.id);
  const updateBusiness = useUpdateBusiness(params.id);

  async function handleSubmit(values: BusinessFormValues) {
    try {
      await updateBusiness.mutateAsync(values);
      toast({ title: "Business updated" });
      router.push(`/businesses/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (businessQuery.isLoading || !businessQuery.data) {
    return <Skeleton className="h-96 w-full max-w-2xl" />;
  }

  const business = businessQuery.data;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Business</h1>
      </div>
      <BusinessForm
        defaultValues={{
          name: business.name,
          code: business.code,
          address: business.address ?? "",
          city: business.city ?? "",
          state: business.state ?? "",
          pincode: business.pincode ?? "",
          gstNumber: business.gstNumber ?? "",
          udyamRegistrationNumber: business.udyamRegistrationNumber ?? "",
          msmeCategory: business.msmeCategory ?? undefined,
          panNumber: business.panNumber ?? "",
          website: business.website ?? "",
          notes: business.notes ?? "",
          isActive: business.isActive,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateBusiness.isPending}
        submitLabel="Save changes"
        showActiveToggle
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/businesses/\[id\]/edit/page.tsx
git commit -m "feat(web): add business edit page"
```

---

### Task 7: Wire up the list page, remove the old create dialog

**Files:**
- Modify: `apps/web/src/app/(dashboard)/businesses/page.tsx`
- Delete: `apps/web/src/components/businesses/create-business-dialog.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-6 (this is the final integration point).

- [ ] **Step 1: Rewrite the list page**

Replace the entire contents of `apps/web/src/app/(dashboard)/businesses/page.tsx` with:

```tsx
"use client";

import { Badge, Button, DataTable, Input } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Business } from "@/hooks/use-businesses";
import { useBusinesses } from "@/hooks/use-businesses";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const columns: ColumnDef<Business>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/businesses/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
  },
  {
    accessorKey: "tenderCount",
    header: "Tenders",
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "default" : "secondary"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

export default function BusinessesPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const businessesQuery = useBusinesses({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
  });

  const canCreate = hasPermission(roleName, "businesses:create");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
          <p className="text-sm text-muted-foreground">
            Legal entities that tenders, projects, and finance records are scoped under.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/businesses/new">
              <Briefcase className="mr-2 h-4 w-4" /> Add Business
            </Link>
          </Button>
        )}
      </div>

      <Input
        placeholder="Search by name..."
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={columns}
        data={businessesQuery.data?.items ?? []}
        isLoading={businessesQuery.isLoading}
        pageCount={businessesQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
```

- [ ] **Step 2: Delete the obsolete dialog**

```bash
rm apps/web/src/components/businesses/create-business-dialog.tsx
```

- [ ] **Step 3: Verify everything typechecks with zero errors**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0 — this is the first point where the whole `apps/web` package should be fully clean (Tasks 2-6 may have left the old dialog/page referencing stale shapes until this task removes/replaces them).

- [ ] **Step 4: Manually verify in the browser**

Log in, go to `/businesses`. Confirm:
- "Add Business" navigates to `/businesses/new`, full form with all fields renders.
- Creating a business redirects to its detail page, showing all fields you entered.
- Clicking a business name in the list table navigates to its detail page.
- "Edit" on the detail page pre-fills the form with current values; saving updates and redirects back.
- Adding/editing/deleting a contact on the detail page works and reflects immediately.
- Deactivating a business (edit → toggle Active off) shows "Inactive" badge on both detail and list pages.
- Deleting a business with no tenders works; deleting one with tenders shows the existing "Cannot delete a business that still has tenders" error (backend-enforced, already covered by existing backend tests — just confirm the error surfaces as a toast, not a crash).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/businesses/page.tsx
git rm apps/web/src/components/businesses/create-business-dialog.tsx
git commit -m "feat(web): wire up business list page to new detail/edit/create pages"
```

---

## Self-Review Notes

- **Spec coverage:** detail view (Task 5), edit (Task 6), create (Task 4), contacts CRUD (Task 5), shared form (Task 3), hooks (Task 2), no backend changes beyond the DTO relocation (Task 1) — all spec goals covered. Member management explicitly untouched, per the spec's non-goal.
- **Type consistency:** `BusinessDto`/`BusinessContactDto`/`CreateBusinessInput`/`UpdateBusinessInput`/`CreateBusinessContactInput`/`UpdateBusinessContactInput` (Task 1) flow unchanged through Task 2's hooks, Task 3's form (`BusinessFormValues` maps 1:1 onto `CreateBusinessInput`/`UpdateBusinessInput`'s fields), and Tasks 4-7's pages.
- **No placeholders:** every step has complete, runnable code.
