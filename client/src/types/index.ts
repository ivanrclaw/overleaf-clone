export interface User {
  id: number;
  email: string;
  display_name?: string | null;
}

export interface Project {
  id: number;
  name: string;
  content?: string;
  created_at: string;
  updated_at: string;
  auto_save_interval?: number;
}

export interface ProjectFile {
  id: number;
  name: string;
  path: string;
  content?: string;
  is_folder: boolean;
  created_at: string;
  updated_at: string;
}

export interface LintDiagnostic {
  from: { line: number; col: number };
  to: { line: number; col: number };
  severity: 'error' | 'warning';
  message: string;
}

export interface AuthResponse {
  token: string;
  user: User;
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
  project_id: number;
  role: string;
  expires_at: string | null;
  created_at: string;
  created_by: number;
  created_by_email?: string;
}

export interface InviteInfo {
  projectName: string;
  ownerEmail: string;
  ownerName: string | null;
  role: string;
  projectId: number;
}

export interface CollaboratorInfo {
  userId: number;
  email: string;
  displayName: string | null;
  role: string;
  cursor?: { line: number; col: number };
  selection?: { fromLine: number; fromCol: number; toLine: number; toCol: number };
}

export interface CompileError {
  line: number;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
}