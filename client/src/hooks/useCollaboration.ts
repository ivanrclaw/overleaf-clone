import { useEffect, useRef, useCallback, useState } from 'react';

export interface CollaboratorInfo {
  userId: number;
  email: string;
  displayName: string | null;
  role: string;
  cursor?: { line: number; col: number };
  selection?: { fromLine: number; fromCol: number; toLine: number; toCol: number };
}

interface UseWebSocketOptions {
  projectId: number | null;
  token: string | null;
  onEdit?: (data: { fileId: number; userId: number; version: number; delta: any }) => void;
  onCursor?: (data: { userId: number; fileId: number; cursor: any; selection?: any }) => void;
  onUserJoined?: (user: { userId: number; email: string; displayName: string | null; role: string }) => void;
  onUserLeft?: (user: { userId: number; email: string }) => void;
  onFileCreated?: (data: { file: any; userId: number }) => void;
  onFileDeleted?: (data: { fileId: number; userId: number }) => void;
  onFileMoved?: (data: { fileId: number; newPath: string; userId: number }) => void;
  onFileSaved?: (data: { fileId: number; userId: number }) => void;
  onConnected?: (users: CollaboratorInfo[], yourRole: string) => void;
}

export function useCollaboration(options: UseWebSocketOptions) {
  const {
    projectId,
    token,
    onEdit,
    onCursor,
    onUserJoined,
    onUserLeft,
    onFileCreated,
    onFileDeleted,
    onFileMoved,
    onFileSaved,
    onConnected,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [myRole, setMyRole] = useState<string>('viewer');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for callbacks (avoid re-creating WS on callback changes)
  const onEditRef = useRef(onEdit);
  const onCursorRef = useRef(onCursor);
  const onUserJoinedRef = useRef(onUserJoined);
  const onUserLeftRef = useRef(onUserLeft);
  const onFileCreatedRef = useRef(onFileCreated);
  const onFileDeletedRef = useRef(onFileDeleted);
  const onFileMovedRef = useRef(onFileMoved);
  const onFileSavedRef = useRef(onFileSaved);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onEditRef.current = onEdit;
    onCursorRef.current = onCursor;
    onUserJoinedRef.current = onUserJoined;
    onUserLeftRef.current = onUserLeft;
    onFileCreatedRef.current = onFileCreated;
    onFileDeletedRef.current = onFileDeleted;
    onFileMovedRef.current = onFileMoved;
    onFileSavedRef.current = onFileSaved;
    onConnectedRef.current = onConnected;
  });

  const connect = useCallback(() => {
    if (!projectId || !token) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}&projectId=${projectId}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      // WebSocket not supported or connection failed; retry later
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, 5000);
      return;
    }

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'connected': {
            setCollaborators(message.users || []);
            setMyRole(message.yourRole || 'viewer');
            onConnectedRef.current?.(message.users || [], message.yourRole || 'viewer');
            break;
          }
          case 'user_joined': {
            setCollaborators(prev => {
              if (prev.some(u => u.userId === message.user.userId)) return prev;
              return [...prev, message.user];
            });
            onUserJoinedRef.current?.(message.user);
            break;
          }
          case 'user_left': {
            setCollaborators(prev => prev.filter(u => u.userId !== message.userId));
            onUserLeftRef.current?.(message);
            break;
          }
          case 'presence': {
            setCollaborators(message.users || []);
            break;
          }
          case 'edit': {
            onEditRef.current?.(message);
            break;
          }
          case 'cursor': {
            // Update collaborator cursor info
            setCollaborators(prev => prev.map(u =>
              u.userId === message.userId
                ? { ...u, cursor: message.cursor, selection: message.selection }
                : u
            ));
            onCursorRef.current?.(message);
            break;
          }
          case 'file_created': {
            onFileCreatedRef.current?.(message);
            break;
          }
          case 'file_deleted': {
            onFileDeletedRef.current?.(message);
            break;
          }
          case 'file_moved': {
            onFileMovedRef.current?.(message);
            break;
          }
          case 'file_saved': {
            onFileSavedRef.current?.(message);
            break;
          }
          case 'edit_ack': {
            // Edit acknowledged by server
            break;
          }
          case 'error': {
            console.error('WebSocket error:', message.message);
            break;
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after delay
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    wsRef.current = ws;
  }, [projectId, token]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Send edit delta
  const sendEdit = useCallback((fileId: number, version: number, delta: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'edit',
        fileId,
        version,
        delta,
      }));
    }
  }, []);

  // Send cursor position
  const sendCursor = useCallback((fileId: number, cursor: { line: number; col: number }, selection?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'cursor',
        fileId,
        cursor,
        selection,
      }));
    }
  }, []);

  // Send file operation broadcast
  const sendFileCreated = useCallback((file: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file_created',
        file,
      }));
    }
  }, []);

  const sendFileDeleted = useCallback((fileId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file_deleted',
        fileId,
      }));
    }
  }, []);

  const sendFileMoved = useCallback((fileId: number, newPath: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file_moved',
        fileId,
        newPath,
      }));
    }
  }, []);

  const sendFileSaved = useCallback((fileId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'file_saved',
        fileId,
      }));
    }
  }, []);

  const isViewer = myRole === 'viewer';

  return {
    connected,
    collaborators,
    myRole,
    isViewer,
    sendEdit,
    sendCursor,
    sendFileCreated,
    sendFileDeleted,
    sendFileMoved,
    sendFileSaved,
  };
}