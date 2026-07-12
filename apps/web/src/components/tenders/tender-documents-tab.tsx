"use client";

import { TENDER_DOCUMENT_TYPES, type TenderDocumentType } from "@bmp/types";
import { DocumentUpload, Skeleton, type DocumentVersion, useToast } from "@bmp/ui";
import { Loader2, Plus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import {
  useDeleteTenderDocument,
  useTenderDocumentVersions,
  useTenderDocuments,
  useUploadTenderDocument,
} from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const DOCUMENT_TYPE_LABELS: Record<TenderDocumentType, string> = {
  NIT: "Notice Inviting Tender (NIT)",
  BOQ: "Bill of Quantities (BOQ)",
  TECHNICAL_SPECS: "Technical Specifications",
  DRAWINGS: "Drawings",
  CORRIGENDUM: "Corrigendum",
  TENDER_NOTICE: "Tender Notice",
  ADDENDUM: "Addendum",
  GENERAL: "General Documents",
};

// An existing file lineage (a specific file + its version history). Always has a
// documentGroupId — the empty and "add another" slots are separate components below.
function DocumentLineage({
  tenderId,
  documentType,
  documentGroupId,
  canDelete,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
  documentGroupId: string;
  canDelete: boolean;
}) {
  const { toast } = useToast();
  const versionsQuery = useTenderDocumentVersions(tenderId, documentGroupId);
  const upload = useUploadTenderDocument(tenderId);
  const deleteDocument = useDeleteTenderDocument(tenderId);

  const versions: DocumentVersion[] = (versionsQuery.data ?? []).map((doc) => ({
    id: doc.id,
    version: doc.version,
    originalName: doc.originalName,
    url: doc.url,
    uploadedByName: `${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`,
    uploadedAt: doc.createdAt,
    isCurrent: doc.isCurrent,
    sizeBytes: doc.sizeBytes,
  }));

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync({ file, documentType, replacesAttachmentId: documentGroupId });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this file? All of its versions will be removed.")) return;
    try {
      await deleteDocument.mutateAsync(documentGroupId);
      toast({ title: "Document deleted" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <DocumentUpload
      versions={versions}
      onUpload={handleUpload}
      onDelete={canDelete ? handleDelete : undefined}
      isUploading={upload.isPending}
      isDeleting={deleteDocument.isPending}
    />
  );
}

// The one visible row for a document type that has zero files yet.
function EmptyDocumentSlot({
  tenderId,
  documentType,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
}) {
  const { toast } = useToast();
  const upload = useUploadTenderDocument(tenderId);

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync({ file, documentType });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return <DocumentUpload versions={[]} onUpload={handleUpload} isUploading={upload.isPending} />;
}

// Compact text-link affordance for adding another file to a type that already has one,
// instead of a second full empty row.
function AddAnotherFileLink({
  tenderId,
  documentType,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadTenderDocument(tenderId);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await upload.mutateAsync({ file, documentType });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="px-4 pb-2.5">
      <input ref={inputRef} type="file" onChange={handleFileChange} className="hidden" />
      <button
        type="button"
        onClick={() => !upload.isPending && inputRef.current?.click()}
        disabled={upload.isPending}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        {upload.isPending ? "Uploading..." : "Add another file"}
      </button>
    </div>
  );
}

function DocumentTypeSection({
  tenderId,
  documentType,
  documentGroupIds,
  canDelete,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
  documentGroupIds: string[];
  canDelete: boolean;
}) {
  const hasFiles = documentGroupIds.length > 0;

  return (
    <div role="group" aria-label={DOCUMENT_TYPE_LABELS[documentType]}>
      <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {DOCUMENT_TYPE_LABELS[documentType]}
      </h3>
      <div className="divide-y px-4">
        {hasFiles ? (
          documentGroupIds.map((documentGroupId) => (
            <DocumentLineage
              key={documentGroupId}
              tenderId={tenderId}
              documentType={documentType}
              documentGroupId={documentGroupId}
              canDelete={canDelete}
            />
          ))
        ) : (
          <EmptyDocumentSlot tenderId={tenderId} documentType={documentType} />
        )}
      </div>
      {hasFiles ? <AddAnotherFileLink tenderId={tenderId} documentType={documentType} /> : null}
    </div>
  );
}

// Compact row-based layout for tender documents
export function TenderDocumentsTab({ tenderId }: { tenderId: string }) {
  const documentsQuery = useTenderDocuments(tenderId);
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canDelete = hasPermission(roleName, "attachments:delete");

  if (documentsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const groupIdsByType = new Map<TenderDocumentType, string[]>();
  for (const doc of documentsQuery.data ?? []) {
    if (!doc.documentType || !doc.documentGroupId) continue;
    const type = doc.documentType as TenderDocumentType;
    const existing = groupIdsByType.get(type) ?? [];
    existing.push(doc.documentGroupId);
    groupIdsByType.set(type, existing);
  }

  return (
    <div className="divide-y rounded-md border">
      {TENDER_DOCUMENT_TYPES.map((documentType) => (
        <DocumentTypeSection
          key={documentType}
          tenderId={tenderId}
          documentType={documentType}
          documentGroupIds={groupIdsByType.get(documentType) ?? []}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
