'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MensajesPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function loadConversations(showLoading = false) {
    if (showLoading) setLoading(true);

    api('/job-requests/messages/conversations')
      .then((data) => {
        setConversations(data);
        setError('');
      })
      .catch((e) =>
        setError(e.message || 'No se pudieron cargar las conversaciones.')
      )
      .finally(() => {
        if (showLoading) setLoading(false);
      });
  }

  useEffect(() => {
    loadConversations(true);

    const interval = window.setInterval(
      () => loadConversations(false),
      10000
    );

    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="wrap">
      <h1>Mensajes</h1>

      {loading && <p>Cargando conversaciones...</p>}

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && conversations.length === 0 && (
        <div className="card">
          <p>Aún no tienes conversaciones.</p>
        </div>
      )}

      {!loading &&
        conversations.map((conversation) => (
          <div
            className="card"
            key={conversation.jobRequestId}
            style={{ marginBottom: '16px' }}
          >
            <h2>{conversation.jobTitle}</h2>

            <p>
              <strong>Conversación con:</strong>{' '}
              {conversation.otherUser?.name || 'Usuario'}
            </p>

            <p>
              <strong>Estado del trabajo:</strong>{' '}
              {conversation.jobStatus}
            </p>

            {conversation.lastMessage && (
              <>
                <p>
                  <strong>Último mensaje:</strong>{' '}
                  {conversation.lastMessage.body}
                </p>

                <p>
                  <small>
                    {new Date(
                      conversation.lastMessage.createdAt
                    ).toLocaleString()}
                  </small>
                </p>
              </>
            )}

            {conversation.unreadCount > 0 && (
              <p>
                <strong>
                  Mensajes nuevos: {conversation.unreadCount}
                </strong>
              </p>
            )}

            <p>
              <a href={`/mensajes/${conversation.jobRequestId}`}>
                Abrir conversación
              </a>
            </p>
          </div>
        ))}
    </main>
  );
}
