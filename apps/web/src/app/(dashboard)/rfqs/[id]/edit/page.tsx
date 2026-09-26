"use client";

import type { UpdateRfqItemInput } from "@bmp/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useRfq, useUpdateRfq } from "@/hooks/use-rfq";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";

interface DraftItem {
  /** An existing RFQ item being edited, or undefined for a brand-new row. */
  id?: string;
  description: string;
  unit: string;
  quantity: string;
  instructions: string;
  /** Whether a vendor has already quoted this line — blocks removal, same rule the server enforces. */
  hasQuotes: boolean;
}

function toDraftItems(rfq: { items: { id: string; description: string; unit: string | null; quantity: number; instructions: string | null; quotes: unknown[] }[] }): DraftItem[] {
  return rfq.items.map((item) => ({
    id: item.id,
    description: item.description,
    unit: item.unit ?? "",
    quantity: String(item.quantity),
    instructions: item.instructions ?? "",
    hasQuotes: item.quotes.length > 0,
  }));
}

function emptyItem(): DraftItem {
  return { description: "", unit: "", quantity: "", instructions: "", hasQuotes: false };
}

export default function EditRfqPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const rfqQuery = useRfq(params.id);
  useBreadcrumbLabel(params.id, rfqQuery.data ? `Edit ${rfqQuery.data.title}` : undefined);
  const updateRfq = useUpdateRfq(params.id);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Seed the form once the RFQ loads — mirrors the tender edit page's pattern of an
  // uncontrolled-until-loaded form, just without React Hook Form (this page's field set is much
  // smaller and the item rows need their own add/remove state anyway).
  useEffect(() => {
    if (!rfqQuery.data || loaded) return;
    setTitle(rfqQuery.data.title);
    setDueDate(rfqQuery.data.dueDate ? rfqQuery.data.dueDate.slice(0, 10) : "");
    setInstructions(rfqQuery.data.instructions ?? "");
    setItems(toDraftItems(rfqQuery.data));
    setLoaded(true);
  }, [rfqQuery.data, loaded]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title is required" });
      return;
    }

    const preparedItems: UpdateRfqItemInput[] = items
      .filter((item) => item.description.trim() && item.quantity.trim())
      .map((item) => ({
        id: item.id,
        description: item.description.trim(),
        unit: item.unit.trim() || undefined,
        quantity: Number(item.quantity),
        instructions: item.instructions.trim() || undefined,
      }));

    if (preparedItems.length === 0) {
      toast({ variant: "destructive", title: "Add at least one item" });
      return;
    }

    try {
      await updateRfq.mutateAsync({
        title: title.trim(),
        dueDate: dueDate || undefined,
        instructions: instructions.trim() || undefined,
        items: preparedItems,
      });
      toast({ title: "RFQ updated" });
      router.push(`/rfqs/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (rfqQuery.isLoading || !rfqQuery.data) {
    return <Skeleton className="h-96 w-full max-w-3xl" />;
  }

  const rfq = rfqQuery.data;
  const isFinalized = rfq.status === "CLOSED" || rfq.status === "CANCELLED";

  if (isFinalized) {
    // Defense in depth: the "Edit RFQ" link on the detail page is already hidden once finalized
    // (e.g. someone closed it in another tab while this page was open), and the server rejects
    // an item edit on a finalized RFQ regardless — this just explains it instead of a raw error.
    return (
      <div className="max-w-3xl space-y-4">
        <PageHeader title="Edit RFQ" />
        <p className="text-sm text-muted-foreground">
          This RFQ is {rfq.status.toLowerCase()} and can no longer be edited.{" "}
          <Link href={`/rfqs/${rfq.id}`} className="text-primary hover:underline">
            Back to the RFQ
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Edit RFQ" description={rfq.title} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Due date (optional)</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="max-w-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Instructions (optional)</label>
            <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            <Plus className="mr-2 h-4 w-4" /> Add item
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-28">Unit</TableHead>
                <TableHead className="w-28">Quantity</TableHead>
                <TableHead className="w-48">Instructions</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id ?? `new-${index}`}>
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                      placeholder="OPC Cement"
                    />
                  </TableCell>
                  <TableCell>
                    <Input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} placeholder="bag" />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      placeholder="500"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={item.instructions}
                      onChange={(e) => updateItem(index, { instructions: e.target.value })}
                      placeholder="ISI marked only"
                    />
                  </TableCell>
                  <TableCell>
                    {item.hasQuotes ? (
                      <Badge variant="outline" title="Already quoted by a vendor — cannot be removed">
                        Quoted
                      </Badge>
                    ) : (
                      items.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeItem(index)}
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={updateRfq.isPending}>
          {updateRfq.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/rfqs/${rfq.id}`}>Cancel</Link>
        </Button>
      </div>
    </div>
  );
}
