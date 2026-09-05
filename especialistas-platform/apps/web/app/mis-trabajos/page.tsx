'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisTrabajos() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: string; comment: string }>>({});
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [openChatJobId, setOpenChatJobId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, any[]>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [loadingChat, setLoadingChat] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState<string | null>(null);

  function cargarTrabajos() {
    setLoading(true);
    setError('');

    api('/job-requests/specialist/my-jobs')
      .then(setItems)
      .catch((e) =>
        setError(e.message || 'No se pudieron cargar tus trabajos.')
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    cargarTrabajos();
  }, []);

  async function iniciarTrabajo(jobId: string) {
    setUpdatingId(jobId);
    setError('');

    try {
      await api(`/job-requests/specialist/my-jobs/${jobId}/start`, {
        method: 'PATCH'
      });

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo iniciar el trabajo.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function completarTrabajo(jobId: string) {
    setUpdatingId(jobId);
    setError('');

    try {
      await api(`/job-requests/specialist/my-jobs/${jobId}/complete`, {
        method: 'PATCH'
      });

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo completar el trabajo.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function toggleChat(jobId: string) {
    if (openChatJobId === jobId) {
      setOpenChatJobId(null);
      return;
    }

    setOpenChatJobId(jobId);
    setError('');
    setLoadingChat(jobId);

    try {
      const data = await api(`/job-requests/${jobId}/messages`);

      setChatMessages((prev) => ({
        ...prev,
        [jobId]: data
      }));
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar la conversación.');
    } finally {
      setLoadingChat(null);
    }
  }

  async function sendChatMessage(jobId: string) {
    const body = (chatDrafts[jobId] || '').trim();

    if (!body) return;

    setError('');
    setSendingChat(jobId);

    try {
      const message = await api(`/job-requests/${jobId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });

      setChatMessages((prev) => ({
        ...prev,
        [jobId]: [...(prev[jobId] || []), message]
      }));

      setChatDrafts((prev) => ({
        ...prev,
        [jobId]: ''
      }));
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar el mensaje.');
    } finally {
      setSendingChat(null);
    }
  }

  async function calificarCliente(jobId: string) {
    const draft = reviewDrafts[jobId] || { rating: '', comment: '' };
    const rating = Number(draft.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setError('Selecciona una calificación entre 1 y 5.');
      return;
    }

    setSubmittingReview(jobId);
    setError('');

    try {
      await api(`/job-requests/specialist/my-jobs/${jobId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          comment: draft.comment
        })
      });

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la calificación.');
    } finally {
      setSubmittingReview(null);
    }
  }

  function estado(status: string) {
    if (status === 'ASSIGNED') return 'Asignado';
    if (status === 'IN_PROGRESS') return 'En progreso';
    if (status === 'COMPLETED') return 'Completado';
    return status;
  }

  return (
    <main>
      <h1>Mis trabajos</h1>

      {loading && <p>Cargando trabajos...</p>}

      {error && <p>{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="card">
          <p>Aún no tienes trabajos asignados.</p>
        </div>
      )}

      {!loading &&
        items.map((job) => {
          const proposal = job.proposals?.[0];

          return (
            <div className="card" key={job.id}>
              <h2>{job.title}</h2>

              <p>
                <strong>Estado:</strong> {estado(job.status)}
              </p>

              <p>
                <strong>Categoría:</strong>{' '}
                {job.category?.name || 'Sin categoría'}
              </p>

              <p>{job.description}</p>

              {(job.city || job.state) && (
                <p>
                  <strong>Ubicación:</strong>{' '}
                  {[job.city, job.state].filter(Boolean).join(', ')}
                </p>
              )}

              {job.client?.user && (
                <div style={{ marginTop: '12px' }}>
                  <p>
                    <strong>Cliente:</strong> {job.client.user.name}
                  </p>

                  <p>
                    <strong>Teléfono:</strong>{' '}
                    {job.client.user.phone || 'No disponible'}
                  </p>

                  <p>
                    <strong>Correo:</strong>{' '}
                    {job.client.user.email || 'No disponible'}
                  </p>
                </div>
              )}

              {proposal && (
                <>
                  <p>
                    <strong>Precio acordado:</strong> $
                    {Number(proposal.amount).toFixed(2)}
                  </p>

                  {proposal.message && (
                    <p>
                      <strong>Mensaje de tu propuesta:</strong>{' '}
                      {proposal.message}
                    </p>
                  )}
                </>
              )}

              {proposal && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    onClick={() => toggleChat(job.id)}
                  >
                    {openChatJobId === job.id
                      ? 'Cerrar conversación'
                      : 'Abrir conversación'}
                  </button>

                  {openChatJobId === job.id && (
                    <div style={{ marginTop: '12px' }}>
                      {loadingChat === job.id ? (
                        <p>Cargando conversación...</p>
                      ) : (
                        <>
                          <div
                            style={{
                              border: '1px solid #ddd',
                              borderRadius: '8px',
                              padding: '12px',
                              marginBottom: '12px'
                            }}
                          >
                            {(chatMessages[job.id] || []).length === 0 ? (
                              <p>Aún no hay mensajes.</p>
                            ) : (
                              (chatMessages[job.id] || []).map(
                                (message: any) => (
                                  <div
                                    key={message.id}
                                    style={{ marginBottom: '12px' }}
                                  >
                                    <strong>
                                      {message.sender?.name || 'Usuario'}:
                                    </strong>{' '}
                                    {message.body}

                                    <div>
                                      <small>
                                        {new Date(
                                          message.createdAt
                                        ).toLocaleString()}
                                      </small>
                                    </div>
                                  </div>
                                )
                              )
                            )}
                          </div>

                          <textarea
                            value={chatDrafts[job.id] || ''}
                            onChange={(e) =>
                              setChatDrafts((prev) => ({
                                ...prev,
                                [job.id]: e.target.value
                              }))
                            }
                            placeholder="Escribe un mensaje..."
                            maxLength={2000}
                          />

                          <button
                            type="button"
                            onClick={() => sendChatMessage(job.id)}
                            disabled={
                              sendingChat === job.id ||
                              !(chatDrafts[job.id] || '').trim()
                            }
                            style={{ marginTop: '8px' }}
                          >
                            {sendingChat === job.id
                              ? 'Enviando...'
                              : 'Enviar mensaje'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {job.status === 'ASSIGNED' && (
                <button
                  type="button"
                  onClick={() => iniciarTrabajo(job.id)}
                  disabled={updatingId === job.id}
                >
                  {updatingId === job.id
                    ? 'Iniciando...'
                    : 'Iniciar trabajo'}
                </button>
              )}

              {job.status === 'IN_PROGRESS' && (
                <button
                  type="button"
                  onClick={() => completarTrabajo(job.id)}
                  disabled={updatingId === job.id}
                >
                  {updatingId === job.id
                    ? 'Completando...'
                    : 'Completar trabajo'}
                </button>
              )}

              {job.status === 'COMPLETED' && (
                <div style={{ marginTop: '16px' }}>
                  {job.specialistReview ? (
                    <>
                      <p>
                        <strong>Tu calificación al cliente:</strong>{' '}
                        {job.specialistReview.rating} / 5
                      </p>

                      {job.specialistReview.comment && (
                        <p>
                          <strong>Tu comentario:</strong>{' '}
                          {job.specialistReview.comment}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h4>Califica al cliente</h4>

                      <label>
                        Calificación
                        <select
                          value={reviewDrafts[job.id]?.rating || ''}
                          onChange={(e) =>
                            setReviewDrafts((prev) => ({
                              ...prev,
                              [job.id]: {
                                rating: e.target.value,
                                comment: prev[job.id]?.comment || ''
                              }
                            }))
                          }
                        >
                          <option value="">Selecciona</option>
                          <option value="5">5 - Excelente</option>
                          <option value="4">4 - Muy bueno</option>
                          <option value="3">3 - Bueno</option>
                          <option value="2">2 - Regular</option>
                          <option value="1">1 - Malo</option>
                        </select>
                      </label>

                      <div style={{ marginTop: '8px' }}>
                        <label>
                          Comentario opcional
                          <textarea
                            value={reviewDrafts[job.id]?.comment || ''}
                            onChange={(e) =>
                              setReviewDrafts((prev) => ({
                                ...prev,
                                [job.id]: {
                                  rating: prev[job.id]?.rating || '',
                                  comment: e.target.value
                                }
                              }))
                            }
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => calificarCliente(job.id)}
                        disabled={submittingReview === job.id}
                        style={{ marginTop: '8px' }}
                      >
                        {submittingReview === job.id
                          ? 'Enviando...'
                          : 'Enviar calificación'}
                      </button>
                    </>
                  )}
                </div>
              )}

            </div>
          );
        })}

      <p>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
