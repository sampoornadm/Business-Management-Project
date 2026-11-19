"use client";

import type { ProjectOverviewDto } from "@bmp/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  formatDate,
  formatMoney,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bmp/ui";
import Link from "next/link";

import { humanize, StatusBadge } from "@/components/status-badge";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

export function ProjectOverviewTab({ overview }: { overview: ProjectOverviewDto }) {
  const { tender, rfqs, vendors, vendorPurchaseOrders } = overview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tender</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tender">
            <Link href={`/tenders/${tender.id}`} className="hover:underline">
              {tender.tenderNumber}
            </Link>
            <p className="text-muted-foreground">{tender.title}</p>
          </Field>
          <Field label="Client">{tender.clientName ?? "–"}</Field>
          <Field label="Won">
            {tender.wonItemsCount > 0
              ? `${tender.wonItemsCount} of ${tender.wonItemsTotal ?? "?"} items`
              : "Whole tender"}
            {tender.evaluationCriteria && (
              <p className="text-muted-foreground">{humanize(tender.evaluationCriteria)} evaluation</p>
            )}
          </Field>
          <Field label="Winning bid">{formatMoney(tender.winningBidAmount)}</Field>
          <Field label="Our reference">{tender.submissionReference ?? "–"}</Field>
          <Field label="Delivery period">{tender.deliveryPeriodDays} days from PO</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendors</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {vendors.length === 0 ? (
            <EmptyState title="No vendors yet" description="Vendors appear here once an RFQ or a PO for this tender names them." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">RFQs</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">PO value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell>
                      <Link href={`/vendors/${vendor.id}`} className="hover:underline">
                        {vendor.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{vendor.rfqCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{vendor.purchaseOrderCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(vendor.purchaseOrderValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">RFQ responses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          {rfqs.length === 0 ? (
            <EmptyState title="No RFQs for this tender" />
          ) : (
            rfqs.map((rfq) => (
              <div key={rfq.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/rfqs/${rfq.id}`} className="font-medium hover:underline">
                    {rfq.title}
                  </Link>
                  <StatusBadge status={rfq.status} />
                  <span className="text-sm text-muted-foreground">
                    {rfq.itemCount} item{rfq.itemCount === 1 ? "" : "s"}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Reply</TableHead>
                      <TableHead className="text-right">Items quoted</TableHead>
                      <TableHead className="text-right">Quoted total</TableHead>
                      <TableHead className="text-right">Items selected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rfq.vendors.map((reply) => (
                      <TableRow key={reply.vendorId}>
                        <TableCell>{reply.vendorName}</TableCell>
                        <TableCell>
                          <StatusBadge status={reply.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {reply.quotedItems} of {rfq.itemCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(reply.quotedTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{reply.selectedItems}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor POs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {vendorPurchaseOrders.length === 0 ? (
            <EmptyState title="No vendor POs yet" description="POs you raise for this tender's items appear here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>Expected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorPurchaseOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell>
                      <Link href={`/purchase-orders/${po.id}`} className="hover:underline">
                        {po.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{po.vendorName}</TableCell>
                    <TableCell>
                      <StatusBadge status={po.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(po.totalAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(po.receivedAmount)}</TableCell>
                    <TableCell>{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "–"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
