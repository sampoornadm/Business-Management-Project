export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface ScopedRequestContext extends RequestContext {
  businessId: string;
}
