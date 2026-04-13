import { useState, useEffect, useCallback } from 'react';
import { api, ShareLink, ProjectMember } from '@/lib/api';
import { X, Copy, Check, Trash2, Shield, Eye, Pencil, Link2, Users, Clock } from 'lucide-react';

interface ShareModalProps {
  projectId: number;
  projectName: string;
  onClose: () => void;
}

export default function ShareModal({ projectId, projectName, onClose }: ShareModalProps) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('viewer');
  const [selectedRole, setSelectedRole] = useState<'viewer' | 'editor'>('viewer');
  const [loading, setLoading] = useState(true);
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await api.share.getMembers(projectId);
      setMembers(data.members);
      setShareLinks(data.shareLinks);
      setCurrentUserRole(data.currentUserRole);
    } catch (err: any) {
      setError(err.message || 'Failed to load sharing info');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateLink = async () => {
    setCreatingLink(true);
    setError(null);
    try {
      const data = await api.share.createLink(projectId, selectedRole);
      setShareLinks(prev => [...prev, data.shareLink]);
    } catch (err: any) {
      setError(err.message || 'Failed to create link');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleRevokeLink = async (linkId: number) => {
    try {
      await api.share.revokeLink(linkId);
      setShareLinks(prev => prev.filter(l => l.id !== linkId));
    } catch (err: any) {
      setError(err.message || 'Failed to revoke link');
    }
  };

  const handleCopyLink = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  };

  const handleChangeRole = async (userId: number, newRole: 'viewer' | 'editor') => {
    try {
      await api.share.updateMemberRole(projectId, userId, newRole);
      setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
    } catch (err: any) {
      setError(err.message || 'Failed to update role');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Remove this member from the project?')) return;
    try {
      await api.share.removeMember(projectId, userId);
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    }
  };

  const canManage = currentUserRole === 'owner' || currentUserRole === 'editor';

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <Shield className="h-3 w-3" />
            Owner
          </span>
        );
      case 'editor':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            <Pencil className="h-3 w-3" />
            Editor
          </span>
        );
      case 'viewer':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <Eye className="h-3 w-3" />
            Viewer
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Share Project</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{projectName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Create share link */}
        {canManage && (
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Link2 className="h-4 w-4" />
              Create Share Link
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'viewer' | 'editor')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              <button
                onClick={handleCreateLink}
                disabled={creatingLink}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {creatingLink ? 'Creating...' : 'Create Link'}
              </button>
            </div>

            {/* Active share links */}
            {shareLinks.length > 0 && (
              <div className="mt-4 space-y-2">
                {shareLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {link.role === 'editor' ? (
                        <span className="text-blue-600 dark:text-blue-400">Can edit</span>
                      ) : (
                        <span className="text-gray-600 dark:text-gray-400">Can view</span>
                      )}
                      {link.expires_at && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock className="h-3 w-3" />
                          Expires {new Date(link.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopyLink(link.token)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      >
                        {copiedToken === link.token ? (
                          <><Check className="h-3 w-3 text-emerald-500" /> Copied!</>
                        ) : (
                          <><Copy className="h-3 w-3" /> Copy</>
                        )}
                      </button>
                      <button
                        onClick={() => handleRevokeLink(link.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950 dark:hover:text-red-400"
                        title="Revoke link"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Members list */}
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Users className="h-4 w-4" />
            Members ({members.length})
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
            </div>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                      {(member.display_name || member.email).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {member.display_name || member.email}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{member.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {member.role === 'owner' ? (
                      getRoleBadge(member.role)
                    ) : currentUserRole === 'owner' ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleChangeRole(member.user_id, e.target.value as 'viewer' | 'editor')}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                    ) : (
                      getRoleBadge(member.role)
                    )}
                    {currentUserRole === 'owner' && member.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="rounded p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                        title="Remove member"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}