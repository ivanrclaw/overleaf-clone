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
    // NOTE: do NOT set Content-Type — browser sets it with boundary for multipart
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
      request<{ project: { id: number; name: string; content: string; created_at: string; updated_at: string } }>(`/projects/${id}`),
    save: (id: number, content: string) =>
      request<{ project: { id: number; name: string; content: string; created_at: string; updated_at: string } }>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
    compile: (id: number) =>
      request<{ pdf?: string; error?: string; log?: string }>(`/projects/${id}/compile`, { method: 'POST' }),
    lint: (id: number, content: string) =>
      request<{ diagnostics: { from: { line: number; col: number }; to: { line: number; col: number }; severity: string; message: string }[] }>(`/projects/${id}/lint`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    // File operations
    listFiles: (id: number) =>
      request<{ files: { id: number; name: string; path: string; is_folder: boolean; created_at: string; updated_at: string }[] }>(`/projects/${id}/files`),
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
    deleteFile: (projectId: number, fileId: number) =>
      request<{ ok: boolean }>(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
    uploadFiles: (projectId: number, files: File[], folder: string = '/') =>
      uploadFilesRequest(projectId, files, folder),
  },
};