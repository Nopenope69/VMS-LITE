// Bookmark Types & DTOs for VMS-Lite (EXT-05)

export interface BookmarkDto {
  id: string;
  cameraId: string;
  userId?: string | null;
  timestamp: string;
  title: string;
  description?: string | null;
  category: string; // incident, visitor, maintenance, activity
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookmarkRequest {
  timestamp: string;
  title: string;
  description?: string;
  category?: string;
}

export interface BookmarkQueryParams {
  from?: string;
  to?: string;
  category?: string;
}
