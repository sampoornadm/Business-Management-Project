"use client";

import {
  Badge,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bmp/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useCompareBoq } from "@/hooks/use-boq";
import { useTender, useTenders } from "@/hooks/use-tenders";

function formatDelta(value: number | null): string {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString()}`;
}

export default function BoqComparePage() {
  const params = useParams<{ id: string }>();
  const [compareTenderId, setCompareTenderId] = useState<string>("");

  const tenderQuery = useTender(params.id);
  const otherTendersQuery = useTenders({ page: 1, pageSize: 50 });
  const comparison = useCompareBoq(params.id, compareTenderId || undefined);

  if (tenderQuery.isLoading || !tenderQuery.data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const candidateTenders = (otherTendersQuery.data?.items ?? []).filter((t) => t.id !== params.id);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link
          href={`/tenders/${params.id}/boq`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to BOQ
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Compare BOQ — {tenderQuery.data.title}
        </h1>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm font-medium">Compare against</p>
          <Select value={compareTenderId} onValueChange={setCompareTenderId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Select a tender" />
            </SelectTrigger>
            <SelectContent>
              {candidateTenders.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.tenderNumber} — {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {comparison.isLoading && compareTenderId && <Skeleton className="h-64 w-full" />}

      {comparison.data && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-muted-foreground">This tender total</p>
                <p className="text-lg font-semibold">{comparison.data.baseTotalAmount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Comparison tender total</p>
                <p className="text-lg font-semibold">
                  {comparison.data.compareTotalAmount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Difference</p>
                <Badge variant={comparison.data.compareTotalAmount >= comparison.data.baseTotalAmount ? "default" : "destructive"}>
                  {formatDelta(comparison.data.compareTotalAmount - comparison.data.baseTotalAmount)}
                </Badge>
              </div>
            </div>

            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">This rate</TableHead>
                    <TableHead className="text-right">Compare rate</TableHead>
                    <TableHead className="text-right">Rate Δ</TableHead>
                    <TableHead className="text-right">Amount Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.data.lines.map((line, index) => (
                    <TableRow key={`${line.description}-${index}`}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{line.unit ?? "-"}</TableCell>
                      <TableCell className="text-right">{line.baseRate?.toLocaleString() ?? "-"}</TableCell>
                      <TableCell className="text-right">
                        {line.compareRate?.toLocaleString() ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">{formatDelta(line.rateDelta)}</TableCell>
                      <TableCell className="text-right">{formatDelta(line.amountDelta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
