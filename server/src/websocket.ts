import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import db from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'overleaf-clone-secret-key-change-in-prod';

interface ClientInfo {
  ws: WebSocket;
  userId: number;
  email: string;
  displayName: string | null;
  projectId: number;
  role: string;
  cursor?: { line: number; col: number };
  selection?: { fromLine: number; fromCol: number; toLine: number; toCol: number };
}

// Map of projectId -> Set of connected clients
const projectRooms = new Map<number, Set<ClientInfo>>();

// Map of ws -> ClientInfo
const clientMap = new WeakMap<WebSocket, ClientInfo>();

function canEdit(role: string): boolean {
  return role === 'owner' || role === 'editor';
}

function getUserInfo(userId: number): { email: string; displayName: string | null } {
  const user = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId) as any;
  return user ? { email: user.email, displayName: user.display_name } : { email: 'Unknown', displayName: null };
}

function broadcastToRoom(projectId: number, message: any, excludeWs?: WebSocket) {
  const room = projectRooms.get(projectId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function sendPresenceUpdate(projectId: number) {
  const room = projectRooms.get(projectId);
  if (!room) return;

  const users = Array.from(room).map(client => ({
    userId: client.userId,
    email: client.email,
    displayName: client.displayName,
    role: client.role,
    cursor: client.cursor,
    selection: client.selection,
  }));

  broadcastToRoom(projectId, {
    type: 'presence',
    users,
  });
}

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Parse token from query string or protocol
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const projectIdStr = url.searchParams.get('projectId');

    if (!token || !projectIdStr) {
      ws.close(4001, 'Missing token or projectId');
      return;
    }

    let decoded: { id: number; email: string };
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    const projectId = Number(projectIdStr);
    const userId = decoded.id;

    // Verify user has access to this project
    const membership = db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(projectId, userId) as { role: string } | undefined;

    if (!membership) {
      ws.close(4003, 'No access to this project');
      return;
    }

    const userInfo = getUserInfo(userId);
    const clientInfo: ClientInfo = {
      ws,
      userId,
      email: userInfo.email,
      displayName: userInfo.displayName,
      projectId,
      role: membership.role,
    };

    clientMap.set(ws, clientInfo);

    // Add to project room
    if (!projectRooms.has(projectId)) {
      projectRooms.set(projectId, new Set());
    }
    projectRooms.get(projectId)!.add(clientInfo);

    // Send initial state: connected user list
    const roomUsers = Array.from(projectRooms.get(projectId)!).map(c => ({
      userId: c.userId,
      email: c.email,
      displayName: c.displayName,
      role: c.role,
      cursor: c.cursor,
      selection: c.selection,
    }));

    ws.send(JSON.stringify({
      type: 'connected',
      users: roomUsers,
      yourRole: membership.role,
    }));

    // Notify others in the room
    broadcastToRoom(projectId, {
      type: 'user_joined',
      user: {
        userId: clientInfo.userId,
        email: clientInfo.email,
        displayName: clientInfo.displayName,
        role: clientInfo.role,
      },
    }, ws);

    // Handle messages
    ws.on('message', (raw: Buffer) => {
      let message: any;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const client = clientMap.get(ws);
      if (!client) return;

      switch (message.type) {
        // ─── Document editing (OT-based) ────────────────────────
        case 'edit': {
          if (!canEdit(client.role)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Read-only access' }));
            return;
          }

          // Broadcast delta to all other users in the project
          broadcastToRoom(client.projectId, {
            type: 'edit',
            fileId: message.fileId,
            userId: client.userId,
            version: message.version,
            delta: message.delta,
          }, ws);

          // Acknowledge the edit
          ws.send(JSON.stringify({ type: 'edit_ack', version: message.version }));
          break;
        }

        // ─── Cursor position broadcast ─────────────────────────
        case 'cursor': {
          client.cursor = message.cursor;
          client.selection = message.selection || null;
          broadcastToRoom(client.projectId, {
            type: 'cursor',
            userId: client.userId,
            fileId: message.fileId,
            cursor: message.cursor,
            selection: message.selection,
          }, ws);
          break;
        }

        // ─── File operations (broadcast for real-time sync) ─────
        case 'file_created': {
          broadcastToRoom(client.projectId, {
            type: 'file_created',
            file: message.file,
            userId: client.userId,
          }, ws);
          break;
        }

        case 'file_deleted': {
          broadcastToRoom(client.projectId, {
            type: 'file_deleted',
            fileId: message.fileId,
            userId: client.userId,
          }, ws);
          break;
        }

        case 'file_moved': {
          broadcastToRoom(client.projectId, {
            type: 'file_moved',
            fileId: message.fileId,
            newPath: message.newPath,
            userId: client.userId,
          }, ws);
          break;
        }

        case 'file_saved': {
          broadcastToRoom(client.projectId, {
            type: 'file_saved',
            fileId: message.fileId,
            userId: client.userId,
          }, ws);
          break;
        }

        // ─── Chat / awareness messages ──────────────────────────
        case 'awareness': {
          broadcastToRoom(client.projectId, {
            type: 'awareness',
            userId: client.userId,
            action: message.action, // e.g. 'selecting', 'typing'
            fileId: message.fileId,
          }, ws);
          break;
        }
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      const client = clientMap.get(ws);
      if (client) {
        const room = projectRooms.get(client.projectId);
        if (room) {
          room.delete(client);
          if (room.size === 0) {
            projectRooms.delete(client.projectId);
          }
        }

        // Notify others
        broadcastToRoom(client.projectId, {
          type: 'user_left',
          userId: client.userId,
          email: client.email,
        });

        clientMap.delete(ws);
      }
    });

    // Handle errors
    ws.on('error', () => {
      const client = clientMap.get(ws);
      if (client) {
        const room = projectRooms.get(client.projectId);
        if (room) {
          room.delete(client);
          if (room.size === 0) {
            projectRooms.delete(client.projectId);
          }
        }
        clientMap.delete(ws);
      }
    });
  });
}