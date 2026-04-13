import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { MagicCard } from '@/components/ui/magic-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, FileText, Clock, ArrowRight } from 'lucide-react';

interface Project {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchProjects = async () => {
    try {
      const data = await api.projects.list();
      setProjects(data.projects || []);
    } catch {
      // will redirect via api 401 handler
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const data = await api.projects.create(newName.trim());
      setShowCreate(false);
      setNewName('');
      navigate(`/editor/${data.project.id}`);
    } catch (err: any) {
      alert(err.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.projects.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete project');
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Projects</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{user?.email}</p>
          </div>
          <ShimmerButton onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </ShimmerButton>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          </div>
        )}

        {/* Empty state */}
        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-white py-20 dark:border-gray-700 dark:bg-gray-950">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900">
              <FileText className="h-8 w-8 text-brand-600 dark:text-brand-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No projects yet</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create your first project and start writing LaTeX!</p>
            <ShimmerButton onClick={() => setShowCreate(true)} className="mt-6 gap-2">
              <Plus className="h-4 w-4" />
              Create Your First Project
            </ShimmerButton>
          </div>
        )}

        {/* Project grid */}
        {!loading && projects.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <MagicCard key={project.id} onClick={() => navigate(`/editor/${project.id}`)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900">
                      <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{project.name}</h3>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="h-3 w-3" />
                        {formatDate(project.updated_at)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/editor/${project.id}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                  >
                    Open
                    <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project.id);
                    }}
                    disabled={deleting === project.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-red-800 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    {deleting === project.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </MagicCard>
            ))}
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-950">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Project</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Give your project a name to get started.</p>
              <form onSubmit={handleCreate} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="projectName">Project Name</Label>
                  <Input
                    id="projectName"
                    placeholder="My LaTeX Document"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setNewName(''); }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <ShimmerButton type="submit" disabled={creating || !newName.trim()}>
                    {creating ? 'Creating...' : 'Create Project'}
                  </ShimmerButton>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}