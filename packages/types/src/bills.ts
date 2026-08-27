export interface CreateBillItemInput {
  boqItemId?: string;
  description: string;
  unit?: string;
  quantity: number;
  rate: number;
}

export interface CreateBillInput {
  tenderId: string;
  grnNumber?: string;
  grnDate?: string;
  items: CreateBillItemInput[];
}

export interface BillItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder: number;
}

export interface BillListItemDto {
  id: string;
  billNumber: string;
  billDate: string;
  tenderId: string;
  tenderTitle: string;
  clientName: string;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface BillDto extends BillListItemDto {
  grnNumber: string | null;
  grnDate: string | null;
  items: BillItemDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface ListBillsQuery {
  page?: number;
  pageSize?: number;
  tenderId?: string;
}
