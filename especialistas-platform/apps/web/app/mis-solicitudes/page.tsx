'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisSolicitudes() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, any[]>>({});
  const [loadingProposals, setLoadingProposals] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: string; comment: string }>>({});
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    title: '',
    description: '',
    budgetMin: '',
    budgetMax: '',
    city: '',
    state: '',
    zipcode: '',
    desiredDate: ''
  });

  useEffect(() => {
    api('/job-requests/me')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  async function loadProposals(jobId: string) {
    if (openJobId === jobId) {
      setOpenJobId(null);
      return;
    }

    setError('');
    setOpenJobId(jobId);

    if (proposals[jobId]) {
      return;
    }

    setLoadingProposals(jobId);

    try {
      const data = await api(`/job-requests/${jobId}/proposals`);

      setProposals((prev) => ({
        ...prev,
        [jobId]: data
      }));
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar las propuestas.');
    } finally {
      setLoadingProposals(null);
    }
  }

  async function rejectProposal(jobId: string, proposalId: string) {
    const confirmed = window.confirm(
      '¿Seguro que quieres rechazar esta propuesta?'
    );

    if (!confirmed) return;

    setError('');

    try {
      await api(`/job-requests/${jobId}/proposals/${proposalId}/reject`, {
        method: 'PATCH'
      });

      await loadProposals(jobId);
    } catch (e: any) {
      setError(e.message || 'No se pudo rechazar la propuesta.');
    }
  }

  async function acceptProposal(jobId: string, proposalId: string) {
    setError('');

    try {
      await api(`/job-requests/${jobId}/proposals/${proposalId}/accept`, {
        method: 'POST'
      });

      const updated = await api(`/job-requests/${jobId}/proposals`);

      setProposals((prev) => ({
        ...prev,
        [jobId]: updated
      }));

      setItems((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? { ...job, status: 'ASSIGNED' }
            : job
        )
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la propuesta.');
    }
  }


  async function submitReview(jobId: string) {
    const draft = reviewDrafts[jobId] || { rating: '', comment: '' };
    const rating = Number(draft.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setError('Selecciona una calificación entre 1 y 5.');
      return;
    }

    setSubmittingReview(jobId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          comment: draft.comment
        })
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la calificación.');
    } finally {
      setSubmittingReview(null);
    }
  }


  function startEditJob(job: any) {
    setEditingJobId(job.id);
    setEditDraft({
      title: job.title || '',
      description: job.description || '',
      budgetMin: job.budgetMin != null ? String(job.budgetMin) : '',
      budgetMax: job.budgetMax != null ? String(job.budgetMax) : '',
      city: job.city || '',
      state: job.state || '',
      zipcode: job.zipcode || '',
      desiredDate: job.desiredDate
        ? String(job.desiredDate).slice(0, 10)
        : ''
    });
    setError('');
  }

  function cancelEditJob() {
    setEditingJobId(null);
  }

  async function saveEditJob(jobId: string) {
    if (!editDraft.title.trim() || !editDraft.description.trim()) {
      setError('El título y la descripción son obligatorios.');
      return;
    }

    setError('');

    try {
      await api(`/job-requests/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editDraft.title,
          description: editDraft.description,
          budgetMin: editDraft.budgetMin,
          budgetMax: editDraft.budgetMax,
          city: editDraft.city,
          state: editDraft.state,
          zipcode: editDraft.zipcode,
          desiredDate: editDraft.desiredDate || null
        })
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
      setEditingJobId(null);
    } catch (e: any) {
      setError(e.message || 'No se pudo actualizar la solicitud.');
    }
  }

  async function cancelJob(jobId: string) {
    const confirmed = window.confirm(
      '¿Seguro que quieres cancelar esta solicitud?'
    );

    if (!confirmed) return;

    setError('');

    try {
      await api(`/job-requests/${jobId}/cancel`, {
        method: 'PATCH'
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
    } catch (e: any) {
      setError(e.message || 'No se pudo cancelar la solicitud.');
    }
  }

  return (
    <main className="wrap">
      <h1>Mis solicitudes</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div className="grid">
        {items.map((job) => (
          <div className="card" key={job.id}>
            <h3>{job.title}</h3>

            <p>{job.description}</p>

            <p>
              <strong>Categoría:</strong> {job.category?.name}
            </p>

            <p>
              <strong>Presupuesto:</strong>{' '}
              {job.budgetMin || job.budgetMax
                ? `$${job.budgetMin ?? 0} - $${job.budgetMax ?? 0}`
                : 'No especificado'}
            </p>

            <p>
              <strong>Ubicación:</strong>{' '}
              {[job.city, job.state, job.zipcode]
                .filter(Boolean)
                .join(', ')}
            </p>

            <p>
              <strong>Estado:</strong>{' '}
              {job.status === 'ASSIGNED'
                ? 'Asignado'
                : job.status === 'IN_PROGRESS'
                  ? 'En progreso'
                  : job.status === 'COMPLETED'
                    ? 'Completado'
                    : job.status === 'CANCELLED'
                      ? 'Cancelado'
                      : job.status}
            </p>

            {job.proposals?.[0]?.specialist?.user?.name && (
              <>
                <p>
                  <strong>Especialista contratado:</strong>{' '}
                  {job.proposals[0].specialist.user.name}
                </p>

                <p>
                  <strong>Teléfono:</strong>{' '}
                  {job.proposals[0].specialist.user.phone || 'No disponible'}
                </p>

                <p>
                  <strong>Correo:</strong>{' '}
                  {job.proposals[0].specialist.user.email || 'No disponible'}
                </p>

                <p>
                  <strong>Precio acordado:</strong> $
                  {Number(job.proposals[0].amount).toFixed(2)}
                </p>
              </>
            )}

            {job.desiredDate && (
              <p>
                <strong>Fecha deseada:</strong>{' '}
                {new Date(
                    `${String(job.desiredDate).slice(0, 10)}T12:00:00`
                  ).toLocaleDateString()}
              </p>
            )}

            {job.status === 'COMPLETED' && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                {job.review ? (
                  <>
                    <p>
                      <strong>Tu calificación:</strong> {job.review.rating} / 5
                    </p>

                    {job.review.comment && (
                      <p>
                        <strong>Tu comentario:</strong> {job.review.comment}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h4>Califica al especialista</h4>

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
                      onClick={() => submitReview(job.id)}
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

            {['DRAFT', 'PUBLISHED', 'RECEIVING_QUOTES'].includes(job.status) && (
              <>
              {editingJobId === job.id ? (
                <div style={{ marginBottom: '12px' }}>
                  <h4>Editar solicitud</h4>

                  <label>Título</label>
                  <input
                    value={editDraft.title}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, title: e.target.value }))
                    }
                  />

                  <label>Descripción</label>
                  <textarea
                    value={editDraft.description}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, description: e.target.value }))
                    }
                  />

                  <label>Presupuesto mínimo</label>
                  <input
                    type="number"
                    min="0"
                    value={editDraft.budgetMin}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, budgetMin: e.target.value }))
                    }
                  />

                  <label>Presupuesto máximo</label>
                  <input
                    type="number"
                    min="0"
                    value={editDraft.budgetMax}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, budgetMax: e.target.value }))
                    }
                  />

                  <label>Ciudad</label>
                  <input
                    value={editDraft.city}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, city: e.target.value }))
                    }
                  />

                  <label>Estado</label>
                  <input
                    value={editDraft.state}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, state: e.target.value }))
                    }
                  />

                  <label>Código postal</label>
                  <input
                    value={editDraft.zipcode}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, zipcode: e.target.value }))
                    }
                  />

                  <label>Fecha deseada</label>
                  <input
                    type="date"
                    value={editDraft.desiredDate}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, desiredDate: e.target.value }))
                    }
                  />

                  <button type="button" onClick={() => saveEditJob(job.id)}>
                    Guardar cambios
                  </button>

                  <button type="button" onClick={cancelEditJob} style={{ marginTop: '8px' }}>
                    Cancelar edición
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEditJob(job)}
                  style={{ marginBottom: '8px' }}
                >
                  Editar solicitud
                </button>
              )}

              <button
                type="button"
                onClick={() => cancelJob(job.id)}
                style={{ marginBottom: '8px' }}
              >
                Cancelar solicitud
              </button>
              </>
            )}

            <button
              type="button"
              onClick={() => loadProposals(job.id)}
            >
              {openJobId === job.id
                ? 'Ocultar propuestas'
                : 'Ver propuestas'}
            </button>

            {openJobId === job.id && (
              <div style={{ marginTop: '16px' }}>
                <h4>Propuestas recibidas</h4>

                {loadingProposals === job.id && (
                  <p>Cargando propuestas...</p>
                )}

                {!loadingProposals &&
                  proposals[job.id]?.length === 0 && (
                    <p>Aún no has recibido propuestas.</p>
                  )}

                {proposals[job.id]?.map((proposal) => (
                  <div
                    key={proposal.id}
                    style={{
                      borderTop: '1px solid #ddd',
                      paddingTop: '12px',
                      marginTop: '12px'
                    }}
                  >
                    <p>
                      <strong>Especialista:</strong>{' '}
                      {proposal.specialist?.user?.name}
                    </p>

                    <p>
                      <strong>Precio ofrecido:</strong>{' '}
                      ${Number(proposal.amount).toFixed(2)}
                    </p>

                    {proposal.message && (
                      <p>
                        <strong>Mensaje:</strong>{' '}
                        {proposal.message}
                      </p>
                    )}

                    {proposal.availableDate && (
                      <p>
                        <strong>Fecha disponible:</strong>{' '}
                        {new Date(
                          proposal.availableDate
                        ).toLocaleDateString()}
                      </p>
                    )}

                    <p>
                      <strong>Estado:</strong>{' '}
                      {proposal.status}
                    </p>

                    {proposal.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            acceptProposal(job.id, proposal.id)
                          }
                        >
                          Aceptar propuesta
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            rejectProposal(job.id, proposal.id)
                          }
                          style={{ marginTop: '8px' }}
                        >
                          Rechazar propuesta
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {!items.length && !error && (
          <div className="card">
            Todavía no has publicado solicitudes.
          </div>
        )}
      </div>

      <p>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
