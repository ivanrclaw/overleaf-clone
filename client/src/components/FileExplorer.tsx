import { useState, useRef, useCallback } from 'react';
import { ProjectFile } from '@/types';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Upload, Trash2, FilePlus, FolderPlus, ImageIcon } from 'lucide-react';

interface FileExplorerProps {
  files: ProjectFile[];
  activeFileId: number | null;
  onFileSelect: (file: ProjectFile) => void;
  onFileCreate: (name: string, path: string, isFolder: boolean) => void;
  onFileDelete: (file: ProjectFile) => void;
  onFileUpload: () => void;
  onFileMove: (fileId: number, newPath: string) => void;
  onFileUploadToFolder: (folder: string, files: FileList) => void;
  onFileRename?: (file: ProjectFile, newName: string) => void;
  loading: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  file?: ProjectFile;
  children: TreeNode[];
  isFolder: boolean;
}

// Image extensions
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has('.' + ext);
}

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    let currentChildren = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += '/' + part;
      const isLast = i === parts.length - 1;
      const isFolder = !isLast || file.is_folder;

      if (!nodeMap.has(currentPath)) {
        const node: TreeNode = {
          name: part,
          path: currentPath,
          file: isLast && !file.is_folder ? file : undefined,
          isFolder,
          children: [],
        };
        nodeMap.set(currentPath, node);
        currentChildren.push(node);
      }
      currentChildren = nodeMap.get(currentPath)!.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map(node => ({ ...node, children: sortNodes(node.children) }));
  };

  return sortNodes(root);
}

export default function FileExplorer({ files, activeFileId, onFileSelect, onFileCreate, onFileDelete, onFileUpload, onFileMove, onFileUploadToFolder, loading }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/']));
  const [showNewFile, setShowNewFile] = useState<{ type: 'file' | 'folder'; parentPath: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const dragCounterRef = useRef(0);

  const tree = buildTree(files);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleCreate = () => {
    if (!showNewFile || !newItemName.trim()) return;
    const parentPath = showNewFile.parentPath === '/' ? '' : showNewFile.parentPath;
    const fullPath = parentPath + '/' + newItemName.trim();
    onFileCreate(newItemName.trim(), fullPath, showNewFile.type === 'folder');
    setShowNewFile(null);
    setNewItemName('');
  };

  // Drag & drop: moving files between folders
  const handleDragStart = useCallback((e: React.DragEvent, file: ProjectFile) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: file.id, name: file.name, path: file.path, is_folder: file.is_folder }));
    e.dataTransfer.effectAllowed = 'move';
    // Also set text/plain for external file drops to distinguish
    e.dataTransfer.setData('text/plain', `internal:${file.id}`);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Only allow drop if dragging an internal file (not external)
    const internalData = e.dataTransfer.types.includes('application/json');
    const externalFiles = e.dataTransfer.types.includes('files');
    if (internalData || externalFiles) {
      e.dataTransfer.dropEffect = internalData ? 'move' : 'copy';
      setDragOverFolder(folderPath);
      setDragOverRoot(false);
    }
  }, []);

  const handleDragOverRoot = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const internalData = e.dataTransfer.types.includes('application/json');
    const externalFiles = e.dataTransfer.types.includes('files');
    if (internalData || externalFiles) {
      e.dataTransfer.dropEffect = internalData ? 'move' : 'copy';
      setDragOverRoot(true);
      setDragOverFolder(null);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOverFolder(null);
      setDragOverRoot(false);
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    dragCounterRef.current++;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetFolderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    setDragOverRoot(false);
    dragCounterRef.current = 0;

    // Check for external file drops first (browser File objects)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const internalCheck = e.dataTransfer.getData('text/plain');
      if (!internalCheck.startsWith('internal:')) {
        // External file(s) dropped — upload to target folder
        onFileUploadToFolder(targetFolderPath === '/' ? '/' : targetFolderPath, e.dataTransfer.files);
        return;
      }
    }

    // Internal file move
    const rawData = e.dataTransfer.getData('application/json');
    if (!rawData) return;

    try {
      const dragData = JSON.parse(rawData);
      const { id, name, path: sourcePath, is_folder } = dragData;
      const newPath = targetFolderPath === '/' ? '/' + name : targetFolderPath + '/' + name;

      // Don't move to same location
      if (sourcePath === newPath) return;
      // Don't move into self (folder into itself)
      if (is_folder && (newPath === sourcePath || newPath.startsWith(sourcePath + '/'))) return;

      onFileMove(id, newPath);

      // Auto-expand the target folder
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.add(targetFolderPath);
        return next;
      });
    } catch {
      // Ignore parse errors
    }
  }, [onFileMove, onFileUploadToFolder]);

  const handleDropOnRoot = useCallback((e: React.DragEvent) => {
    handleDrop(e, '/');
  }, [handleDrop]);

  const renderNewFileInput = (depth: number) => (
    <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
      <input
        type="text"
        value={newItemName}
        onChange={e => setNewItemName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowNewFile(null); setNewItemName(''); } }}
        placeholder={showNewFile?.type === 'folder' ? 'folder name' : 'file name'}
        className="w-28 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        autoFocus
      />
      <button onClick={handleCreate} className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400">✓</button>
      <button onClick={() => { setShowNewFile(null); setNewItemName(''); }} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
    </div>
  );

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = node.file ? node.file.id === activeFileId : false;

    if (node.isFolder) {
      const isDropTarget = dragOverFolder === node.path;
      return (
        <div key={node.path}>
          <div
            className={`flex items-center rounded text-sm transition-colors ${
              isDropTarget
                ? 'bg-brand-100 ring-1 ring-brand-400 dark:bg-brand-900 dark:ring-brand-500'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onDragOver={(e) => handleDragOver(e, node.path)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.path)}
          >
            <button
              className={`flex flex-1 items-center gap-1 py-1 pr-2 ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'}`}
              onClick={() => toggleFolder(node.path)}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
              {isExpanded ? <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />}
              <span className="truncate">{node.name}</span>
            </button>
            {/* Add file/folder inside this folder */}
            <div className="flex items-center opacity-0 group-hover:opacity-100" style={{ opacity: isDropTarget ? 1 : undefined }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowNewFile({ type: 'file', parentPath: node.path }); setNewItemName(''); }}
                className="p-0.5 text-gray-400 hover:text-brand-500 dark:hover:text-brand-400"
                title="New file in folder"
              >
                <FilePlus className="h-3 w-3" />
              </button>
            </div>
          </div>
          {isExpanded && (
            <>
              {showNewFile && showNewFile.parentPath === node.path && renderNewFileInput(depth + 1)}
              {node.children.map(child => renderNode(child, depth + 1))}
            </>
          )}
        </div>
      );
    }

    // File node
    const isImage = isImageFile(node.name);
    return (
      <div
        key={node.path}
        className={`group flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable
        onDragStart={(e) => node.file && handleDragStart(e, node.file)}
      >
        <button
          className="flex flex-1 items-center gap-1 truncate"
          onClick={() => node.file && onFileSelect(node.file)}
        >
          {isImage ? (
            <ImageIcon className="h-4 w-4 flex-shrink-0 text-emerald-500" />
          ) : (
            <FileText className="h-4 w-4 flex-shrink-0 text-brand-500" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); node.file && onFileDelete(node.file); }}
          className="flex-shrink-0 text-gray-400 opacity-0 hover:text-red-500 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Files</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowNewFile({ type: 'file', parentPath: '/' }); setNewItemName(''); }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New file"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setShowNewFile({ type: 'folder', parentPath: '/' }); setNewItemName(''); }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onFileUpload}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Upload file"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        className={`flex-1 overflow-y-auto p-1 transition-colors ${
          dragOverRoot ? 'bg-brand-50 ring-1 ring-inset ring-brand-300 dark:bg-brand-950 dark:ring-brand-700' : ''
        }`}
        onDragOver={handleDragOverRoot}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnRoot}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
            No files yet
            <br />
            <span className="text-gray-300 dark:text-gray-600">Drag & drop files here</span>
          </div>
        ) : (
          <>
            {/* Root-level new file/folder input */}
            {showNewFile && showNewFile.parentPath === '/' && renderNewFileInput(0)}
            {tree.map(node => renderNode(node))}
          </>
        )}
      </div>
    </div>
  );
}