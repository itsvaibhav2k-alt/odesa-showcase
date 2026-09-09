'use client';

import { useCallback, useEffect, useRef, useState, use } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AgentInfo {
  name: string;
}

export default function EmbedChatPage({
  params,
}: {
  params: Promise<{ apiKey: string }>;
}) {
  const { apiKey } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Set agent info on mount
  useEffect(() => {
    setAgentInfo({ name: 'AI Assistant' });
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/embeds/${apiKey}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Something went wrong');
        setLoading(false);
        return;
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        setError('Failed to read response');
        setLoading(false);
        return;
      }

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            // Handle conversation ID from wrapper
            if (data.type === 'conversation' && data.conversationId) {
              setConversationId(data.conversationId);
            }
            // Handle text chunks from chat engine
            else if (data.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + data.text }
                    : m,
                ),
              );
            }
            // Handle done event from wrapper
            else if (data.type === 'done') {
              // Stream complete
            }
            // Handle error
            else if (data.type === 'error') {
              setError(data.error);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch {
      setError('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, apiKey, conversationId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  if (error && messages.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.errorState}>
          <div style={styles.errorIcon}>!</div>
          <p style={styles.errorText}>{error}</p>
        </div>
        <div style={styles.powered}>Powered by Odesa</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerDot} />
        <span style={styles.headerTitle}>
          {agentInfo?.name ?? 'Chat'}
        </span>
      </div>

      {/* Messages */}
      <div style={styles.messagesContainer}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>Hi there!</p>
            <p style={styles.emptySubtitle}>
              Send a message to get started.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.messageBubbleWrapper,
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                ...styles.messageBubble,
                ...(msg.role === 'user'
                  ? styles.userBubble
                  : styles.assistantBubble),
              }}
            >
              {msg.content || (
                <span style={styles.typingDots}>
                  <span style={styles.dot} />
                  <span style={{ ...styles.dot, animationDelay: '0.2s' }} />
                  <span style={{ ...styles.dot, animationDelay: '0.4s' }} />
                </span>
              )}
            </div>
          </div>
        ))}
        {error && messages.length > 0 && (
          <div style={styles.inlineError}>{error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={styles.composer}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          style={styles.textarea}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            ...styles.sendBtn,
            opacity: loading || !input.trim() ? 0.4 : 1,
          }}
          aria-label="Send message"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>

      {/* Powered by */}
      <div style={styles.powered}>Powered by Odesa</div>

      {/* Inline keyframe animation for typing dots */}
      <style>{`
        @keyframes odesa-dot-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .odesa-typing-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #9ca3af;
          animation: odesa-dot-pulse 1.4s infinite;
          margin: 0 2px;
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100%',
    background: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    color: '#171717',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '16px 20px',
    borderBottom: '1px solid #f0f0f0',
    background: '#fafafa',
    flexShrink: 0,
  },
  headerDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#22c55e',
    flexShrink: 0,
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: '15px',
    color: '#171717',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    textAlign: 'center',
    padding: '40px 20px',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#171717',
    margin: 0,
  },
  emptySubtitle: {
    fontSize: '14px',
    color: '#737373',
    marginTop: '4px',
  },
  messageBubbleWrapper: {
    display: 'flex',
    width: '100%',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: '10px 14px',
    borderRadius: '16px',
    lineHeight: '1.5',
    fontSize: '14px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  userBubble: {
    background: '#171717',
    color: '#ffffff',
    borderBottomRightRadius: '4px',
  },
  assistantBubble: {
    background: '#f4f4f5',
    color: '#171717',
    borderBottomLeftRadius: '4px',
  },
  typingDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '4px 0',
  },
  dot: {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#9ca3af',
    animation: 'odesa-dot-pulse 1.4s infinite',
  },
  inlineError: {
    textAlign: 'center' as const,
    color: '#dc2626',
    fontSize: '13px',
    padding: '8px',
  },
  composer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #f0f0f0',
    background: '#ffffff',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    resize: 'none' as const,
    border: '1px solid #e5e5e5',
    borderRadius: '12px',
    padding: '10px 14px',
    fontSize: '14px',
    lineHeight: '1.5',
    outline: 'none',
    fontFamily: 'inherit',
    maxHeight: '120px',
    background: '#fafafa',
    color: '#171717',
  },
  sendBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: 'none',
    background: '#171717',
    color: '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity 0.15s ease',
    padding: 0,
  },
  powered: {
    textAlign: 'center' as const,
    padding: '8px',
    fontSize: '11px',
    color: '#a3a3a3',
    background: '#ffffff',
    flexShrink: 0,
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '40px',
    textAlign: 'center' as const,
  },
  errorIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: '#fef2f2',
    color: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  errorText: {
    color: '#737373',
    fontSize: '14px',
    margin: 0,
  },
};
