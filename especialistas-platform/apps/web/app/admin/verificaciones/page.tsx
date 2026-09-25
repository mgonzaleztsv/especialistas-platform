'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function AdminVerificaciones() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmingDocument, setConfirmingDocument] = useState<{
    id: string;
    action: 'verify' | 'reject';
  } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
    action: 'verify' | 'reject',
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingDocument({
        id: documentId,
        action
      });
      setError('');
      return;
    }

    setConfirmingDocument(null);
    setUpdatingId(documentId);
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
    } finally {
      setUpdatingId(null);
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
                disabled={updatingId === document.id}
              >
                Aprobar
              </button>

              <button
                type="button"
                onClick={() =>
                  reviewDocument(document.id, 'reject')
                }
                disabled={updatingId === document.id}
                style={{ marginTop: '8px' }}
              >
                Rechazar
              </button>

              {confirmingDocument?.id === document.id && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '14px',
                    border: '1px solid #ddd',
                    borderRadius: '10px'
                  }}
                >
                  <p style={{ marginTop: 0 }}>
                    <strong>
                      {confirmingDocument?.action === 'verify'
                        ? 'Confirmar aprobación'
                        : 'Confirmar rechazo'}
                    </strong>
                  </p>

                  <p>
                    {confirmingDocument?.action === 'verify'
                      ? '¿Deseas aprobar este documento?'
                      : '¿Deseas rechazar este documento?'}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      if (!confirmingDocument) return;

                      reviewDocument(
                        document.id,
                        confirmingDocument.action,
                        true
                      );
                    }}
                    disabled={updatingId === document.id}
                  >
                    {updatingId === document.id
                      ? 'Procesando...'
                      : confirmingDocument?.action === 'verify'
                        ? 'Confirmar aprobación'
                        : 'Confirmar rechazo'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmingDocument(null)}
                    disabled={updatingId === document.id}
                    style={{ marginTop: '8px' }}
                  >
                    Cancelar
                  </button>
                </div>
              )}
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
