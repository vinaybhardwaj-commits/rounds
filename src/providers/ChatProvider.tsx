'use client';

// ============================================
// Rounds — ChatProvider
// Initializes GetStream client on the frontend.
// Wraps the app to provide chat context.
// ============================================

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { StreamChat } from 'stream-chat';

// --- Types ---

interface ChatContextValue {
  /** The GetStream client instance (null until connected) */
  client: StreamChat | null;
  /** Whether the client is currently connecting */
  connecting: boolean;
  /** Connection error message, if any */
  error: string | null;
  /** Refresh the stream token (e.g., after token expiry) */
  refreshToken: () => Promise<void>;
  /** Disconnect and clean up */
  disconnect: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue>({
  client: null,
  connecting: false,
  error: null,
  refreshToken: async () => {},
  disconnect: async () => {},
});

export function useChatContext() {
  return useContext(ChatContext);
}

// --- Provider ---

interface ChatProviderProps {
  children: React.ReactNode;
  /** User ID from our auth system (profile.id) */
  userId: string;
  /** Initial stream token from login response */
  initialStreamToken?: string | null;
}

export function ChatProvider({
  children,
  userId,
  initialStreamToken,
}: ChatProviderProps) {
  const [client, setClient] = useState<StreamChat | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<StreamChat | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GETSTREAM_API_KEY;

  // Fetch a fresh token from our API
  const fetchStreamToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/stream-token');
      if (!res.ok) return null;
      const json = await res.json();
      return json.data?.stream_token ?? null;
    } catch {
      return null;
    }
  }, []);

  // Connect to GetStream
  const connect = useCallback(
    async (token: string) => {
      if (!apiKey) {
        setError('GetStream API key not configured');
        return;
      }

      setConnecting(true);
      setError(null);

      try {
        const chatClient = StreamChat.getInstance(apiKey);
        await chatClient.connectUser({ id: userId }, token);
        clientRef.current = chatClient;
        setClient(chatClient);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to connect to chat';
        setError(msg);
        console.error('GetStream connect error:', err);
      } finally {
        setConnecting(false);
      }
    },
    [apiKey, userId]
  );

  // Refresh token and reconnect
  const refreshToken = useCallback(async () => {
    const token = await fetchStreamToken();
    if (token) {
      // Disconnect existing connection first
      if (clientRef.current) {
        await clientRef.current.disconnectUser();
      }
      await connect(token);
    } else {
      setError('Failed to refresh chat token');
    }
  }, [fetchStreamToken, connect]);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.disconnectUser();
      clientRef.current = null;
      setClient(null);
    }
  }, []);

  // Initial connection on mount
  useEffect(() => {
    if (!userId || !apiKey) return;

    const init = async () => {
      // Use the initial token from login if available, otherwise fetch one
      const token = initialStreamToken || (await fetchStreamToken());
      if (token) {
        await connect(token);
      } else {
        setError('No stream token available. Please log in again.');
      }
    };

    init();

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnectUser().catch(console.error);
        clientRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, apiKey]);

  return (
    <ChatContext.Provider
      value={{ client, connecting, error, refreshToken, disconnect }}
    >
      {children}
    </ChatContext.Provider>
  );
}
