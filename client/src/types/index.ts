export interface User {
  id: number;
  email: string;
}

export interface Project {
  id: number;
  name: string;
  content?: string;
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