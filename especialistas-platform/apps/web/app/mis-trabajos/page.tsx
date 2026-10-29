'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisTrabajos() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingTerminationAcceptance, setConfirmingTerminationAcceptance] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: string; comment: string }>>({});
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [openChatJobId, setOpenChatJobId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, any[]>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [loadingChat, setLoadingChat] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [workOrders, setWorkOrders] = useState<Record<string, any>>({});
  const [loadingWorkOrder, setLoadingWorkOrder] = useState<string | null>(null);
  const [acceptingWorkOrder, setAcceptingWorkOrder] = useState<string | null>(null);
  const [editingWorkOrderId, setEditingWorkOrderId] = useState<string | null>(null);
  const [revisingWorkOrder, setRevisingWorkOrder] = useState<string | null>(null);
  const [workOrderDrafts, setWorkOrderDrafts] = useState<
    Record<
      string,
      {
        includedScope: string;
        excludedScope: string;
        scheduledDate: string;
        laborAmount: string;
        materialsAmount: string;
        reviewPeriodHours: string;
      }
    >
  >({});
  const [terminationDisputeJobId, setTerminationDisputeJobId] = useState<string | null>(null);
  const [terminationDisputeDrafts, setTerminationDisputeDrafts] = useState<Record<string, string>>({});
  const [damageClaimDisputeId, setDamageClaimDisputeId] = useState<string | null>(null);
  const [damageClaimDisputeDrafts, setDamageClaimDisputeDrafts] = useState<Record<string, string>>({});

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

    const loadUnreadCounts = () => {
      api('/job-requests/messages/unread-counts')
        .then(setUnreadCounts)
        .catch(() => {});
    };

    loadUnreadCounts();

    const interval = window.setInterval(loadUnreadCounts, 10000);

    return () => window.clearInterval(interval);
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

  async function loadWorkOrder(jobId: string) {
    setError('');
    setLoadingWorkOrder(jobId);

    try {
      const data = await api(`/job-requests/${jobId}/work-order`);

      setWorkOrders((prev) => ({
        ...prev,
        [jobId]: data
      }));
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar la Orden de Trabajo.');
    } finally {
      setLoadingWorkOrder(null);
    }
  }

  async function acceptWorkOrder(jobId: string) {
    setError('');
    setAcceptingWorkOrder(jobId);

    try {
      const data = await api(`/job-requests/${jobId}/work-order/accept`, {
        method: 'POST'
      });

      setWorkOrders((prev) => ({
        ...prev,
        [jobId]: data
      }));

      if (data.status === 'ACCEPTED') {
        cargarTrabajos();
      }
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la Orden de Trabajo.');
    } finally {
      setAcceptingWorkOrder(null);
    }
  }


  function startWorkOrderRevision(jobId: string) {
    const workOrder = workOrders[jobId];

    if (!workOrder) return;

    setWorkOrderDrafts((prev) => ({
      ...prev,
      [jobId]: {
        includedScope: workOrder.includedScope ?? '',
        excludedScope: workOrder.excludedScope ?? '',
        scheduledDate: workOrder.scheduledDate
          ? new Date(workOrder.scheduledDate).toISOString().slice(0, 10)
          : '',
        laborAmount: String(workOrder.laborAmount ?? ''),
        materialsAmount: String(workOrder.materialsAmount ?? ''),
        reviewPeriodHours: String(workOrder.reviewPeriodHours ?? 48)
      }
    }));

    setEditingWorkOrderId(jobId);
  }

  async function reviseWorkOrder(jobId: string) {
    const draft = workOrderDrafts[jobId];

    if (!draft) return;

    setError('');
    setRevisingWorkOrder(jobId);

    try {
      const data = await api(`/job-requests/${jobId}/work-order/revise`, {
        method: 'POST',
        body: JSON.stringify({
          includedScope: draft.includedScope,
          excludedScope: draft.excludedScope,
          scheduledDate: draft.scheduledDate || null,
          laborAmount: Number(draft.laborAmount),
          materialsAmount: Number(draft.materialsAmount),
          reviewPeriodHours: Number(draft.reviewPeriodHours)
        })
      });

      setWorkOrders((prev) => ({
        ...prev,
        [jobId]: data
      }));

      setEditingWorkOrderId(null);
    } catch (e: any) {
      setError(e.message || 'No se pudo generar la nueva versión de la Orden de Trabajo.');
    } finally {
      setRevisingWorkOrder(null);
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

      setUnreadCounts((prev) => ({
        ...prev,
        [jobId]: 0
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

  async function aceptarTerminacion(
    jobId: string,
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingTerminationAcceptance(jobId);
      setError('');
      return;
    }

    setConfirmingTerminationAcceptance(null);
    setUpdatingId(jobId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/termination-request/accept`, {
        method: 'POST'
      });

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la terminación.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function disputarTerminacion(jobId: string) {
    const reason = terminationDisputeDrafts[jobId] || '';

    if (!reason.trim()) {
      setError('Debes indicar el motivo de la disputa.');
      return;
    }

    setUpdatingId(jobId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/termination-request/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reasonDetails: reason.trim()
        })
      });

      setTerminationDisputeJobId(null);
      setTerminationDisputeDrafts((prev) => ({
        ...prev,
        [jobId]: ''
      }));

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo disputar la terminación.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function aceptarReclamacion(jobId: string, claimId: string) {
    setUpdatingId(claimId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/damage-claims/${claimId}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          responseNotes: 'Reclamación aceptada por el especialista.'
        })
      });
      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la reclamación.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function disputarReclamacion(jobId: string, claimId: string) {
    const reason = damageClaimDisputeDrafts[claimId] || '';

    if (!reason.trim()) {
      setError('Debes indicar el motivo de la disputa.');
      return;
    }

    setUpdatingId(claimId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/damage-claims/${claimId}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          responseNotes: reason.trim()
        })
      });

      setDamageClaimDisputeId(null);
      setDamageClaimDisputeDrafts((prev) => ({
        ...prev,
        [claimId]: ''
      }));

      cargarTrabajos();
    } catch (e: any) {
      setError(e.message || 'No se pudo disputar la reclamación.');
    } finally {
      setUpdatingId(null);
    }
  }

  function estado(status: string) {
    if (status === 'PENDING_AGREEMENT') return 'Pendiente de aceptación de la Orden de Trabajo';
    if (status === 'AWAITING_PAYMENT') return 'Esperando pago del cliente';
    if (status === 'ASSIGNED') return 'Asignado';
    if (status === 'IN_PROGRESS') return 'En progreso';
    if (status === 'AWAITING_CLIENT_CONFIRMATION') return 'Esperando confirmación del cliente';
    if (status === 'TERMINATION_REQUESTED') return 'Terminación solicitada';
    if (status === 'DISPUTED') return 'Terminación en disputa';
    if (status === 'COMPLETED') return 'Completado';
    if (status === 'CANCELLED') return 'Cancelado';
    return status;
  }

  function tipoReclamacion(type: string) {
    if (type === 'RESTITUTION') return 'Restitución';
    if (type === 'COMPENSATION') return 'Compensación';
    if (type === 'BOTH') return 'Restitución y compensación';
    return type;
  }

  function estadoReclamacion(status: string) {
    if (status === 'PENDING') return 'Pendiente';
    if (status === 'ACCEPTED') return 'Aceptada';
    if (status === 'DISPUTED') return 'En disputa';
    if (status === 'RESOLVED') return 'Resuelta';
    if (status === 'REJECTED') return 'Rechazada';
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

              {[
                'PENDING_AGREEMENT',
                'AWAITING_PAYMENT',
                'ASSIGNED',
                'IN_PROGRESS',
                'AWAITING_CLIENT_CONFIRMATION',
                'TERMINATION_REQUESTED',
                'DISPUTED',
                'COMPLETED',
                'CANCELLED'
              ].includes(job.status) && (
                <div
                  style={{
                    marginTop: '16px',
                    marginBottom: '16px',
                    padding: '14px',
                    border: '1px solid #ddd',
                    borderRadius: '10px'
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>Orden de Trabajo</h4>

                  {!workOrders[job.id] ? (
                    <button
                      type="button"
                      onClick={() => loadWorkOrder(job.id)}
                      disabled={loadingWorkOrder === job.id}
                    >
                      {loadingWorkOrder === job.id
                        ? 'Cargando...'
                        : 'Ver Orden de Trabajo'}
                    </button>
                  ) : (
                    <>
                      <p>
                        <strong>Versión:</strong>{' '}
                        {workOrders[job.id].version}
                      </p>

                      <p>
                        <strong>Trabajo:</strong>{' '}
                        {workOrders[job.id].title}
                      </p>

                      <p>
                        <strong>Descripción:</strong>{' '}
                        {workOrders[job.id].description}
                      </p>

                      {workOrders[job.id].includedScope && (
                        <p>
                          <strong>Alcance incluido:</strong>{' '}
                          {workOrders[job.id].includedScope}
                        </p>
                      )}

                      {workOrders[job.id].excludedScope && (
                        <p>
                          <strong>Alcance excluido:</strong>{' '}
                          {workOrders[job.id].excludedScope}
                        </p>
                      )}

                      <p>
                        <strong>Ubicación:</strong>{' '}
                        {[
                          workOrders[job.id].city,
                          workOrders[job.id].state,
                          workOrders[job.id].zipcode
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </p>

                      {workOrders[job.id].scheduledDate && (
                        <p>
                          <strong>Fecha prevista:</strong>{' '}
                          {new Date(
                            workOrders[job.id].scheduledDate
                          ).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                        </p>
                      )}

                      <p>
                        <strong>Mano de obra:</strong> $
                        {Number(
                          workOrders[job.id].laborAmount
                        ).toFixed(2)}
                      </p>

                      <p>
                        <strong>Materiales:</strong> $
                        {Number(
                          workOrders[job.id].materialsAmount
                        ).toFixed(2)}
                      </p>

                      <p>
                        <strong>Plazo de revisión:</strong>{' '}
                        {workOrders[job.id].reviewPeriodHours === 168
                          ? '7 días'
                          : workOrders[job.id].reviewPeriodHours === 48
                            ? '48 horas'
                            : 'No definido'}
                      </p>
                      <p>
                        <strong>Total:</strong> $
                        {(
                          Number(workOrders[job.id].laborAmount) +
                          Number(workOrders[job.id].materialsAmount)
                        ).toFixed(2)}
                      </p>

                      <p>
                        <strong>Aceptación del cliente:</strong>{' '}
                        {workOrders[job.id].clientAcceptedAt
                          ? 'Aceptada'
                          : 'Pendiente'}
                      </p>

                      <p>
                        <strong>Tu aceptación:</strong>{' '}
                        {workOrders[job.id].specialistAcceptedAt
                          ? 'Aceptada'
                          : 'Pendiente'}
                      </p>

                      {!workOrders[job.id].specialistAcceptedAt && (
                        <button
                          type="button"
                          onClick={() => acceptWorkOrder(job.id)}
                          disabled={acceptingWorkOrder === job.id}
                        >
                          {acceptingWorkOrder === job.id
                            ? 'Aceptando...'
                            : 'Aceptar Orden de Trabajo'}
                        </button>
                      )}

                      {job.status === 'PENDING_AGREEMENT' &&
                        workOrders[job.id].status === 'PENDING_ACCEPTANCE' && (
                          <div style={{ marginTop: '12px' }}>
                            {editingWorkOrderId !== job.id ? (
                              <button
                                type="button"
                                onClick={() => startWorkOrderRevision(job.id)}
                              >
                                Proponer cambios
                              </button>
                            ) : (
                              <div
                                style={{
                                  marginTop: '12px',
                                  padding: '12px',
                                  border: '1px solid #ddd',
                                  borderRadius: '8px'
                                }}
                              >
                                <h5 style={{ marginTop: 0 }}>
                                  Proponer nueva versión
                                </h5>

                                <div
                                  role="note"
                                  style={{
                                    padding: '12px',
                                    marginBottom: '16px',
                                    border: '1px solid #d6a83c',
                                    borderRadius: '6px',
                                    backgroundColor: '#fff8e6',
                                    color: '#453500'
                                  }}
                                >
                                  <strong>Protección de privacidad.</strong>{' '}
                                  No incluyas domicilios exactos, números
                                  de casa o departamento ni otros datos
                                  personales en los alcances de la Orden
                                  de Trabajo. La dirección del servicio
                                  se proporcionará por separado cuando
                                  se cumplan las condiciones de
                                  contratación y pago.
                                </div>

                                <label>
                                  Alcance incluido
                                  <textarea
                                    value={
                                      workOrderDrafts[job.id]?.includedScope ?? ''
                                    }
                                    onChange={(e) =>
                                      setWorkOrderDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: {
                                          ...prev[job.id],
                                          includedScope: e.target.value
                                        }
                                      }))
                                    }
                                  />
                                </label>

                                <label>
                                  Alcance excluido
                                  <textarea
                                    value={
                                      workOrderDrafts[job.id]?.excludedScope ?? ''
                                    }
                                    onChange={(e) =>
                                      setWorkOrderDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: {
                                          ...prev[job.id],
                                          excludedScope: e.target.value
                                        }
                                      }))
                                    }
                                  />
                                </label>

                                <label>
                                  Fecha prevista
                                  <input
                                    type="date"
                                    value={
                                      workOrderDrafts[job.id]?.scheduledDate ?? ''
                                    }
                                    onChange={(e) =>
                                      setWorkOrderDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: {
                                          ...prev[job.id],
                                          scheduledDate: e.target.value
                                        }
                                      }))
                                    }
                                  />
                                </label>

                                <label>
  Plazo de revisión del trabajo
  <select
    value={workOrderDrafts[job.id]?.reviewPeriodHours ?? '48'}
    onChange={(e) =>
      setWorkOrderDrafts((prev) => ({
        ...prev,
        [job.id]: {
          ...prev[job.id],
          reviewPeriodHours: e.target.value
        }
      }))
    }
  >
    <option value="48">48 horas — servicios sencillos</option>
    <option value="168">7 días — trabajos complejos</option>
  </select>
</label>

<label>
                                  Mano de obra
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={
                                      workOrderDrafts[job.id]?.laborAmount ?? ''
                                    }
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) =>
                                      setWorkOrderDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: {
                                          ...prev[job.id],
                                          laborAmount: e.target.value
                                        }
                                      }))
                                    }
                                  />
                                </label>

                                <label>
                                  Materiales
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={
                                      workOrderDrafts[job.id]?.materialsAmount ?? ''
                                    }
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) =>
                                      setWorkOrderDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: {
                                          ...prev[job.id],
                                          materialsAmount: e.target.value
                                        }
                                      }))
                                    }
                                  />
                                </label>

                                <div style={{ marginTop: '12px' }}>
                                  <button
                                    type="button"
                                    onClick={() => reviseWorkOrder(job.id)}
                                    disabled={revisingWorkOrder === job.id}
                                  >
                                    {revisingWorkOrder === job.id
                                      ? 'Generando...'
                                      : 'Generar nueva versión'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setEditingWorkOrderId(null)}
                                    disabled={revisingWorkOrder === job.id}
                                    style={{ marginLeft: '8px' }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                    </>
                  )}
                </div>
              )}

              {proposal && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    onClick={() => toggleChat(job.id)}
                  >
                    {openChatJobId === job.id
                  ? 'Cerrar conversación'
                  : `Abrir conversación${
                      unreadCounts[job.id]
                        ? ` (${unreadCounts[job.id]})`
                        : ''
                    }`}
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

              {job.status === 'TERMINATION_REQUESTED' && job.terminationRequest && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3>Solicitud de terminación anticipada</h3>

                  <p>
                    <strong>Solicitada por:</strong>{' '}
                    {job.terminationRequest.requesterRole === 'CLIENT'
                      ? 'Cliente'
                      : 'Especialista'}
                  </p>

                  <p>
                    <strong>Motivo:</strong>{' '}
                    {job.terminationRequest.reasonCode}
                  </p>

                  {job.terminationRequest.reasonDetails && (
                    <p>
                      <strong>Detalles:</strong>{' '}
                      {job.terminationRequest.reasonDetails}
                    </p>
                  )}

                  {job.terminationRequest.claimedLiability &&
                    job.terminationRequest.claimedLiability !== 'UNDETERMINED' && (
                      <p>
                        <strong>Responsabilidad atribuida:</strong>{' '}
                        {job.terminationRequest.claimedLiability === 'CLIENT'
                          ? 'Cliente'
                          : job.terminationRequest.claimedLiability === 'SPECIALIST'
                            ? 'Especialista'
                            : 'Ninguna'}
                      </p>
                    )}

                  {job.terminationRequest.requesterRole === 'CLIENT' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => aceptarTerminacion(job.id)}
                        disabled={updatingId === job.id}
                      >
                        Aceptar terminación
                      </button>

                      {confirmingTerminationAcceptance === job.id && (
                        <div
                          style={{
                            marginTop: '12px',
                            padding: '14px',
                            border: '1px solid #ddd',
                            borderRadius: '10px'
                          }}
                        >
                          <p style={{ marginTop: 0 }}>
                            <strong>Confirmar aceptación</strong>
                          </p>

                          <p>
                            Esta decisión puede generar pagos, reembolsos o
                            penalizaciones según la etapa del trabajo.
                          </p>

                          <button
                            type="button"
                            onClick={() =>
                              aceptarTerminacion(job.id, true)
                            }
                            disabled={updatingId === job.id}
                          >
                            {updatingId === job.id
                              ? 'Procesando...'
                              : 'Confirmar aceptación'}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setConfirmingTerminationAcceptance(null)
                            }
                            disabled={updatingId === job.id}
                            style={{ marginTop: '8px' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setTerminationDisputeJobId(
                            terminationDisputeJobId === job.id
                              ? null
                              : job.id
                          )
                        }
                        disabled={updatingId === job.id}
                        style={{ marginTop: '8px' }}
                      >
                        Disputar terminación
                      </button>

                      {terminationDisputeJobId === job.id && (
                        <div
                          style={{
                            marginTop: '12px',
                            padding: '14px',
                            border: '1px solid #ddd',
                            borderRadius: '10px'
                          }}
                        >
                          <label
                            htmlFor={`termination-dispute-${job.id}`}
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              marginBottom: '8px'
                            }}
                          >
                            Motivo de la disputa
                          </label>

                          <textarea
                            id={`termination-dispute-${job.id}`}
                            value={
                              terminationDisputeDrafts[job.id] || ''
                            }
                            onChange={(e) =>
                              setTerminationDisputeDrafts((prev) => ({
                                ...prev,
                                [job.id]: e.target.value
                              }))
                            }
                            placeholder="Explica brevemente por qué no estás de acuerdo con la terminación."
                            rows={5}
                            style={{
                              width: '100%',
                              minHeight: '110px',
                              padding: '10px',
                              boxSizing: 'border-box',
                              fontSize: '16px',
                              resize: 'vertical'
                            }}
                          />

                          <button
                            type="button"
                            onClick={() => disputarTerminacion(job.id)}
                            disabled={updatingId === job.id}
                            style={{ marginTop: '10px' }}
                          >
                            {updatingId === job.id
                              ? 'Enviando...'
                              : 'Enviar disputa'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setTerminationDisputeJobId(null);
                              setTerminationDisputeDrafts((prev) => ({
                                ...prev,
                                [job.id]: ''
                              }));
                            }}
                            disabled={updatingId === job.id}
                            style={{ marginTop: '8px' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>Esperando respuesta del cliente.</p>
                  )}
                </div>
              )}

              {job.status === 'DISPUTED' && job.terminationRequest && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3>Terminación en disputa</h3>
                  <p>
                    La terminación fue disputada y requiere revisión antes de
                    liberar o devolver fondos.
                  </p>

                  {job.terminationRequest.disputeNotes && (
                    <p>
                      <strong>Motivo de la disputa:</strong>{' '}
                      {job.terminationRequest.disputeNotes}
                    </p>
                  )}
                </div>
              )}

              {job.terminationRequest?.status === 'RESOLVED' && (
                <div
                  style={{
                    marginTop: '16px',
                    marginBottom: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '10px',
                    padding: '14px'
                  }}
                >
                  <h3>Terminación resuelta</h3>

                  <p>
                    <strong>Responsabilidad final:</strong>{' '}
                    {job.terminationRequest.liability === 'CLIENT'
                      ? 'Cliente'
                      : job.terminationRequest.liability === 'SPECIALIST'
                        ? 'Especialista'
                        : job.terminationRequest.liability === 'NONE'
                          ? 'Ninguna'
                          : 'No determinada'}
                  </p>

                  <p>
                    <strong>Pago al especialista:</strong> $
                    {Number(
                      job.terminationRequest.specialistPayoutAmount || 0
                    ).toFixed(2)}
                  </p>

                  <p>
                    <strong>Reembolso al cliente:</strong> $
                    {Number(
                      job.terminationRequest.clientRefundAmount || 0
                    ).toFixed(2)}
                  </p>

                  <p>
                    <strong>Penalización:</strong> $
                    {Number(
                      job.terminationRequest.penaltyAmount || 0
                    ).toFixed(2)}
                  </p>

                  {job.terminationRequest.resolutionNotes && (
                    <p>
                      <strong>Resolución administrativa:</strong>{' '}
                      {job.terminationRequest.resolutionNotes}
                    </p>
                  )}

                  {job.terminationRequest.resolvedAt && (
                    <p>
                      <strong>Fecha de resolución:</strong>{' '}
                      {new Date(
                        job.terminationRequest.resolvedAt
                      ).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {!!job.terminationRequest?.damageClaims?.length && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3>Reclamaciones de daños</h3>

                  {job.terminationRequest.damageClaims.map((claim: any) => (
                    <div
                      key={claim.id}
                      style={{
                        border: '1px solid #ddd',
                        borderRadius: '10px',
                        padding: '14px',
                        marginBottom: '12px'
                      }}
                    >
                      <details
                        open={
                          claim.status === 'PENDING' ||
                          claim.status === 'DISPUTED'
                        }
                      >
                        <summary
                          style={{
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          {tipoReclamacion(claim.type)} ·{' '}
                          {estadoReclamacion(claim.status)}
                          {claim.createdAt
                            ? ` · ${new Date(
                                claim.createdAt
                              ).toLocaleDateString()}`
                            : ''}
                        </summary>

                        <div style={{ marginTop: '14px' }}>
                          <p>
                            <strong>Tipo:</strong>{' '}
                            {tipoReclamacion(claim.type)}
                          </p>

                          <p>
                            <strong>Estado:</strong>{' '}
                            {estadoReclamacion(claim.status)}
                          </p>

                          <p>
                            <strong>Descripción:</strong>{' '}
                            {claim.description}
                          </p>

                          {claim.claimedAmount !== null && (
                            <p>
                              <strong>Monto reclamado:</strong> $
                              {Number(claim.claimedAmount).toFixed(2)}
                            </p>
                          )}

                          {claim.approvedAmount !== null && (
                            <p>
                              <strong>Monto aprobado:</strong> $
                              {Number(claim.approvedAmount).toFixed(2)}
                            </p>
                          )}

                          {claim.resolutionNotes && (
                            <p>
                              <strong>Respuesta o resolución:</strong>{' '}
                              {claim.resolutionNotes}
                            </p>
                          )}
                        </div>
                      </details>

                      {claim.status === 'PENDING' &&
                        claim.claimedAgainst === 'SPECIALIST' && (
                          <div style={{ marginTop: '12px' }}>
                            <button
                              type="button"
                              onClick={() =>
                                aceptarReclamacion(job.id, claim.id)
                              }
                              disabled={updatingId === claim.id}
                            >
                              Aceptar reclamación
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setDamageClaimDisputeId(
                                  damageClaimDisputeId === claim.id
                                    ? null
                                    : claim.id
                                )
                              }
                              disabled={updatingId === claim.id}
                              style={{ marginTop: '8px' }}
                            >
                              Disputar reclamación
                            </button>

                            {damageClaimDisputeId === claim.id && (
                              <div
                                style={{
                                  marginTop: '12px',
                                  padding: '14px',
                                  border: '1px solid #ddd',
                                  borderRadius: '10px'
                                }}
                              >
                                <label
                                  htmlFor={`damage-claim-dispute-${claim.id}`}
                                  style={{
                                    display: 'block',
                                    fontWeight: 600,
                                    marginBottom: '8px'
                                  }}
                                >
                                  Motivo de la disputa
                                </label>

                                <textarea
                                  id={`damage-claim-dispute-${claim.id}`}
                                  value={
                                    damageClaimDisputeDrafts[claim.id] || ''
                                  }
                                  onChange={(e) =>
                                    setDamageClaimDisputeDrafts((prev) => ({
                                      ...prev,
                                      [claim.id]: e.target.value
                                    }))
                                  }
                                  placeholder="Explica por qué no estás de acuerdo con esta reclamación."
                                  rows={5}
                                  style={{
                                    width: '100%',
                                    minHeight: '110px',
                                    padding: '10px',
                                    boxSizing: 'border-box',
                                    fontSize: '16px',
                                    resize: 'vertical'
                                  }}
                                />

                                <button
                                  type="button"
                                  onClick={() =>
                                    disputarReclamacion(job.id, claim.id)
                                  }
                                  disabled={updatingId === claim.id}
                                  style={{ marginTop: '10px' }}
                                >
                                  {updatingId === claim.id
                                    ? 'Enviando...'
                                    : 'Enviar disputa'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setDamageClaimDisputeId(null);
                                    setDamageClaimDisputeDrafts((prev) => ({
                                      ...prev,
                                      [claim.id]: ''
                                    }));
                                  }}
                                  disabled={updatingId === claim.id}
                                  style={{ marginTop: '8px' }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  ))}
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
                    : 'Marcar trabajo como terminado'}
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
