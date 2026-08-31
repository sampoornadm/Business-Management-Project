"use client";

import type { ContactDto } from "@bmp/types";
import { Badge, Button, Card, CardContent } from "@bmp/ui";
import { Mail, Phone, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export interface ContactCardProps {
  contact: ContactDto;
  canUpdate: boolean;
  editTrigger: ReactNode;
  onDelete: () => void;
}

export function ContactCard({ contact, canUpdate, editTrigger, onDelete }: ContactCardProps) {
  const primaryPhone = contact.phones.find((p) => p.isPrimary) ?? contact.phones[0];
  const otherPhones = contact.phones.filter((p) => p.id !== primaryPhone?.id);
  const primaryEmail = contact.emails.find((e) => e.isPrimary) ?? contact.emails[0];
  const otherEmails = contact.emails.filter((e) => e.id !== primaryEmail?.id);

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-medium">{contact.name}</p>
              {contact.isPrimary && <Badge variant="secondary">Primary</Badge>}
            </div>

            {(contact.designation ?? contact.department) && (
              <p className="text-sm text-muted-foreground">
                {[contact.designation, contact.department].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          {canUpdate && (
            <div className="flex shrink-0 gap-2">
              {editTrigger}
              <Button size="sm" variant="ghost" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {(primaryPhone || primaryEmail) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {primaryPhone && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{primaryPhone.phone}</span>
                {otherPhones.map((phone) => (
                  <span key={phone.id} className="text-muted-foreground">
                    · {phone.phone}
                  </span>
                ))}
              </div>
            )}

            {primaryEmail && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${primaryEmail.email}`} className="font-medium text-primary hover:underline">
                  {primaryEmail.email}
                </a>
                {otherEmails.map((email) => (
                  <a key={email.id} href={`mailto:${email.email}`} className="text-muted-foreground hover:underline">
                    · {email.email}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {contact.notes && (
          <div className="max-w-3xl border-t pt-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
