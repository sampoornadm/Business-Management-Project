export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ListNotificationsQuery {
  page?: number;
  pageSize?: number;
  isRead?: boolean;
}
