import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
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
import {
  ArrowLeft,
  Save,
  Play,
  Loader2,
  Check,
  AlertCircle,
  FileText,
} from 'lucide-react';

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'compiling';

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef<string>('');

  const [projectName, setProjectName] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [loading, setLoading] = useState(true);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!viewRef.current || saveStatus === 'saving') return;
    const content = viewRef.current.state.doc.toString();
    setSaveStatus('saving');
    try {
      await api.projects.save(projectId, content);
      setSaveStatus('saved');
    } catch (err: any) {
      alert('Save failed: ' + (err.message || 'Unknown error'));
      setSaveStatus('unsaved');
    }
  }, [projectId, saveStatus]);

  // Compile handler
  const handleCompile = useCallback(async () => {
    if (saveStatus === 'compiling') return;
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
      // Check if content has changed since compile started
      setSaveStatus((prev) => prev === 'compiling' ? 'unsaved' : prev);
    }
  }, [projectId, saveStatus]);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current || !loading) return;
    // Will initialize after content loads
  }, [loading]);

  useEffect(() => {
    let cancelled = false;

    const loadProject = async () => {
      try {
        const data = await api.projects.get(projectId);
        if (cancelled) return;
        setProjectName(data.project.name);
        contentRef.current = data.project.content || '';
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load project');
          setLoading(false);
        }
      }
    };

    loadProject();
    return () => { cancelled = true; };
  }, [projectId]);

  // Initialize editor after content loads
  useEffect(() => {
    if (loading || !editorRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave();
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
      doc: contentRef.current,
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
      viewRef.current = null;
    };
  }, [loading, projectId, handleSave]);

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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-gray-100 dark:bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center gap-3">
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

          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
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

      {/* Editor + Preview split */}
      {!loading && (
        <div className="flex flex-1 overflow-hidden">
          {/* CodeMirror Editor */}
          <div className="w-1/2 border-r border-gray-200 dark:border-gray-800" ref={editorRef} />

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