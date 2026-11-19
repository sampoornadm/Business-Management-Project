"use client";

import {
  type ClientPurchaseOrderDto,
  type ReadableDocumentKind,
  type ReadDocumentResultDto,
  SHIPMENT_DOCUMENT_TYPES,
  type ShipmentDocumentType,
  type ShipmentDto,
} from "@bmp/types";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMoney,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  useCreateShipment,
  useDispatchShipment,
  useReadProjectDocument,
  useRecordShipmentGrn,
  useUploadShipmentDocuments,
} from "@/hooks/use-shipments";

export const DOCUMENT_TYPE_LABELS: Record<ShipmentDocumentType, string> = {
  EWAY_BILL: "E-way bill",
  TECHNICAL: "Technical document",
  GRN: "GRN",
  OTHER: "Other",
};

const today = () => new Date().toISOString().slice(0, 10);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

interface DialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What "Read a document" found, handed to the dispatch / GRN dialog along with the file. */
export interface DocumentPrefill {
  fields: ReadDocumentResultDto;
  file: File;
}

/** "Fill from file" inside a dialog: reads the chosen file and hands back what it found. */
function useFillFromFile(projectId: string, kind: ReadableDocumentKind, apply: (fields: ReadDocumentResultDto) => void) {
  const { toast } = useToast();
  const read = useReadProjectDocument(projectId);
  async function fill(file: File | null) {
    if (!file) return;
    try {
      const fields = await read.mutateAsync({ file, kind });
      apply(fields);
      toast({
        title: fields.documentNumber ? "Fields filled from the file" : "Nothing could be read",
        description: fields.warnings.join(" ") || undefined,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not read the file", description: errorText(error) });
    }
  }
  return { fill, reading: read.isPending };
}

/** Picks a client PO and how much of each of its lines goes in this shipment. */
export function NewShipmentDialog({
  projectId,
  orders,
  shipments,
  open,
  onOpenChange,
}: DialogProps & { orders: ClientPurchaseOrderDto[]; shipments: ShipmentDto[] }) {
  const { toast } = useToast();
  const createShipment = useCreateShipment(projectId);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const shippedByLine = useMemo(() => {
    const totals = new Map<string, number>();
    for (const shipment of shipments) {
      for (const item of shipment.items) {
        totals.set(item.clientPoItemId, (totals.get(item.clientPoItemId) ?? 0) + item.quantity);
      }
    }
    return totals;
  }, [shipments]);

  const order = orders.find((candidate) => candidate.id === orderId);
  const lines = (order?.items ?? []).map((item) => ({
    ...item,
    remaining: Math.max(0, item.quantity - (shippedByLine.get(item.id) ?? 0)),
  }));

  function fillRemaining() {
    setQuantities(Object.fromEntries(lines.filter((line) => line.remaining > 0).map((line) => [line.id, String(line.remaining)])));
  }

  async function handleCreate() {
    const items = lines
      .map((line) => ({ clientPoItemId: line.id, quantity: Number(quantities[line.id] ?? "") }))
      .filter((item) => item.quantity > 0);
    if (!orderId || items.length === 0) {
      toast({ variant: "destructive", title: "Enter a quantity for at least one item" });
      return;
    }
    try {
      await createShipment.mutateAsync({ clientPurchaseOrderId: orderId, items, notes: notes.trim() || null });
      toast({ title: "Shipment started" });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not start the shipment", description: errorText(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New shipment</DialogTitle>
          <DialogDescription>One shipment goes out on one e-way bill and comes back with one GRN and one bill.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label>Client PO</Label>
              <Select
                value={orderId}
                onValueChange={(value) => {
                  setOrderId(value);
                  setQuantities({});
                }}
              >
                <SelectTrigger aria-label="Client PO">
                  <SelectValue placeholder="Select a client PO" />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      PO {candidate.poNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={fillRemaining}>
              Ship everything left
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Left to ship</TableHead>
                  <TableHead className="w-32">This shipment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="max-w-sm">{line.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.remaining} of {line.quantity} {line.unit ?? ""}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        aria-label={`Quantity of ${line.description}`}
                        value={quantities[line.id] ?? ""}
                        disabled={line.remaining === 0}
                        onChange={(e) => setQuantities((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-1">
            <Label htmlFor="shipment-notes">Notes</Label>
            <Input id="shipment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleCreate} disabled={createShipment.isPending}>
            {createShipment.isPending ? "Starting…" : "Start shipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records the e-way bill and transport, attaches the e-way bill and technical documents. */
export function DispatchDialog({
  projectId,
  shipment,
  prefill,
  open,
  onOpenChange,
}: DialogProps & { shipment: ShipmentDto; prefill?: DocumentPrefill }) {
  const { toast } = useToast();
  const dispatch = useDispatchShipment(projectId);
  const upload = useUploadShipmentDocuments(projectId);
  const read = prefill?.fields;
  const [ewayBillNumber, setEwayBillNumber] = useState(read?.documentNumber ?? shipment.ewayBillNumber ?? "");
  const [ewayBillDate, setEwayBillDate] = useState(read?.documentDate ?? shipment.ewayBillDate?.slice(0, 10) ?? today());
  const [vehicleNumber, setVehicleNumber] = useState(read?.vehicleNumber ?? shipment.vehicleNumber ?? "");
  const [transporterName, setTransporterName] = useState(read?.transporterName ?? shipment.transporterName ?? "");
  const [freightCost, setFreightCost] = useState(shipment.freightCost !== null ? String(shipment.freightCost) : "");
  const [ewayFile, setEwayFile] = useState<File | null>(prefill?.file ?? null);
  const [technicalFiles, setTechnicalFiles] = useState<File[]>([]);
  const { fill, reading } = useFillFromFile(projectId, "EWAY_BILL", (fields) => {
    if (fields.documentNumber) setEwayBillNumber(fields.documentNumber);
    if (fields.documentDate) setEwayBillDate(fields.documentDate);
    if (fields.vehicleNumber) setVehicleNumber(fields.vehicleNumber);
    if (fields.transporterName) setTransporterName(fields.transporterName);
  });

  async function handleDispatch() {
    if (!ewayBillNumber.trim() || !ewayBillDate) {
      toast({ variant: "destructive", title: "Enter the e-way bill number and date" });
      return;
    }
    try {
      await dispatch.mutateAsync({
        id: shipment.id,
        input: {
          ewayBillNumber: ewayBillNumber.trim(),
          ewayBillDate,
          vehicleNumber: vehicleNumber.trim() || null,
          transporterName: transporterName.trim() || null,
          freightCost: freightCost.trim() ? Number(freightCost) : null,
        },
      });
      const files = [
        ...(ewayFile ? [{ file: ewayFile, documentType: "EWAY_BILL" as const }] : []),
        ...technicalFiles.map((file) => ({ file, documentType: "TECHNICAL" as const })),
      ];
      if (files.length > 0) await upload.mutateAsync({ id: shipment.id, files });
      toast({ title: `Shipment ${shipment.number} dispatched` });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not dispatch the shipment", description: errorText(error) });
    }
  }

  const busy = dispatch.isPending || upload.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Dispatch shipment {shipment.number}</DialogTitle>
          <DialogDescription>
            {shipment.items.length} item{shipment.items.length === 1 ? "" : "s"} worth {formatMoney(shipment.value)} against PO{" "}
            {shipment.clientPoNumber}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="eway-number">E-way bill number</Label>
            <Input id="eway-number" value={ewayBillNumber} onChange={(e) => setEwayBillNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eway-date">E-way bill date</Label>
            <Input id="eway-date" type="date" value={ewayBillDate} onChange={(e) => setEwayBillDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vehicle">Vehicle number</Label>
            <Input id="vehicle" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="transporter">Transporter</Label>
            <Input id="transporter" value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="freight">Freight cost</Label>
            <Input id="freight" money value={freightCost} onChange={(e) => setFreightCost(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eway-file">E-way bill file</Label>
            {prefill ? (
              <p className="truncate py-2 text-sm">{prefill.file.name}</p>
            ) : (
              <div className="flex gap-2">
                <Input id="eway-file" type="file" onChange={(e) => setEwayFile(e.target.files?.[0] ?? null)} />
                <Button type="button" variant="outline" disabled={!ewayFile || reading} onClick={() => void fill(ewayFile)}>
                  {reading ? "Reading…" : "Fill from file"}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="technical-files">Technical documents sent with the goods</Label>
            <Input
              id="technical-files"
              type="file"
              multiple
              onChange={(e) => setTechnicalFiles(Array.from(e.target.files ?? []))}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleDispatch} disabled={busy}>
            {busy ? "Dispatching…" : "Mark dispatched"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GrnDialog({
  projectId,
  shipment,
  prefill,
  open,
  onOpenChange,
}: DialogProps & { shipment: ShipmentDto; prefill?: DocumentPrefill }) {
  const { toast } = useToast();
  const recordGrn = useRecordShipmentGrn(projectId);
  const upload = useUploadShipmentDocuments(projectId);
  const [grnNumber, setGrnNumber] = useState(prefill?.fields.documentNumber ?? shipment.grnNumber ?? "");
  const [grnDate, setGrnDate] = useState(prefill?.fields.documentDate ?? shipment.grnDate?.slice(0, 10) ?? today());
  const [file, setFile] = useState<File | null>(prefill?.file ?? null);
  const { fill, reading } = useFillFromFile(projectId, "GRN", (fields) => {
    if (fields.documentNumber) setGrnNumber(fields.documentNumber);
    if (fields.documentDate) setGrnDate(fields.documentDate);
  });

  async function handleSave() {
    if (!grnNumber.trim() || !grnDate) {
      toast({ variant: "destructive", title: "Enter the GRN number and date" });
      return;
    }
    try {
      await recordGrn.mutateAsync({ id: shipment.id, input: { grnNumber: grnNumber.trim(), grnDate } });
      if (file) await upload.mutateAsync({ id: shipment.id, files: [{ file, documentType: "GRN" }] });
      toast({ title: "GRN recorded" });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not record the GRN", description: errorText(error) });
    }
  }

  const busy = recordGrn.isPending || upload.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record GRN for shipment {shipment.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="grn-number">GRN number</Label>
            <Input id="grn-number" value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grn-date">GRN date</Label>
            <Input id="grn-date" type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="grn-file">GRN document</Label>
            {prefill ? (
              <p className="truncate py-2 text-sm">{prefill.file.name}</p>
            ) : (
              <div className="flex gap-2">
                <Input id="grn-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button type="button" variant="outline" disabled={!file || reading} onClick={() => void fill(file)}>
                  {reading ? "Reading…" : "Fill from file"}
                </Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Record GRN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttachDocumentDialog({ projectId, shipment, open, onOpenChange }: DialogProps & { shipment: ShipmentDto }) {
  const { toast } = useToast();
  const upload = useUploadShipmentDocuments(projectId);
  const [documentType, setDocumentType] = useState<ShipmentDocumentType>("TECHNICAL");
  const [files, setFiles] = useState<File[]>([]);

  async function handleUpload() {
    if (files.length === 0) {
      toast({ variant: "destructive", title: "Choose a file" });
      return;
    }
    try {
      await upload.mutateAsync({ id: shipment.id, files: files.map((file) => ({ file, documentType })) });
      toast({ title: files.length === 1 ? "Document attached" : `${files.length} documents attached` });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not attach the document", description: errorText(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach to shipment {shipment.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Document type</Label>
            <Select value={documentType} onValueChange={(value) => setDocumentType(value as ShipmentDocumentType)}>
              <SelectTrigger aria-label="Document type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="shipment-files">Files</Label>
            <Input id="shipment-files" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleUpload} disabled={upload.isPending}>
            {upload.isPending ? "Attaching…" : "Attach document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND_LABELS: Record<ReadableDocumentKind, string> = {
  EWAY_BILL: "E-way bill",
  GRN: "GRN",
  VENDOR_INVOICE: "Vendor invoice",
};

/**
 * Reads an e-way bill, GRN or vendor invoice, says which shipment or vendor PO it belongs to and
 * hands it to the matching dialog. Nothing is saved here.
 */
export function ReadDocumentDialog({
  projectId,
  shipments,
  open,
  onOpenChange,
  onUse,
}: DialogProps & {
  shipments: ShipmentDto[];
  onUse: (dialog: "dispatch" | "grn", shipment: ShipmentDto, prefill: DocumentPrefill) => void;
}) {
  const { toast } = useToast();
  const read = useReadProjectDocument(projectId);
  const [file, setFile] = useState<File | null>(null);
  const result = read.data;

  async function handleRead() {
    if (!file) return;
    try {
      await read.mutateAsync({ file });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not read the document", description: errorText(error) });
    }
  }

  const candidates = (result?.shipmentIds ?? [])
    .map((id) => shipments.find((shipment) => shipment.id === id))
    .filter((shipment): shipment is ShipmentDto => Boolean(shipment));
  const facts: [string, string | null][] = result
    ? [
        ["Number", result.documentNumber],
        ["Date", result.documentDate],
        ["PO", result.poNumber],
        ["Vehicle", result.vehicleNumber],
        ["Transporter", result.transporterName],
        ["Amount", result.amount !== null ? formatMoney(result.amount) : null],
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Read a document</DialogTitle>
          <DialogDescription>An e-way bill, GRN or vendor invoice as PDF, Word or Excel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="file"
              aria-label="Document"
              accept=".pdf,.docx,.xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                read.reset();
              }}
            />
            <Button variant="outline" disabled={!file || read.isPending} onClick={() => void handleRead()}>
              {read.isPending ? "Reading…" : "Read document"}
            </Button>
          </div>
          {result && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">
                {result.kind ? KIND_LABELS[result.kind] : "Unrecognised document"}
                {result.reader && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · read by {result.reader === "IISCO" ? "the SAIL IISCO format reader" : "the AI model"}
                  </span>
                )}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {facts
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
              {result.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {file && (result.kind === "EWAY_BILL" || result.kind === "GRN") && candidates.length > 0 && (
                <div className="flex flex-wrap justify-end gap-2">
                  {candidates.map((shipment) => (
                    <Button
                      key={shipment.id}
                      onClick={() => onUse(result.kind === "EWAY_BILL" ? "dispatch" : "grn", shipment, { fields: result, file })}
                    >
                      {result.kind === "EWAY_BILL" ? "Dispatch" : "Record GRN on"} shipment {shipment.number}
                    </Button>
                  ))}
                </div>
              )}
              {result.purchaseOrder && (
                <div className="flex justify-end">
                  <Button asChild>
                    <Link href={`/purchase-orders/${result.purchaseOrder.id}`}>
                      Open vendor PO {result.purchaseOrder.poNumber}
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
