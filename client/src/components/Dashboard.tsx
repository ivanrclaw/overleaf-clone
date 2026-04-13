import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { MagicCard } from '@/components/ui/magic-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Plus, Trash2, FileText, Clock, ArrowRight,
  Share2, Users, Eye, Pencil, Shield,
} from 'lucide-react';
import ShareModal from '@/components/ShareModal';

interface Project {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  member_role?: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [shareProject, setShareProject] = useState<{ id: number; name: string } | null>(null);

  const fetchProjects = async () => {
    try {
      const data = await api.projects.list();
      setProjects(data.projects || []);
    } catch {
      // will redirect via api 401 handler
    }
  };

  const fetchSharedProjects = async () => {
    try {
      const data = await api.share.listShared();
      setSharedProjects(data.projects || []);
    } catch {
      // ignore — not critical
    }
  };

  useEffect(() => {
    Promise.all([fetchProjects(), fetchSharedProjects()]).finally(() => setLoading(false));
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

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><Shield className="h-3 w-3" />Owner</span>;
      case 'editor':
        return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"><Pencil className="h-3 w-3" />Editor</span>;
      case 'viewer':
        return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-400"><Eye className="h-3 w-3" />Viewer</span>;
      default:
        return null;
    }
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

        {/* Create project modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Create New Project</h2>
              <form onSubmit={handleCreate} className="mt-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Project Name</Label>
                  <Input
                    id="project-name"
                    placeholder="My LaTeX Project"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setNewName(''); }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <ShimmerButton type="submit" disabled={creating} className="gap-2">
                    <Plus className="h-4 w-4" />
                    {creating ? 'Creating...' : 'Create'}
                  </ShimmerButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          </div>
        )}

        {/* My Projects */}
        {!loading && (
          <>
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                <FileText className="h-5 w-5 text-brand-500" />
                Owned by me
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  {projects.length}
                </span>
              </h2>

              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 dark:border-gray-700 dark:bg-gray-950">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900">
                    <FileText className="h-8 w-8 text-brand-600 dark:text-brand-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No projects yet</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create your first project and start writing LaTeX!</p>
                  <ShimmerButton onClick={() => setShowCreate(true)} className="mt-6 gap-2">
                    <Plus className="h-4 w-4" />
                    Create Your First Project
                  </ShimmerButton>
                </div>
              ) : (
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
                          onClick={(e) => { e.stopPropagation(); navigate(`/editor/${project.id}`); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                        >
                          Open
                          <ArrowRight className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShareProject({ id: project.id, name: project.name }); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-brand-400"
                        >
                          <Share2 className="h-3 w-3" />
                          Share
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
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
            </section>

            {/* Shared with me */}
            {sharedProjects.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <Users className="h-5 w-5 text-purple-500" />
                  Shared with me
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                    {sharedProjects.length}
                  </span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedProjects.map((project) => (
                    <MagicCard key={project.id} onClick={() => navigate(`/editor/${project.id}`)}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900">
                            <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{project.name}</h3>
                            <div className="mt-0.5 flex items-center gap-2">
                              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                <Clock className="h-3 w-3" />
                                {formatDate(project.updated_at)}
                              </div>
                              {project.member_role && getRoleBadge(project.member_role)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/editor/${project.id}`); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700"
                        >
                          Open
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </MagicCard>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Share Modal */}
      {shareProject && (
        <ShareModal
          projectId={shareProject.id}
          projectName={shareProject.name}
          onClose={() => setShareProject(null)}
        />
      )}
    </div>
  );
}