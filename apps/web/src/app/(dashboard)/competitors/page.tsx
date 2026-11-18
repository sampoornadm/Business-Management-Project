"use client";

import {
  Badge,
  EmptyState,
  formatDate,
  Input,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bmp/ui";
import { Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { OurFirmUnknownNotice } from "@/components/competitors/rate-to-beat";
import { useCompetitorItems, useCompetitors } from "@/hooks/use-competitors";

const NOTHING_YET = "They are saved when a tender is marked Won or Lost.";

function ByCompetitor() {
  const competitors = useCompetitors();
  if (competitors.isLoading) return <PageSkeleton />;
  const rows = competitors.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        title="No comparative statements yet"
        description={NOTHING_YET}
      />
    );
  }
  return (
    <div className="space-y-3">
      {!rows.some((competitor) => competitor.isSelf) && (
        <OurFirmUnknownNotice />
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SAIL vendor code</TableHead>
              <TableHead className="text-right">Tenders met</TableHead>
              <TableHead className="text-right">Lowest bidder in</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((competitor) => (
              <TableRow key={competitor.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/competitors/${competitor.id}`}
                      className="font-medium hover:underline"
                    >
                      {competitor.name}
                    </Link>
                    {competitor.isSelf && <Badge variant="secondary">Us</Badge>}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {competitor.vendorCode}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {competitor.tenderCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {competitor.lowestCount}
                </TableCell>
                <TableCell>{formatDate(competitor.lastSeenAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ByItem() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const items = useCompetitorItems(debounced);
  const rows = items.data ?? [];

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by item description or code"
        aria-label="Search items"
        className="max-w-sm"
      />
      {items.isLoading ? (
        <PageSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Swords}
          title={debounced ? "No items match" : "No comparative statements yet"}
          description={
            debounced
              ? "Try a shorter description or the item code."
              : NOTHING_YET
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Item code</TableHead>
                <TableHead className="text-right">Competitors</TableHead>
                <TableHead className="text-right">Tenders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.itemCode}>
                  <TableCell>
                    <Link
                      href={`/competitors/items/${encodeURIComponent(item.itemCode)}`}
                      className="font-medium hover:underline"
                    >
                      {item.description || item.itemCode}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {item.itemCode}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.competitorCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.tenderCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function CompetitorsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitors"
        description="Bidders and their rates, read from the client's comparative statement after each tender is opened."
      />
      <Tabs defaultValue="competitors">
        <TabsList>
          <TabsTrigger value="competitors">By competitor</TabsTrigger>
          <TabsTrigger value="items">By item</TabsTrigger>
        </TabsList>
        <TabsContent value="competitors" className="mt-4">
          <ByCompetitor />
        </TabsContent>
        <TabsContent value="items" className="mt-4">
          <ByItem />
        </TabsContent>
      </Tabs>
    </div>
  );
}
