"use client";

import type { ContactDto, CreateContactInput } from "@bmp/types";
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

interface PhoneRow {
  key: string;
  phone: string;
  isPrimary: boolean;
}

interface EmailRow {
  key: string;
  email: string;
  isPrimary: boolean;
}

export interface ContactDialogProps {
  trigger: ReactNode;
  contact?: ContactDto;
  departmentOptions: string[];
  designationOptions: string[];
  onSubmit: (values: CreateContactInput) => Promise<void>;
}

function phonesToRows(phones: ContactDto["phones"]): PhoneRow[] {
  return phones.map((phone) => ({ key: phone.id, phone: phone.phone, isPrimary: phone.isPrimary }));
}

function emailsToRows(emails: ContactDto["emails"]): EmailRow[] {
  return emails.map((email) => ({ key: email.id, email: email.email, isPrimary: email.isPrimary }));
}

export function ContactDialog({
  trigger,
  contact,
  departmentOptions,
  designationOptions,
  onSubmit,
}: ContactDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [department, setDepartment] = useState(contact?.department ?? "");
  const [designation, setDesignation] = useState(contact?.designation ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [phones, setPhones] = useState<PhoneRow[]>(contact ? phonesToRows(contact.phones) : []);
  const [emails, setEmails] = useState<EmailRow[]>(contact ? emailsToRows(contact.emails) : []);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? "");
      setDepartment(contact?.department ?? "");
      setDesignation(contact?.designation ?? "");
      setNotes(contact?.notes ?? "");
      setIsPrimary(contact?.isPrimary ?? false);
      setPhones(contact ? phonesToRows(contact.phones) : []);
      setEmails(contact ? emailsToRows(contact.emails) : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function addPhone() {
    setPhones((rows) => [...rows, { key: crypto.randomUUID(), phone: "", isPrimary: rows.length === 0 }]);
  }
  function addEmail() {
    setEmails((rows) => [...rows, { key: crypto.randomUUID(), email: "", isPrimary: rows.length === 0 }]);
  }
  function setPrimaryPhone(key: string) {
    setPhones((rows) => rows.map((row) => ({ ...row, isPrimary: row.key === key })));
  }
  function setPrimaryEmail(key: string) {
    setEmails((rows) => rows.map((row) => ({ ...row, isPrimary: row.key === key })));
  }

  async function handleSubmit() {
    const values: CreateContactInput = {
      name,
      department: department || undefined,
      designation: designation || undefined,
      notes: notes || undefined,
      isPrimary,
      phones: phones.filter((row) => row.phone.trim()).map((row) => ({ phone: row.phone, isPrimary: row.isPrimary })),
      emails: emails.filter((row) => row.email.trim()).map((row) => ({ email: row.email, isPrimary: row.isPrimary })),
    };
    await onSubmit(values);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Designation</label>
              <Combobox
                options={designationOptions}
                value={designation}
                onChange={setDesignation}
                placeholder="Select designation"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Department</label>
              <Combobox
                options={departmentOptions}
                value={department}
                onChange={setDepartment}
                placeholder="Select department"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Phone numbers</label>
              <Button type="button" size="sm" variant="outline" onClick={addPhone}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {phones.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="primary-phone"
                  checked={row.isPrimary}
                  onChange={() => setPrimaryPhone(row.key)}
                  title="Primary phone"
                />
                <Input
                  value={row.phone}
                  onChange={(e) =>
                    setPhones((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, phone: e.target.value } : r)),
                    )
                  }
                  placeholder="Phone number"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPhones((rows) => rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Emails</label>
              <Button type="button" size="sm" variant="outline" onClick={addEmail}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {emails.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="primary-email"
                  checked={row.isPrimary}
                  onChange={() => setPrimaryEmail(row.key)}
                  title="Primary email"
                />
                <Input
                  type="email"
                  value={row.email}
                  onChange={(e) =>
                    setEmails((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, email: e.target.value } : r)),
                    )
                  }
                  placeholder="Email address"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEmails((rows) => rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox checked={isPrimary} onCheckedChange={(checked) => setIsPrimary(Boolean(checked))} />
            <label className="text-sm">Primary contact</label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
