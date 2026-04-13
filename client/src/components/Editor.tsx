import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { ProjectFile } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useCollaboration, CollaboratorInfo } from '@/hooks/useCollaboration';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { latex } from 'codemirror-lang-latex';
import { linter, lintGutter, Diagnostic } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import FileExplorer from '@/components/FileExplorer';
import ShareModal from '@/components/ShareModal';
import {
  ArrowLeft,
  Save,
  Play,
  Loader2,
  Check,
  AlertCircle,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  ImageIcon,
  Zap,
  PencilLine,
  Share2,
  Users,
  Eye,
} from 'lucide-react';

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'compiling';
const AUTO_SAVE_DELAY = 3000;
const AUTO_COMPILE_DELAY = 2000;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has('.' + ext);
}

// Collaborator color palette
const COLLAB_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
];

function getCollabColor(userId: number): string {
  return COLLAB_COLORS[userId % COLLAB_COLORS.length];
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const projectId = Number(id);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCompileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs for stable callbacks
  const saveCallbackRef = useRef<() => void>(() => {});
  const autoSaveCallbackRef = useRef<() => void>(() => {});

  const [projectName, setProjectName] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [loading, setLoading] = useState(true);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multi-file state
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const [activeFileName, setActiveFileName] = useState<string>('');
  const [filesLoading, setFilesLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Image preview
  const [activeImageSrc, setActiveImageSrc] = useState<string | null>(null);

  // Compilation
  const [autoCompile, setAutoCompile] = useState(false);
  const [draftMode, setDraftMode] = useState(false);

  // Sharing & collaboration
  const [showShareModal, setShowShareModal] = useState(false);
  const [userRole, setUserRole] = useState<string>('owner');

  const activeFileIdRef = useRef<number | null>(null);
  useEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);

  const autoCompileRef = useRef(false);
  const draftModeRef = useRef(false);
  useEffect(() => { autoCompileRef.current = autoCompile; }, [autoCompile]);
  useEffect(() => { draftModeRef.current = draftMode; }, [draftMode]);

  // WebSocket collaboration
  const {
    connected: wsConnected,
    collaborators,
    myRole: wsRole,
    isViewer,
    sendCursor,
    sendFileCreated,
    sendFileDeleted,
    sendFileMoved,
    sendFileSaved,
  } = useCollaboration({
    projectId,
    token,
    onFileCreated: () => { loadFiles(); },
    onFileDeleted: () => { loadFiles(); },
    onFileMoved: () => { loadFiles(); },
    onFileSaved: () => { /* files auto-refresh on save */ },
    onConnected: (_users, role) => { setUserRole(role); },
  });

  // Update role from WS
  useEffect(() => { if (wsRole) setUserRole(wsRole); }, [wsRole]);

  const isReadOnly = isViewer;

  // Save current active file
  const saveCurrentFile = useCallback(async (fileId: number | null, content: string) => {
    if (!fileId) return;
    setSaveStatus('saving');
    try {
      await api.projects.saveFile(projectId, fileId, { content });
      setSaveStatus('saved');
      sendFileSaved(fileId);
    } catch (err: any) {
      console.error('Auto-save failed:', err.message);
      setSaveStatus('unsaved');
    }
  }, [projectId, sendFileSaved]);

  // Auto-compile
  const handleAutoCompile = useCallback(async () => {
    setCompileError(null);
    setSaveStatus('compiling');
    try {
      const data = await api.projects.compile(projectId, draftModeRef.current);
      if (data.pdf) setPdfData(data.pdf);
      if (data.error) setCompileError(data.error);
    } catch (err: any) {
      setCompileError(err.message || 'Auto-compile failed');
    } finally {
      setSaveStatus('saved');
    }
  }, [projectId]);

  // Auto-save
  const handleAutoSave = useCallback(() => {
    if (!viewRef.current || !activeFileIdRef.current) return;
    const content = viewRef.current.state.doc.toString();
    saveCurrentFile(activeFileIdRef.current, content).then(() => {
      if (autoCompileRef.current) {
        if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
        autoCompileTimerRef.current = setTimeout(() => handleAutoCompile(), AUTO_COMPILE_DELAY);
      }
    });
  }, [saveCurrentFile, handleAutoCompile]);

  // Manual save
  const handleSave = useCallback(async () => {
    if (!viewRef.current || !activeFileIdRef.current || saveStatus === 'saving') return;
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    const content = viewRef.current.state.doc.toString();
    await saveCurrentFile(activeFileIdRef.current, content);
    if (autoCompileRef.current) {
      if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
      autoCompileTimerRef.current = setTimeout(() => handleAutoCompile(), AUTO_COMPILE_DELAY);
    }
  }, [saveCurrentFile, saveStatus, handleAutoCompile]);

  useEffect(() => { saveCallbackRef.current = handleSave; }, [handleSave]);
  useEffect(() => { autoSaveCallbackRef.current = handleAutoSave; }, [handleAutoSave]);

  // Compile
  const handleCompile = useCallback(async () => {
    if (saveStatus === 'compiling') return;
    if (autoCompileTimerRef.current) { clearTimeout(autoCompileTimerRef.current); autoCompileTimerRef.current = null; }
    if (viewRef.current && activeFileId) {
      const content = viewRef.current.state.doc.toString();
      try { await saveCurrentFile(activeFileId, content); } catch { /* continue */ }
    }
    setSaveStatus('compiling');
    setCompileError(null);
    setPdfData(null);
    try {
      const data = await api.projects.compile(projectId, draftMode);
      if (data.pdf) setPdfData(data.pdf);
      if (data.error) setCompileError(data.error);
    } catch (err: any) {
      setCompileError(err.message || 'Compilation failed');
    } finally {
      setSaveStatus((prev) => prev === 'compiling' ? 'saved' : prev);
    }
  }, [projectId, saveStatus, activeFileId, saveCurrentFile, draftMode]);

  // Load files
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const data = await api.projects.listFiles(projectId);
      setFiles(data.files.map(f => ({ ...f, is_folder: !!f.is_folder })));
      if (data.role) setUserRole(data.role);
    } catch (err: any) {
      console.error('Failed to load files:', err.message);
    } finally {
      setFilesLoading(false);
    }
  }, [projectId]);

  // Load project + files on mount
  useEffect(() => {
    let cancelled = false;
    const loadProject = async () => {
      try {
        const data = await api.projects.get(projectId);
        if (cancelled) return;
        setProjectName(data.project.name);
        if (data.role) setUserRole(data.role);
      } catch (err: any) {
        if (!cancelled) { setError(err.message || 'Failed to load project'); setLoading(false); }
      }
    };
    const loadProjectFiles = async () => {
      try {
        const data = await api.projects.listFiles(projectId);
        if (cancelled) return;
        const filelist = data.files.map(f => ({ ...f, is_folder: !!f.is_folder }));
        setFiles(filelist);
        if (data.role) setUserRole(data.role);

        const mainTex = filelist.find((f: ProjectFile) => f.path === '/main.tex' && !f.is_folder);
        if (mainTex) {
          setActiveFileId(mainTex.id);
          setActiveFileName(mainTex.name);
          setActiveImageSrc(null);
          try {
            const fileData = await api.projects.getFile(projectId, mainTex.id);
            if (!cancelled) setActiveFileContent(fileData.file.content || '');
          } catch { if (!cancelled) setActiveFileContent(''); }
        } else if (filelist.length > 0) {
          const firstFile = filelist.find((f: ProjectFile) => !f.is_folder);
          if (firstFile) {
            setActiveFileId(firstFile.id);
            setActiveFileName(firstFile.name);
            setActiveImageSrc(null);
            try {
              const fileData = await api.projects.getFile(projectId, firstFile.id);
              if (!cancelled) setActiveFileContent(fileData.file.content || '');
            } catch { if (!cancelled) setActiveFileContent(''); }
          }
        }
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) { console.error('Failed to load files:', err.message); setLoading(false); }
      }
    };
    loadProject();
    loadProjectFiles();
    return () => { cancelled = true; };
  }, [projectId]);

  // File selection
  const handleFileSelect = useCallback(async (file: ProjectFile) => {
    if (file.is_folder || file.id === activeFileId) return;
    if (viewRef.current && activeFileId) {
      const content = viewRef.current.state.doc.toString();
      try { await api.projects.saveFile(projectId, activeFileId, { content }); } catch { /* continue */ }
    }
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    setActiveFileId(file.id);
    setActiveFileName(file.name);
    setActiveImageSrc(null);
    if (isImageFile(file.name)) {
      try {
        const data = await api.projects.getFile(projectId, file.id);
        const content = data.file.content || '';
        const ext = file.name.toLowerCase().split('.').pop();
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
        };
        const mime = mimeMap[ext || ''] || 'image/png';
        if (ext === 'svg' && !content.startsWith('iVBOR') && content.includes('<svg')) {
          setActiveImageSrc(`data:${mime};utf8,${encodeURIComponent(content)}`);
        } else {
          setActiveImageSrc(`data:${mime};base64,${content}`);
        }
        setActiveFileContent('');
      } catch { setActiveFileContent(''); }
      setSaveStatus('saved');
      return;
    }
    try {
      const data = await api.projects.getFile(projectId, file.id);
      setActiveFileContent(data.file.content || '');
    } catch { setActiveFileContent(''); }
    finally { setSaveStatus('saved'); }
  }, [activeFileId, projectId]);

  const handleFileCreate = useCallback(async (name: string, path: string, isFolder: boolean) => {
    try {
      const data = await api.projects.createFile(projectId, name, path, isFolder);
      await loadFiles();
      sendFileCreated(data.file);
      if (!isFolder && data.file) {
        handleFileSelect({ ...data.file, is_folder: false, created_at: '', updated_at: '' } as ProjectFile);
      }
    } catch (err: any) { alert('Failed to create file: ' + (err.message || 'Unknown error')); }
  }, [projectId, loadFiles, handleFileSelect, sendFileCreated]);

  const handleFileMove = useCallback(async (fileId: number, newPath: string) => {
    try {
      await api.projects.moveFile(projectId, fileId, newPath);
      await loadFiles();
      sendFileMoved(fileId, newPath);
    } catch (err: any) { alert('Failed to move file: ' + (err.message || 'Unknown error')); }
  }, [projectId, loadFiles, sendFileMoved]);

  const handleFileDelete = useCallback(async (file: ProjectFile) => {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      await api.projects.deleteFile(projectId, file.id);
      sendFileDeleted(file.id);
      if (file.id === activeFileId) { setActiveFileId(null); setActiveFileContent(''); setActiveFileName(''); setActiveImageSrc(null); }
      await loadFiles();
    } catch (err: any) { alert('Failed to delete file: ' + (err.message || 'Unknown error')); }
  }, [projectId, activeFileId, loadFiles, sendFileDeleted]);

  const handleFileUpload = useCallback(() => { fileInputRef.current?.click(); }, []);

  const handleFileUploadToFolder = useCallback(async (folder: string, fileList: FileList) => {
    try { await api.projects.uploadFiles(projectId, Array.from(fileList), folder); await loadFiles(); }
    catch (err: any) { alert('Upload failed: ' + (err.message || 'Unknown error')); }
  }, [projectId, loadFiles]);

  const onFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    try { await api.projects.uploadFiles(projectId, Array.from(selectedFiles), '/'); await loadFiles(); }
    catch (err: any) { alert('Upload failed: ' + (err.message || 'Unknown error')); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [projectId, loadFiles]);

  // Initialize CodeMirror
  useEffect(() => {
    if (loading || !editorRef.current) return;
    if (!activeFileId && activeFileContent === '' && files.length > 0) return;
    if (isImageFile(activeFileName)) return;

    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }

    const saveKeymap = keymap.of([{ key: 'Mod-s', run: () => { saveCallbackRef.current(); return true; } }]);

    const lintExtension = linter(async (view: EditorView): Promise<Diagnostic[]> => {
      const content = view.state.doc.toString();
      try {
        const data = await api.projects.lint(projectId, content);
        if (!data.diagnostics) return [];
        return data.diagnostics.map((d) => {
          const fromLine = view.state.doc.line(Math.max(1, d.from.line));
          const toLine = view.state.doc.line(Math.min(view.state.doc.lines, d.to.line || d.from.line));
          const from = Math.min(fromLine.from + Math.max(0, d.from.col - 1), fromLine.to);
          const to = Math.min(toLine.from + Math.max(0, (d.to?.col || d.from.col + 1) - 1), toLine.to);
          return { from: Math.min(from, to), to: Math.max(from + 1, to), severity: d.severity === 'error' ? 'error' : 'warning', message: d.message } as Diagnostic;
        });
      } catch { return []; }
    }, { delay: 1000 });

    const state = EditorState.create({
      doc: activeFileContent,
      extensions: [
        latex(), oneDark, lintGutter(), lintExtension, history(), highlightSelectionMatches(), bracketMatching(), autocompletion(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        saveKeymap,
        EditorState.readOnly.of(isReadOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setSaveStatus('unsaved');
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = setTimeout(() => { autoSaveCallbackRef.current(); }, AUTO_SAVE_DELAY);
          }
        }),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
      if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    };
  }, [loading, activeFileId, activeFileContent, projectId, isReadOnly]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (autoCompileTimerRef.current) clearTimeout(autoCompileTimerRef.current);
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{error}</p>
          <button onClick={() => navigate('/dashboard')} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const isViewingImage = activeImageSrc !== null;

  // Build collaborator avatars for the toolbar
  const collabAvatars = collaborators.filter(c => c.userId !== user?.id).slice(0, 5);
  const moreCount = collaborators.length - 1 - collabAvatars.length;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-gray-100 dark:bg-gray-900">
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilesSelected} />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => setSidebarCollapsed(prev => !prev)} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" title={sidebarCollapsed ? 'Show file explorer' : 'Hide file explorer'}>
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button onClick={() => navigate('/dashboard')} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
            <ArrowLeft className="h-4 w-4" />Back
          </button>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 flex-shrink-0 text-brand-500" />
            <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{projectName}</span>
            {activeFileName && (<><span className="text-gray-400 dark:text-gray-600">/</span><span className="truncate text-sm text-gray-500 dark:text-gray-400">{activeFileName}</span></>)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div className="mr-2 flex items-center gap-1.5 text-xs">
            {saveStatus === 'saved' && (<><Check className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">Saved</span></>)}
            {saveStatus === 'unsaved' && (<><div className="h-2 w-2 rounded-full bg-amber-400" /><span className="text-amber-600 dark:text-amber-400">Unsaved</span></>)}
            {saveStatus === 'saving' && (<><Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" /><span className="text-brand-600 dark:text-brand-400">Saving...</span></>)}
            {saveStatus === 'compiling' && (<><Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" /><span className="text-purple-600 dark:text-purple-400">Compiling...</span></>)}
          </div>

          {/* Read-only badge */}
          {isReadOnly && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <Eye className="h-3 w-3" />
              Read Only
            </span>
          )}

          {/* Collaborators */}
          {collabAvatars.length > 0 && (
            <div className="flex items-center -space-x-1.5">
              {collabAvatars.map(c => (
                <div
                  key={c.userId}
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-gray-950"
                  style={{ backgroundColor: getCollabColor(c.userId) }}
                  title={`${c.email} (${c.role})`}
                >
                  {(c.displayName || c.email).charAt(0).toUpperCase()}
                </div>
              ))}
              {moreCount > 0 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-400 text-xs font-medium text-white dark:border-gray-950">
                  +{moreCount}
                </div>
              )}
            </div>
          )}

          {/* WS connection indicator */}
          <div className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-gray-300'}`} title={wsConnected ? 'Connected' : 'Disconnected'} />

          {/* Share button */}
          <button
            onClick={() => setShowShareModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-brand-400"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>

          {/* Auto-compile toggle */}
          <button
            onClick={() => setAutoCompile(prev => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              autoCompile
                ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
            title={autoCompile ? 'Auto-compile ON' : 'Auto-compile OFF'}
          >
            <Zap className={`h-3 w-3 ${autoCompile ? 'text-purple-500' : ''}`} />
            Auto
          </button>

          {/* Draft mode toggle */}
          <button
            onClick={() => setDraftMode(prev => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              draftMode
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
            title={draftMode ? 'Draft mode ON' : 'Draft mode OFF'}
          >
            <PencilLine className={`h-3 w-3 ${draftMode ? 'text-amber-500' : ''}`} />
            Draft
          </button>

          {!isViewingImage && !isReadOnly && (
            <button onClick={handleSave} disabled={saveStatus === 'saving' || !activeFileId} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
              <Save className="h-3.5 w-3.5" />Save
            </button>
          )}
          <button onClick={handleCompile} disabled={saveStatus === 'compiling'} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
            <Play className="h-3.5 w-3.5" />Compile
          </button>
        </div>
      </div>

      {/* Compile error banner */}
      {compileError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">Compilation Error</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{compileError}</pre>
            </div>
            <button onClick={() => setCompileError(null)} className="ml-auto flex-shrink-0 text-red-400 hover:text-red-600">&times;</button>
          </div>
        </div>
      )}

      {/* Draft mode indicator */}
      {draftMode && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 dark:border-amber-800 dark:bg-amber-950">
          <PencilLine className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs text-amber-700 dark:text-amber-300">Draft mode — images skipped, faster compilation</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        </div>
      )}

      {/* Editor + Explorer + Preview split */}
      {!loading && (
        <div className="flex flex-1 overflow-hidden">
          {!sidebarCollapsed && (
            <div className="w-52 flex-shrink-0 overflow-hidden">
              <FileExplorer
                files={files}
                activeFileId={activeFileId}
                onFileSelect={handleFileSelect}
                onFileCreate={isReadOnly ? undefined : handleFileCreate}
                onFileDelete={isReadOnly ? undefined : handleFileDelete}
                onFileUpload={isReadOnly ? undefined : handleFileUpload}
                onFileMove={isReadOnly ? undefined : handleFileMove}
                onFileUploadToFolder={isReadOnly ? undefined : handleFileUploadToFolder}
                loading={filesLoading}
                readOnly={isReadOnly}
              />
            </div>
          )}

          {/* CodeMirror Editor OR Image Preview */}
          <div className="flex-1 border-r border-gray-200 dark:border-gray-800">
            {isViewingImage ? (
              <div className="flex h-full flex-col items-center justify-center bg-gray-950 p-4">
                <img src={activeImageSrc} alt={activeFileName} className="max-h-full max-w-full rounded border border-gray-700 object-contain shadow-lg" />
                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400"><ImageIcon className="h-3.5 w-3.5" />{activeFileName}</p>
              </div>
            ) : (
              <div className="h-full" ref={editorRef}>
                {!activeFileId && (
                  <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-600">
                    <FileText className="mb-2 h-10 w-10" />
                    <p className="text-sm">Select a file to edit</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PDF Preview */}
          <div className="flex w-1/2 flex-col bg-gray-50 dark:bg-gray-950">
            {pdfData ? (
              <iframe src={`data:application/pdf;base64,${pdfData}`} className="flex-1" title="PDF Preview" style={{ border: 'none' }} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                  <FileText className="h-10 w-10 text-gray-400 dark:text-gray-600" />
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No PDF preview</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {autoCompile ? 'PDF will auto-generate on save' : 'Click "Compile" to generate a PDF'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share modal */}
      {showShareModal && (
        <ShareModal projectId={projectId} projectName={projectName} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  );
}