import { useState } from 'react';
import { ProjectFile } from '@/types';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Upload, Trash2, FilePlus, FolderPlus, ImageIcon } from 'lucide-react';

interface FileExplorerProps {
  files: ProjectFile[];
  activeFileId: number | null;
  onFileSelect: (file: ProjectFile) => void;
  onFileCreate: (name: string, path: string, isFolder: boolean) => void;
  onFileDelete: (file: ProjectFile) => void;
  onFileUpload: () => void;
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

  // Sort files by path
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

  // Sort: folders first, then by name
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map(node => ({ ...node, children: sortNodes(node.children) }));
  };

  return sortNodes(root);
}

export default function FileExplorer({ files, activeFileId, onFileSelect, onFileCreate, onFileDelete, onFileUpload, loading }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/']));
  const [showNewFile, setShowNewFile] = useState<{ type: 'file' | 'folder'; parentPath: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');

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
      return (
        <div key={node.path}>
          <button
            className={`flex w-full items-center gap-1 rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
            {isExpanded ? <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />}
            <span className="truncate">{node.name}</span>
          </button>
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
      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400 dark:text-gray-500">No files yet</div>
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