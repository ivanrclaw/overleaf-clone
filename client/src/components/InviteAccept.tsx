import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { FileText, Check, AlertCircle, Loader2, LogIn } from 'lucide-react';
import { ShimmerButton } from '@/components/ui/shimmer-button';

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const [inviteInfo, setInviteInfo] = useState<{
    projectName: string;
    ownerEmail: string;
    ownerName: string | null;
    role: string;
    projectId: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  // Load invite info
  useEffect(() => {
    if (!token) return;
    const loadInvite = async () => {
      try {
        const data = await api.share.getInviteInfo(token);
        setInviteInfo(data);
      } catch (err: any) {
        setError(err.message || 'This invite is invalid or expired');
      } finally {
        setLoading(false);
      }
    };
    loadInvite();
  }, [token]);

  // Auto-accept if already logged in
  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const data = await api.share.acceptInvite(token);
      setAccepted(true);
      // Redirect to editor after a short delay
      setTimeout(() => {
        navigate(`/editor/${data.project.id}`);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to accept invite');
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  // Error state
  if (error && !inviteInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-xl dark:border-gray-800 dark:bg-gray-950">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Invalid Invite</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (accepted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-xl dark:border-gray-800 dark:bg-gray-950">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
            <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Project Added!</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Redirecting to the editor...
          </p>
        </div>
      </div>
    );
  }

  // Not logged in — prompt login/register
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-brand-50/30 px-4 dark:from-gray-950 dark:to-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 text-white">
              <FileText className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">You're Invited!</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{inviteInfo?.ownerEmail}</span> invited you to collaborate on
            </p>
            <p className="mt-1 text-lg font-semibold text-brand-600 dark:text-brand-400">{inviteInfo?.projectName}</p>
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                inviteInfo?.role === 'editor'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {inviteInfo?.role === 'editor' ? '✏️ Can edit' : '👁️ Can view'}
              </span>
            </div>
          </div>

          <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Sign in or create an account to accept this invitation.
          </p>

          <div className="flex flex-col gap-3">
            <ShimmerButton
              onClick={() => navigate(`/login?redirect=/invite/${token}`)}
              className="w-full justify-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              Sign In to Accept
            </ShimmerButton>
            <button
              onClick={() => navigate(`/register?redirect=/invite/${token}`)}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Create Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Logged in — show invite details and accept button
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-brand-50/30 px-4 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl dark:border-gray-800 dark:bg-gray-950">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 text-white">
            <FileText className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">You're Invited!</h2>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">{inviteInfo?.ownerEmail}</span> invited you to collaborate on
          </div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{inviteInfo?.projectName}</div>
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
              inviteInfo?.role === 'editor'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {inviteInfo?.role === 'editor' ? '✏️ Can edit' : '👁️ Can view'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        <ShimmerButton
          onClick={handleAccept}
          disabled={accepting}
          className="w-full justify-center gap-2"
        >
          {accepting ? 'Accepting...' : 'Accept Invitation'}
        </ShimmerButton>

        <button
          onClick={() => navigate('/dashboard')}
          className="mt-3 w-full rounded-lg px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Go to Dashboard instead
        </button>
      </div>
    </div>
  );
}