"use client";

import { TENDER_DOCUMENT_TYPES, type TenderDocumentType } from "@bmp/types";
import { DocumentUpload, type DocumentVersion, useToast } from "@bmp/ui";

import {
  useTenderDocumentVersions,
  useTenderDocuments,
  useUploadTenderDocument,
} from "@/hooks/use-tenders";

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

function DocumentSlot({
  tenderId,
  documentType,
  currentGroupId,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
  currentGroupId: string | undefined;
}) {
  const { toast } = useToast();
  const versionsQuery = useTenderDocumentVersions(tenderId, currentGroupId);
  const upload = useUploadTenderDocument(tenderId);

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
      await upload.mutateAsync({ file, documentType, replacesAttachmentId: currentGroupId });
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
    <DocumentUpload
      label={DOCUMENT_TYPE_LABELS[documentType]}
      versions={versions}
      onUpload={handleUpload}
      isUploading={upload.isPending}
    />
  );
}

export function TenderDocumentsTab({ tenderId }: { tenderId: string }) {
  const documentsQuery = useTenderDocuments(tenderId);

  const currentByType = new Map((documentsQuery.data ?? []).map((doc) => [doc.documentType, doc]));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {TENDER_DOCUMENT_TYPES.map((documentType) => (
        <DocumentSlot
          key={documentType}
          tenderId={tenderId}
          documentType={documentType}
          currentGroupId={currentByType.get(documentType)?.documentGroupId ?? undefined}
        />
      ))}
    </div>
  );
}
