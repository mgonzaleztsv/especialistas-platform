'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../lib/api';

export default function ConversacionPage() {
  const params = useParams();
  const jobId = String(params.jobId);

  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [conversationInfo, setConversationInfo] = useState<any>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  async function loadMessages(showLoading = false) {
    if (showLoading) setLoading(true);

    try {
      const data = await api(`/job-requests/${jobId}/messages`);
      setMessages(data);
      setError('');
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar la conversación.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    api('/users/me')
      .then((user) => setCurrentUserId(user.id))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) return;

    api('/job-requests/messages/conversations')
      .then((data) => {
        const conversation = data.find(
          (item: any) => item.jobRequestId === jobId
        );

        setConversationInfo(conversation || null);
      })
      .catch(() => {});
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    loadMessages(true);

    const interval = window.setInterval(
      () => loadMessages(false),
      10000
    );

    return () => window.clearInterval(interval);
  }, [jobId]);

  useEffect(() => {
    const container = messagesContainerRef.current;

    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  async function sendMessage() {
    const body = draft.trim();

    if (!body) return;

    setSending(true);
    setError('');

    try {
      const message = await api(`/job-requests/${jobId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });

      setMessages((prev) => [...prev, message]);
      setDraft('');
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="wrap">
      <p>
        <a href="/mensajes">← Volver a Mensajes</a>
      </p>

      <h1>
        {conversationInfo?.otherUser?.name
          ? `Conversación con ${conversationInfo.otherUser.name}`
          : 'Conversación'}
      </h1>

      {conversationInfo?.jobTitle && (
        <p>
          <strong>Trabajo:</strong> {conversationInfo.jobTitle}
        </p>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {loading ? (
        <p>Cargando conversación...</p>
      ) : (
        <>
          <div
            ref={messagesContainerRef}
            className="card"
            style={{
              marginBottom: '16px',
              maxHeight: '55vh',
              overflowY: 'auto'
            }}
          >
            {messages.length === 0 ? (
              <p>Aún no hay mensajes.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    justifyContent:
                      message.sender?.id === currentUserId
                        ? 'flex-end'
                        : 'flex-start',
                    marginBottom: '12px'
                  }}
                >
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      border: '1px solid #ddd',
                      borderRadius: '12px',
                      textAlign:
                        message.sender?.id === currentUserId
                          ? 'right'
                          : 'left'
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      <strong>
                        {message.sender?.id === currentUserId
                          ? 'Tú'
                          : message.sender?.name || 'Usuario'}
                      </strong>
                    </p>

                    <p style={{ margin: '6px 0' }}>
                      {message.body}
                    </p>

                    <small>
                      {new Date(message.createdAt).toLocaleString()}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                if (!sending && draft.trim()) {
                  sendMessage();
                }
              }
            }}
            placeholder="Escribe un mensaje..."
            maxLength={2000}
            style={{ width: '100%', minHeight: '100px' }}
          />

          <button
            type="button"
            onClick={sendMessage}
            disabled={sending || !draft.trim()}
            style={{ marginTop: '8px' }}
          >
            {sending ? 'Enviando...' : 'Enviar mensaje'}
          </button>
        </>
      )}
    </main>
  );
}
