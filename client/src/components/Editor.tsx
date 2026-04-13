import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { ProjectFile } from '@/types';
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
} from 'lucide-react';

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'compiling';
const AUTO_SAVE_DELAY = 3000; // 3 seconds

// Image extensions that should be previewed instead of edited
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has('.' + ext);
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs for stable callbacks inside CodeMirror extensions
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

  // Image preview state
  const [activeImageSrc, setActiveImageSrc] = useState<string | null>(null);

  // Track the active file ID in a ref so callbacks can access current value
  const activeFileIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  // Save current active file
  const saveCurrentFile = useCallback(async (fileId: number | null, content: string) => {
    if (!fileId) return;
    setSaveStatus('saving');
    try {
      await api.projects.saveFile(projectId, fileId, { content });
      setSaveStatus('saved');
    } catch (err: any) {
      console.error('Auto-save failed:', err.message);
      setSaveStatus('unsaved');
    }
  }, [projectId]);

  // Auto-save handler — stable ref
  const handleAutoSave = useCallback(() => {
    if (!viewRef.current || !activeFileIdRef.current) return;
    const content = viewRef.current.state.doc.toString();
    saveCurrentFile(activeFileIdRef.current, content);
  }, [saveCurrentFile]);

  // Manual save handler — stable ref
  const handleSave = useCallback(async () => {
    if (!viewRef.current || !activeFileIdRef.current || saveStatus === 'saving') return;
    // Clear any pending auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const content = viewRef.current.state.doc.toString();
    await saveCurrentFile(activeFileIdRef.current, content);
  }, [saveCurrentFile, saveStatus]);

  // Keep refs updated for use inside CodeMirror extensions
  useEffect(() => {
    saveCallbackRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    autoSaveCallbackRef.current = handleAutoSave;
  }, [handleAutoSave]);

  // Compile handler
  const handleCompile = useCallback(async () => {
    if (saveStatus === 'compiling') return;
    // Save current file first
    if (viewRef.current && activeFileId) {
      const content = viewRef.current.state.doc.toString();
      try {
        await saveCurrentFile(activeFileId, content);
      } catch {
        // Continue to compile even if save fails
      }
    }
    setSaveStatus('compiling');
    setCompileError(null);
    setPdfData(null);
    try {
      const data = await api.projects.compile(projectId);
      if (data.pdf) {
        setPdfData(data.pdf);
      }
      if (data.error) {
        setCompileError(data.error);
      }
    } catch (err: any) {
      setCompileError(err.message || 'Compilation failed');
    } finally {
      setSaveStatus((prev) => prev === 'compiling' ? 'saved' : prev);
    }
  }, [projectId, saveStatus, activeFileId, saveCurrentFile]);

  // Load files list
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const data = await api.projects.listFiles(projectId);
      setFiles(data.files.map(f => ({
        ...f,
        is_folder: !!f.is_folder,
      })));
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
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load project');
          setLoading(false);
        }
      }
    };

    const loadProjectFiles = async () => {
      try {
        const data = await api.projects.listFiles(projectId);
        if (cancelled) return;
        const filelist = data.files.map(f => ({
          ...f,
          is_folder: !!f.is_folder,
        }));
        setFiles(filelist);

        // Auto-select main.tex if it exists
        const mainTex = filelist.find((f: ProjectFile) => f.path === '/main.tex' && !f.is_folder);
        if (mainTex) {
          setActiveFileId(mainTex.id);
          setActiveFileName(mainTex.name);
          setActiveImageSrc(null);
          // Load file content
          try {
            const fileData = await api.projects.getFile(projectId, mainTex.id);
            if (!cancelled) {
              setActiveFileContent(fileData.file.content || '');
            }
          } catch {
            if (!cancelled) setActiveFileContent('');
          }
        } else if (filelist.length > 0) {
          // Select first non-folder file
          const firstFile = filelist.find((f: ProjectFile) => !f.is_folder);
          if (firstFile) {
            setActiveFileId(firstFile.id);
            setActiveFileName(firstFile.name);
            setActiveImageSrc(null);
            try {
              const fileData = await api.projects.getFile(projectId, firstFile.id);
              if (!cancelled) {
                setActiveFileContent(fileData.file.content || '');
              }
            } catch {
              if (!cancelled) setActiveFileContent('');
            }
          }
        }

        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load files:', err.message);
          setLoading(false);
        }
      }
    };

    loadProject();
    loadProjectFiles();
    return () => { cancelled = true; };
  }, [projectId]);

  // Handle file selection
  const handleFileSelect = useCallback(async (file: ProjectFile) => {
    if (file.is_folder || file.id === activeFileId) return;

    // Save current file before switching
    if (viewRef.current && activeFileId) {
      const content = viewRef.current.state.doc.toString();
      try {
        await api.projects.saveFile(projectId, activeFileId, { content });
      } catch {
        // Continue switching even if save fails
      }
    }

    // Clear auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    setActiveFileId(file.id);
    setActiveFileName(file.name);
    setActiveImageSrc(null);

    // If it's an image file, load base64 content and show preview
    if (isImageFile(file.name)) {
      try {
        const data = await api.projects.getFile(projectId, file.id);
        const content = data.file.content || '';
        // Determine MIME type
        const ext = file.name.toLowerCase().split('.').pop();
        const mimeMap: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          bmp: 'image/bmp',
          webp: 'image/webp',
          svg: 'image/svg+xml',
        };
        const mime = mimeMap[ext || ''] || 'image/png';
        // Check if content is base64 (binary images) or text (SVG)
        if (ext === 'svg' && !content.startsWith('iVBOR') && content.includes('<svg')) {
          // SVG stored as text
          setActiveImageSrc(`data:${mime};utf8,${encodeURIComponent(content)}`);
        } else {
          // Binary image stored as base64
          setActiveImageSrc(`data:${mime};base64,${content}`);
        }
        setActiveFileContent(''); // No editor content for images
      } catch {
        setActiveFileContent('');
      }
      setSaveStatus('saved');
      return;
    }

    // Regular text file
    try {
      const data = await api.projects.getFile(projectId, file.id);
      setActiveFileContent(data.file.content || '');
    } catch {
      setActiveFileContent('');
    } finally {
      setSaveStatus('saved');
    }
  }, [activeFileId, projectId]);

  // Handle file creation
  const handleFileCreate = useCallback(async (name: string, path: string, isFolder: boolean) => {
    try {
      const data = await api.projects.createFile(projectId, name, path, isFolder);
      // Refresh file list
      await loadFiles();
      // If it's a file (not folder), select it
      if (!isFolder && data.file) {
        handleFileSelect({
          ...data.file,
          is_folder: false,
          created_at: '',
          updated_at: '',
        } as ProjectFile);
      }
    } catch (err: any) {
      alert('Failed to create file: ' + (err.message || 'Unknown error'));
    }
  }, [projectId, loadFiles, handleFileSelect]);

  // Handle file deletion
  const handleFileDelete = useCallback(async (file: ProjectFile) => {
    const confirmed = confirm(`Delete "${file.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.projects.deleteFile(projectId, file.id);
      // If deleting active file, clear it
      if (file.id === activeFileId) {
        setActiveFileId(null);
        setActiveFileContent('');
        setActiveFileName('');
        setActiveImageSrc(null);
      }
      await loadFiles();
    } catch (err: any) {
      alert('Failed to delete file: ' + (err.message || 'Unknown error'));
    }
  }, [projectId, activeFileId, loadFiles]);

  // Handle file upload
  const handleFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    try {
      await api.projects.uploadFiles(projectId, Array.from(selectedFiles), '/');
      await loadFiles();
    } catch (err: any) {
      alert('Upload failed: ' + (err.message || 'Unknown error'));
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [projectId, loadFiles]);

  // Initialize CodeMirror ONCE when the editor div and file content are ready.
  // Use refs for callbacks to avoid re-creating the editor on function identity changes.
  // Only re-create when the active file changes (fileId or content change from switching).
  useEffect(() => {
    if (loading || !editorRef.current) return;
    if (!activeFileId && activeFileContent === '' && files.length > 0) return;
    // Don't create editor for image files
    if (isImageFile(activeFileName)) return;

    // Destroy existing view
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          saveCallbackRef.current();
          return true;
        },
      },
    ]);

    const lintExtension = linter(async (view: EditorView): Promise<Diagnostic[]> => {
      const content = view.state.doc.toString();
      try {
        const data = await api.projects.lint(projectId, content);
        if (!data.diagnostics) return [];
        return data.diagnostics.map((d) => {
          const fromLine = view.state.doc.line(Math.max(1, d.from.line));
          const toLine = view.state.doc.line(
            Math.min(view.state.doc.lines, d.to.line || d.from.line)
          );
          const from = Math.min(
            fromLine.from + Math.max(0, d.from.col - 1),
            fromLine.to
          );
          const to = Math.min(
            toLine.from + Math.max(0, (d.to?.col || d.from.col + 1) - 1),
            toLine.to
          );
          return {
            from: Math.min(from, to),
            to: Math.max(from + 1, to),
            severity: d.severity === 'error' ? 'error' : 'warning',
            message: d.message,
          } as Diagnostic;
        });
      } catch {
        return [];
      }
    }, { delay: 1000 });

    const state = EditorState.create({
      doc: activeFileContent,
      extensions: [
        latex(),
        oneDark,
        lintGutter(),
        lintExtension,
        history(),
        highlightSelectionMatches(),
        bracketMatching(),
        autocompletion(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        saveKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setSaveStatus('unsaved');
            // Clear existing auto-save timer
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            // Set new auto-save timer
            autoSaveTimerRef.current = setTimeout(() => {
              autoSaveCallbackRef.current();
            }, AUTO_SAVE_DELAY);
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // ONLY depend on activeFileId and activeFileContent — the fileId+content pair
    // changes only when switching files. NOT on handleSave/handleAutoSave which would
    // destroy/recreate the editor on every keystroke cycle.
  }, [loading, activeFileId, activeFileContent, projectId]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isViewingImage = activeImageSrc !== null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-gray-100 dark:bg-gray-900">
      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFilesSelected}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarCollapsed(prev => !prev)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title={sidebarCollapsed ? 'Show file explorer' : 'Hide file explorer'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand-500" />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{projectName}</span>
            {activeFileName && (
              <>
                <span className="text-gray-400 dark:text-gray-600">/</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">{activeFileName}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div className="mr-2 flex items-center gap-1.5 text-xs">
            {saveStatus === 'saved' && (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
              </>
            )}
            {saveStatus === 'unsaved' && (
              <>
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-600 dark:text-amber-400">Unsaved</span>
              </>
            )}
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
                <span className="text-brand-600 dark:text-brand-400">Saving...</span>
              </>
            )}
            {saveStatus === 'compiling' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-500" />
                <span className="text-purple-600 dark:text-purple-400">Compiling...</span>
              </>
            )}
          </div>

          {!isViewingImage && (
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving' || !activeFileId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          )}
          <button
            onClick={handleCompile}
            disabled={saveStatus === 'compiling'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Compile
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
            <button
              onClick={() => setCompileError(null)}
              className="ml-auto flex-shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              &times;
            </button>
          </div>
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
          {/* File Explorer Sidebar */}
          {!sidebarCollapsed && (
            <div className="w-52 flex-shrink-0 overflow-hidden">
              <FileExplorer
                files={files}
                activeFileId={activeFileId}
                onFileSelect={handleFileSelect}
                onFileCreate={handleFileCreate}
                onFileDelete={handleFileDelete}
                onFileUpload={handleFileUpload}
                loading={filesLoading}
              />
            </div>
          )}

          {/* CodeMirror Editor OR Image Preview */}
          <div className="flex-1 border-r border-gray-200 dark:border-gray-800">
            {isViewingImage ? (
              <div className="flex h-full flex-col items-center justify-center bg-gray-950 p-4">
                <img
                  src={activeImageSrc}
                  alt={activeFileName}
                  className="max-h-full max-w-full rounded border border-gray-700 object-contain shadow-lg"
                />
                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {activeFileName}
                </p>
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
              <iframe
                src={`data:application/pdf;base64,${pdfData}`}
                className="flex-1"
                title="PDF Preview"
                style={{ border: 'none' }}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                  <FileText className="h-10 w-10 text-gray-400 dark:text-gray-600" />
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No PDF preview</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Click "Compile" to generate a PDF
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}