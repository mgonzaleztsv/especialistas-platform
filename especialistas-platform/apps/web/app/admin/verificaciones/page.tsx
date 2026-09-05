'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function AdminVerificaciones() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadDocuments() {
    setLoading(true);
    setError('');

    try {
      const data = await api('/specialists/admin/documents/pending');
      setDocuments(data);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar los documentos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function reviewDocument(
    documentId: string,
    action: 'verify' | 'reject'
  ) {
    const confirmed = window.confirm(
      action === 'verify'
        ? '¿Aprobar este documento?'
        : '¿Rechazar este documento?'
    );

    if (!confirmed) return;

    setError('');
    setMessage('');

    try {
      await api(
        `/specialists/admin/documents/${documentId}/${action}`,
        {
          method: 'PATCH'
        }
      );

      setDocuments((prev) =>
        prev.filter((document) => document.id !== documentId)
      );

      setMessage(
        action === 'verify'
          ? 'Documento aprobado correctamente.'
          : 'Documento rechazado correctamente.'
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo revisar el documento.');
    }
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Verificaciones pendientes</h1>

        <p>
          Revisa los documentos enviados por los especialistas antes de
          aprobar o rechazar su verificación.
        </p>

        {message && (
          <p style={{ color: 'green' }}>{message}</p>
        )}

        {error && (
          <p style={{ color: 'red' }}>{error}</p>
        )}

        {loading ? (
          <p>Cargando documentos...</p>
        ) : documents.length === 0 ? (
          <p>No hay documentos pendientes de revisión.</p>
        ) : (
          documents.map((document: any) => (
            <div
              key={document.id}
              style={{
                borderTop: '1px solid #ddd',
                paddingTop: '16px',
                marginTop: '16px'
              }}
            >
              <h3>
                {document.specialist?.user?.name || 'Especialista'}
              </h3>

              <p>
                <strong>Correo:</strong>{' '}
                {document.specialist?.user?.email || 'No disponible'}
              </p>

              <p>
                <strong>Tipo de documento:</strong>{' '}
                {document.documentType}
              </p>

              {document.expirationDate && (
                <p>
                  <strong>Vencimiento:</strong>{' '}
                  {String(document.expirationDate).slice(0, 10)}
                </p>
              )}

              <p>
                <a
                  href={document.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir documento
                </a>
              </p>

              <button
                type="button"
                onClick={() =>
                  reviewDocument(document.id, 'verify')
                }
              >
                Aprobar
              </button>

              <button
                type="button"
                onClick={() =>
                  reviewDocument(document.id, 'reject')
                }
                style={{ marginTop: '8px' }}
              >
                Rechazar
              </button>
            </div>
          ))
        )}

        <p style={{ marginTop: '24px' }}>
          <a href="/dashboard">Volver al panel</a>
        </p>
      </div>
    </main>
  );
}
