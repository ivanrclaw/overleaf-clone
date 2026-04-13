const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || data.message || 'Request failed');
  }

  return res.json();
}

async function uploadFilesRequest(projectId: number, files: File[], folder: string): Promise<{ files: { id: number; name: string; path: string }[] }> {
  const token = getToken();
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  formData.append('folder', folder);

  const res = await fetch(`${API_BASE}/projects/${projectId}/files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || data.message || 'Upload failed');
  }

  return res.json();
}

export interface ProjectMember {
  role: string;
  created_at: string;
  user_id: number;
  email: string;
  display_name: string | null;
}

export interface ShareLink {
  id: number;
  token: string;
  role: string;
  expires_at: string | null;
  created_at: string;
  created_by_email: string;
}

export interface InviteInfo {
  projectName: string;
  ownerEmail: string;
  ownerName: string | null;
  role: string;
  projectId: number;
}

export interface SharedProject {
  id: number;
  name: string;
  content?: string;
  created_at: string;
  updated_at: string;
  member_role: string;
}

export const api = {
  auth: {
    register: (email: string, password: string) =>
      request<{ token: string; user: { id: number; email: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: { id: number; email: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ user: { id: number; email: string } }>('/auth/me'),
  },
  projects: {
    list: () => request<{ projects: { id: number; name: string; created_at: string; updated_at: string }[] }>('/projects'),
    create: (name: string) =>
      request<{ project: { id: number; name: string; content: string; created_at: string; updated_at: string } }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    get: (id: number) =>
      request<{ project: { id: number; name: string; content: string; created_at: string; updated_at: string }; role: string }>(`/projects/${id}`),
    save: (id: number, content: string) =>
      request<{ project: { id: number; name: string; content: string; created_at: string; updated_at: string } }>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
    compile: (id: number, draft: boolean = false) =>
      request<{ pdf?: string; error?: string; log?: string }>(`/projects/${id}/compile`, {
        method: 'POST',
        body: JSON.stringify({ draft }),
      }),
    lint: (id: number, content: string) =>
      request<{ diagnostics: { from: { line: number; col: number }; to: { line: number; col: number }; severity: string; message: string }[] }>(`/projects/${id}/lint`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    // File operations
    listFiles: (id: number) =>
      request<{ files: { id: number; name: string; path: string; is_folder: boolean; created_at: string; updated_at: string }[]; role: string }>(`/projects/${id}/files`),
    createFile: (projectId: number, name: string, path: string, isFolder?: boolean, content?: string) =>
      request<{ file: { id: number; name: string; path: string; is_folder: boolean; content: string } }>(`/projects/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({ name, path, is_folder: isFolder ? 1 : 0, content: content || '' }),
      }),
    getFile: (projectId: number, fileId: number) =>
      request<{ file: { id: number; name: string; path: string; content: string; is_folder: boolean; created_at: string; updated_at: string } }>(`/projects/${projectId}/files/${fileId}`),
    saveFile: (projectId: number, fileId: number, data: { content?: string; name?: string }) =>
      request<{ file: { id: number; name: string; path: string; content: string; is_folder: boolean; updated_at: string } }>(`/projects/${projectId}/files/${fileId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    moveFile: (projectId: number, fileId: number, newPath: string) =>
      request<{ file: { id: number; name: string; path: string; is_folder: boolean; created_at: string; updated_at: string } }>(`/projects/${projectId}/files/${fileId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ newPath }),
      }),
    deleteFile: (projectId: number, fileId: number) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
    uploadFiles: (projectId: number, files: File[], folder: string = '/') =>
      uploadFilesRequest(projectId, files, folder),
  },
  share: {
    // Get project members and share links
    getMembers: (projectId: number) =>
      request<{ members: ProjectMember[]; shareLinks: ShareLink[]; currentUserRole: string }>(`/share/project/${projectId}/members`),
    // Generate a share link
    createLink: (projectId: number, role: 'viewer' | 'editor' = 'viewer', expiresInHours?: number) =>
      request<{ shareLink: ShareLink & { project_id: number } }>(`/share/project/${projectId}/link`, {
        method: 'POST',
        body: JSON.stringify({ role, expiresInHours }),
      }),
    // Revoke a share link
    revokeLink: (linkId: number) =>
      request<{ ok: boolean }>(`/share/link/${linkId}`, { method: 'DELETE' }),
    // Get invite info (public, no auth needed but we send token if available)
    getInviteInfo: (token: string) => {
      const authToken = getToken();
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      return request<InviteInfo>(`/share/invite/${token}`, { headers });
    },
    // Accept a share invite
    acceptInvite: (token: string) =>
      request<{ project: any; role: string; alreadyMember: boolean }>(`/share/invite/${token}/accept`, {
        method: 'POST',
      }),
    // Update member role
    updateMemberRole: (projectId: number, userId: number, role: 'viewer' | 'editor') =>
      request<{ ok: boolean; role: string }>(`/share/project/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    // Remove member
    removeMember: (projectId: number, userId: number) =>
      request<{ ok: boolean }>(`/share/project/${projectId}/members/${userId}`, { method: 'DELETE' }),
    // List shared projects
    listShared: () =>
      request<{ projects: SharedProject[] }>('/share/projects'),
  },
};