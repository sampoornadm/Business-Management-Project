"use client";

import { TENDER_CATEGORIES, TENDER_PRIORITIES, TENDER_TYPES, type CreateTenderInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CITIES_BY_STATE,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  INDIA_STATES,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type IndiaState,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CreateOrganizationDialog } from "@/components/organizations/create-organization-dialog";
import { useOrganizations } from "@/hooks/use-organizations";

const numericString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0, "Must be a non-negative number");

const optionalNumericString = z
  .string()
  .optional()
  .refine(
    (value) => !value || (!Number.isNaN(Number(value)) && Number(value) >= 0),
    "Must be a non-negative number",
  );

// Every field is kept as a plain string here (matching real <input> values) —
// numeric conversion happens in toCreateTenderInput() below, not via a zod
// `.transform()`, because RHF's 3-generic resolver typing for input/output
// splits doesn't reliably line up with the zodResolver version this project
// uses. Simpler to keep one flat string-typed shape end to end.
const tenderFormSchema = z.object({
  tenderNumber: z.string().min(1, "Required").max(100),
  title: z.string().min(1, "Required").max(300),
  department: z.string().min(1, "Required").max(150),
  clientId: z.string().min(1, "Select a client"),
  type: z.string().min(1, "Select a type"),
  category: z.string().min(1, "Select a category"),
  location: z.string().min(1, "Required").max(200),
  state: z.string().min(1, "Required").max(100),
  estimatedCost: numericString("Estimated cost"),
  emdAmount: optionalNumericString,
  tenderFee: optionalNumericString,
  documentFee: optionalNumericString,
  submissionDate: z.string().min(1, "Required"),
  openingDate: z.string().optional(),
  validityPeriodDays: optionalNumericString,
  priority: z.enum(TENDER_PRIORITIES),
  description: z.string().optional(),
  remarks: z.string().optional(),
  dealingOfficerName: z.string().optional(),
  dealingOfficerEmail: z.string().optional(),
  dealingOfficerPhone: z.string().optional(),
});

export type TenderFormValues = z.infer<typeof tenderFormSchema>;

function toOptionalNumber(value: string | undefined): number | undefined {
  return value ? Number(value) : undefined;
}

export function toCreateTenderInput(values: TenderFormValues): CreateTenderInput {
  return {
    ...values,
    estimatedCost: Number(values.estimatedCost),
    emdAmount: toOptionalNumber(values.emdAmount),
    tenderFee: toOptionalNumber(values.tenderFee),
    documentFee: toOptionalNumber(values.documentFee),
    validityPeriodDays: toOptionalNumber(values.validityPeriodDays),
    openingDate: values.openingDate || undefined,
    dealingOfficerName: values.dealingOfficerName || undefined,
    dealingOfficerEmail: values.dealingOfficerEmail || undefined,
    dealingOfficerPhone: values.dealingOfficerPhone || undefined,
  };
}

const DEFAULT_VALUES: TenderFormValues = {
  tenderNumber: "",
  title: "",
  department: "",
  clientId: "",
  // Most tenders on this system come through SAIL's registered-vendor
  // SRM/e-Procurement process, not an open public tender — LIMITED is the
  // common case, and it's still just a default the user can change.
  type: "LIMITED",
  category: "",
  location: "Kolkata",
  state: "West Bengal",
  estimatedCost: "0.00",
  emdAmount: "0.00",
  tenderFee: "0.00",
  documentFee: "0.00",
  submissionDate: "",
  openingDate: "",
  validityPeriodDays: "",
  priority: "MEDIUM",
  description: "",
  remarks: "",
  dealingOfficerName: "",
  dealingOfficerEmail: "",
  dealingOfficerPhone: "",
};

export interface TenderFormProps {
  defaultValues?: Partial<TenderFormValues>;
  onSubmit: (values: TenderFormValues) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Client name detected from document extraction but not matched to an existing organization. */
  suggestedClientName?: string;
}

export function TenderForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  submitLabel = "Save",
  suggestedClientName,
}: TenderFormProps) {
  const organizationsQuery = useOrganizations({ pageSize: 100 });

  const form = useForm<TenderFormValues>({
    resolver: zodResolver(tenderFormSchema),
    defaultValues: { ...DEFAULT_VALUES, ...defaultValues },
  });
  const watchedState = form.watch("state");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="tenderNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tender number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client &amp; classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Client</FormLabel>
                    <CreateOrganizationDialog
                      trigger={
                        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
                          + New organization
                        </Button>
                      }
                      defaultName={suggestedClientName}
                      onCreated={(organization) => field.onChange(organization.id)}
                    />
                  </div>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a client organization" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {organizationsQuery.data?.items.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TENDER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TENDER_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TENDER_PRIORITIES.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {priority}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => {
                  // Falls back to showing the raw value as its own option when
                  // editing an existing tender whose state predates this
                  // curated list — otherwise a Radix Select with no matching
                  // SelectItem silently renders blank (see CLAUDE.md gotcha).
                  const options =
                    field.value && !(INDIA_STATES as readonly string[]).includes(field.value)
                      ? [field.value, ...INDIA_STATES]
                      : INDIA_STATES;
                  return (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          form.setValue("location", "");
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {options.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => {
                  const cities = CITIES_BY_STATE[watchedState as IndiaState] ?? [];
                  const options =
                    field.value && !cities.includes(field.value) ? [field.value, ...cities] : cities;
                  return (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={options.length === 0}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={options.length ? "Select city" : "Select a state first"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {options.map((city) => (
                            <SelectItem key={city} value={city}>
                              {city}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dealing officer</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="dealingOfficerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dealingOfficerEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dealingOfficerPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financials</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="estimatedCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated cost</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emdAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>EMD amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tenderFee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tender fee</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="documentFee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document fee</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dates</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="submissionDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Submission date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="openingDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="validityPeriodDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Validity (days)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Description &amp; remarks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
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
