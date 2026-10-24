'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisSolicitudes() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, any[]>>({});
  const [loadingProposals, setLoadingProposals] = useState<string | null>(null);
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
      }
    >
  >({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: string; comment: string }>>({});
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);
  const [confirmingCompletion, setConfirmingCompletion] = useState<string | null>(null);
  const [confirmingCancellation, setConfirmingCancellation] = useState<string | null>(null);
  const [confirmingProposalRejection, setConfirmingProposalRejection] = useState<string | null>(null);
  const [terminationJobId, setTerminationJobId] = useState<string | null>(null);
  const [submittingTermination, setSubmittingTermination] = useState<string | null>(null);
  const [confirmingTerminationAcceptance, setConfirmingTerminationAcceptance] = useState<string | null>(null);
  const [disputingTerminationJobId, setDisputingTerminationJobId] = useState<string | null>(null);
  const [terminationDisputeReason, setTerminationDisputeReason] = useState('');
  const [terminationDraft, setTerminationDraft] = useState({
    reasonCode: '',
    reasonDetails: '',
    claimedLiability: ''
  });
  const [damageClaimJobId, setDamageClaimJobId] = useState<string | null>(null);
  const [submittingDamageClaim, setSubmittingDamageClaim] = useState<string | null>(null);
  const [damageClaimDraft, setDamageClaimDraft] = useState({
    type: 'RESTITUTION',
    description: '',
    claimedAmount: ''
  });
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [openChatJobId, setOpenChatJobId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, any[]>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [loadingChat, setLoadingChat] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [editDraft, setEditDraft] = useState({
    title: '',
    description: '',
    city: '',
    state: '',
    zipcode: '',
    desiredDate: ''
  });

  useEffect(() => {
    api('/job-requests/me')
      .then(setItems)
      .catch((e) => setError(e.message));

    const loadUnreadCounts = () => {
      api('/job-requests/messages/unread-counts')
        .then(setUnreadCounts)
        .catch(() => {});
    };

    loadUnreadCounts();

    const interval = window.setInterval(loadUnreadCounts, 10000);

    return () => window.clearInterval(interval);
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

  async function rejectProposal(
    jobId: string,
    proposalId: string,
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingProposalRejection(proposalId);
      setError('');
      return;
    }

    setConfirmingProposalRejection(null);
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
            ? { ...job, status: 'PENDING_AGREEMENT' }
            : job
        )
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la propuesta.');
    }
  }


  async function unselectProposal(jobId: string, proposalId: string) {
    setError('');

    try {
      await api(`/job-requests/${jobId}/proposals/${proposalId}/unselect`, {
        method: 'POST'
      });

      const updated = await api(`/job-requests/${jobId}/proposals`);

      setProposals((prev) => ({
        ...prev,
        [jobId]: updated
      }));

      setWorkOrders((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });

      setItems((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? { ...job, status: 'RECEIVING_QUOTES' }
            : job
        )
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo retirar la selección.');
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
        setItems((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? { ...job, status: 'AWAITING_PAYMENT' }
              : job
          )
        );
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
        materialsAmount: String(workOrder.materialsAmount ?? '')
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
          materialsAmount: Number(draft.materialsAmount)
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

  async function confirmPayment(jobId: string) {
    setError('');
    setProcessingPayment(jobId);

    try {
      await api(`/job-requests/${jobId}/payment/confirm`, {
        method: 'POST'
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
      cancelTerminationDispute();
    } catch (e: any) {
      setError(e.message || 'No se pudo confirmar el pago.');
    } finally {
      setProcessingPayment(null);
    }
  }

  async function confirmCompletion(
    jobId: string,
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingCompletion(jobId);
      setError('');
      return;
    }

    setError('');

    try {
      await api(`/job-requests/${jobId}/complete/confirm`, {
        method: 'POST'
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
    } catch (e: any) {
      setError(e.message || 'No se pudo confirmar la terminación del trabajo.');
    } finally {
      setConfirmingCompletion(null);
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
          budgetMin: null,
          budgetMax: null,
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

  async function cancelJob(
    jobId: string,
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingCancellation(jobId);
      setError('');
      return;
    }

    setConfirmingCancellation(null);
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

  function startTermination(jobId: string) {
    setTerminationJobId(jobId);
    setTerminationDraft({
      reasonCode: '',
      reasonDetails: '',
      claimedLiability: ''
    });
    setError('');
  }

  function cancelTermination() {
    setTerminationJobId(null);
    setTerminationDraft({
      reasonCode: '',
      reasonDetails: '',
      claimedLiability: ''
    });
  }

  async function submitTermination(job: any) {
    if (!terminationDraft.reasonCode.trim()) {
      setError('Debes indicar la causa de la terminación.');
      return;
    }

    if (
      job.status === 'IN_PROGRESS' &&
      !terminationDraft.claimedLiability
    ) {
      setError('Debes indicar a quién atribuyes la responsabilidad.');
      return;
    }

    setError('');
    setSubmittingTermination(job.id);

    try {
      const body: any = {
        reasonCode: terminationDraft.reasonCode.trim(),
        reasonDetails: terminationDraft.reasonDetails.trim() || null
      };

      if (job.status === 'IN_PROGRESS') {
        body.claimedLiability = terminationDraft.claimedLiability;
      }

      await api(`/job-requests/${job.id}/termination-request`, {
        method: 'POST',
        body: JSON.stringify(body)
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
      cancelTermination();
    } catch (e: any) {
      setError(e.message || 'No se pudo solicitar la terminación.');
    } finally {
      setSubmittingTermination(null);
    }
  }

  function startDamageClaim(jobId: string) {
    setDamageClaimJobId(jobId);
    setDamageClaimDraft({ type: 'RESTITUTION', description: '', claimedAmount: '' });
    setError('');
  }

  function cancelDamageClaim() {
    setDamageClaimJobId(null);
    setDamageClaimDraft({ type: 'RESTITUTION', description: '', claimedAmount: '' });
  }

  async function submitDamageClaim(jobId: string) {
    if (!damageClaimDraft.description.trim()) {
      setError('Debes describir el daño reclamado.');
      return;
    }

    const body: any = {
      type: damageClaimDraft.type,
      description: damageClaimDraft.description.trim()
    };

    if (damageClaimDraft.claimedAmount) {
      body.claimedAmount = Number(damageClaimDraft.claimedAmount);
    }

    setSubmittingDamageClaim(jobId);
    setError('');

    try {
      await api(`/job-requests/${jobId}/damage-claims`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setItems(await api('/job-requests/me'));
      cancelDamageClaim();
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la reclamación.');
    } finally {
      setSubmittingDamageClaim(null);
    }
  }

  async function acceptTermination(
    jobId: string,
    confirmed = false
  ) {
    if (!confirmed) {
      setConfirmingTerminationAcceptance(jobId);
      setError('');
      return;
    }

    setConfirmingTerminationAcceptance(null);
    setError('');
    setSubmittingTermination(jobId);

    try {
      await api(`/job-requests/${jobId}/termination-request/accept`, {
        method: 'POST'
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
    } catch (e: any) {
      setError(e.message || 'No se pudo aceptar la terminación.');
    } finally {
      setSubmittingTermination(null);
    }
  }

  function startTerminationDispute(jobId: string) {
    setDisputingTerminationJobId(jobId);
    setTerminationDisputeReason('');
    setError('');
  }

  function cancelTerminationDispute() {
    setDisputingTerminationJobId(null);
    setTerminationDisputeReason('');
  }

  async function disputeTermination(jobId: string) {
    const reason = terminationDisputeReason.trim();

    if (!reason) {
      setError('Debes indicar el motivo de la disputa.');
      return;
    }

    setError('');
    setSubmittingTermination(jobId);

    try {
      await api(`/job-requests/${jobId}/termination-request/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reasonDetails: reason
        })
      });

      const updated = await api('/job-requests/me');
      setItems(updated);
    } catch (e: any) {
      setError(e.message || 'No se pudo disputar la terminación.');
    } finally {
      setSubmittingTermination(null);
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
              <strong>Ubicación:</strong>{' '}
              {[job.city, job.state, job.zipcode]
                .filter(Boolean)
                .join(', ')}
            </p>

            <p>
              <strong>Estado de la solicitud:</strong>{' '}
              {job.status === 'PENDING_AGREEMENT'
                ? 'Pendiente de aceptación de la Orden de Trabajo'
                : job.status === 'AWAITING_PAYMENT'
                  ? 'Pendiente de pago'
                : job.status === 'ASSIGNED'
                  ? 'Asignado'
                  : job.status === 'IN_PROGRESS'
                    ? 'En progreso'
                    : job.status === 'AWAITING_CLIENT_CONFIRMATION'
                      ? 'Esperando tu confirmación'
                      : job.status === 'TERMINATION_REQUESTED'
                        ? 'Terminación solicitada'
                        : job.status === 'DISPUTED'
                          ? 'Terminación en disputa'
                          : job.status === 'COMPLETED'
                            ? 'Completado'
                            : job.status === 'CANCELLED'
                              ? 'Cancelado'
                              : job.status}
            </p>

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
                      <strong>Total:</strong> $
                      {(
                        Number(workOrders[job.id].laborAmount) +
                        Number(workOrders[job.id].materialsAmount)
                      ).toFixed(2)}
                    </p>

                    <p>
                      <strong>Tu aceptación:</strong>{' '}
                      {workOrders[job.id].clientAcceptedAt
                        ? 'Aceptada'
                        : 'Pendiente'}
                    </p>

                    <p>
                      <strong>Aceptación del especialista:</strong>{' '}
                      {workOrders[job.id].specialistAcceptedAt
                        ? 'Aceptada'
                        : 'Pendiente'}
                    </p>

                    {!workOrders[job.id].clientAcceptedAt && (
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
                              Solicitar / proponer cambios
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

            {job.terminationRequest?.jobStatusAtRequest === 'IN_PROGRESS' &&
              (job.terminationRequest.status === 'DISPUTED' ||
                (job.terminationRequest.status === 'RESOLVED' &&
                  job.terminationRequest.liability === 'SPECIALIST')) && (
                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  {damageClaimJobId === job.id ? (
                    <div>
                      <h4>Reclamación de daños</h4>

                      <select
                        value={damageClaimDraft.type}
                        onChange={(e) =>
                          setDamageClaimDraft((prev) => ({
                            ...prev,
                            type: e.target.value
                          }))
                        }
                      >
                        <option value="RESTITUTION">Restitución</option>
                        <option value="COMPENSATION">Compensación</option>
                        <option value="BOTH">Restitución y compensación</option>
                      </select>

                      <textarea
                        placeholder="Describe el daño o perjuicio"
                        value={damageClaimDraft.description}
                        onChange={(e) =>
                          setDamageClaimDraft((prev) => ({
                            ...prev,
                            description: e.target.value
                          }))
                        }
                      />

                      {damageClaimDraft.type !== 'RESTITUTION' && (
                        <input
                          type="number"
                          min="0"
                          placeholder="Monto reclamado"
                          value={damageClaimDraft.claimedAmount}
                          onChange={(e) =>
                            setDamageClaimDraft((prev) => ({
                              ...prev,
                              claimedAmount: e.target.value
                            }))
                          }
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => submitDamageClaim(job.id)}
                        disabled={submittingDamageClaim === job.id}
                      >
                        Enviar reclamación
                      </button>

                      <button type="button" onClick={cancelDamageClaim}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => startDamageClaim(job.id)}>
                      Presentar reclamación de daños
                    </button>
                  )}
                </div>
              )}

            {!!job.terminationRequest?.damageClaims?.length && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <h4>Reclamaciones de daños</h4>

                {job.terminationRequest.damageClaims.map((claim: any) => {
                  const tipo =
                    claim.type === 'RESTITUTION'
                      ? 'Restitución'
                      : claim.type === 'COMPENSATION'
                        ? 'Compensación'
                        : claim.type === 'BOTH'
                          ? 'Restitución y compensación'
                          : claim.type;

                  const estado =
                    claim.status === 'PENDING'
                      ? 'Pendiente'
                      : claim.status === 'ACCEPTED'
                        ? 'Aceptada'
                        : claim.status === 'DISPUTED'
                          ? 'En disputa'
                          : claim.status === 'RESOLVED'
                            ? 'Resuelta'
                            : claim.status === 'REJECTED'
                              ? 'Rechazada'
                              : claim.status;

                  return (
                    <details
                      key={claim.id}
                      open={claim.status === 'PENDING' || claim.status === 'DISPUTED'}
                      style={{
                        border: '1px solid #ddd',
                        borderRadius: '10px',
                        padding: '14px',
                        marginBottom: '12px'
                      }}
                    >
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        {tipo} · {estado}
                        {claim.createdAt
                          ? ` · ${new Date(claim.createdAt).toLocaleDateString()}`
                          : ''}
                      </summary>

                      <div style={{ marginTop: '14px' }}>
                        <p>
                          <strong>Tipo:</strong> {tipo}
                        </p>

                        <p>
                          <strong>Estado:</strong> {estado}
                        </p>

                        <p>
                          <strong>Descripción:</strong> {claim.description}
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
                  );
                })}
              </div>
            )}

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

            {job.status === 'AWAITING_PAYMENT' && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <p>
                  <strong>Pago pendiente.</strong> Esta confirmación es una
                  simulación del MVP y todavía no realiza un cargo real.
                </p>

                <button
                  type="button"
                  onClick={() => confirmPayment(job.id)}
                  disabled={processingPayment === job.id}
                >
                  {processingPayment === job.id
                    ? 'Procesando...'
                    : 'Confirmar pago'}
                </button>
              </div>
            )}

            {job.status === 'AWAITING_CLIENT_CONFIRMATION' && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <p>
                  El especialista indicó que terminó el trabajo. Confirma
                  únicamente si el servicio fue completado correctamente.
                </p>

                <button
                  type="button"
                  onClick={() => confirmCompletion(job.id)}
                >
                  Confirmar trabajo terminado
                </button>

                {confirmingCompletion === job.id && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '10px'
                    }}
                  >
                    <p style={{ marginTop: 0 }}>
                      <strong>Confirmar finalización</strong>
                    </p>

                    <p>
                      Confirma únicamente si el especialista terminó
                      correctamente el trabajo.
                    </p>

                    <button
                      type="button"
                      onClick={() => confirmCompletion(job.id, true)}
                    >
                      Confirmar finalización
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmingCompletion(null)}
                      style={{ marginTop: '8px' }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}

            {['AWAITING_PAYMENT', 'ASSIGNED', 'IN_PROGRESS'].includes(job.status) && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                {terminationJobId === job.id ? (
                  <div>
                    <h4>Solicitar terminación anticipada</h4>

                    <label>Motivo</label>
                    <input
                      value={terminationDraft.reasonCode}
                      onChange={(e) =>
                        setTerminationDraft((prev) => ({
                          ...prev,
                          reasonCode: e.target.value
                        }))
                      }
                    />

                    <label>Detalles</label>
                    <textarea
                      value={terminationDraft.reasonDetails}
                      onChange={(e) =>
                        setTerminationDraft((prev) => ({
                          ...prev,
                          reasonDetails: e.target.value
                        }))
                      }
                    />

                    {job.status === 'IN_PROGRESS' && (
                      <>
                        <label>Responsabilidad atribuida</label>
                        <select
                          value={terminationDraft.claimedLiability}
                          onChange={(e) =>
                            setTerminationDraft((prev) => ({
                              ...prev,
                              claimedLiability: e.target.value
                            }))
                          }
                        >
                          <option value="">Selecciona</option>
                          <option value="CLIENT">Cliente</option>
                          <option value="SPECIALIST">Especialista</option>
                        </select>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => submitTermination(job)}
                      disabled={submittingTermination === job.id}
                      style={{ marginTop: '8px' }}
                    >
                      {submittingTermination === job.id
                        ? 'Enviando...'
                        : 'Enviar solicitud de terminación'}
                    </button>

                    <button
                      type="button"
                      onClick={cancelTermination}
                      style={{ marginTop: '8px' }}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startTermination(job.id)}
                  >
                    Solicitar terminación anticipada
                  </button>
                )}
              </div>
            )}

            {job.status === 'TERMINATION_REQUESTED' && job.terminationRequest && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <h4>Solicitud de terminación anticipada</h4>

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

                {job.terminationRequest.requesterRole === 'SPECIALIST' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => acceptTermination(job.id)}
                      disabled={submittingTermination === job.id}
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
                          Esta decisión puede generar reembolsos, pagos o
                          penalizaciones según la etapa del trabajo.
                        </p>

                        <button
                          type="button"
                          onClick={() => acceptTermination(job.id, true)}
                          disabled={submittingTermination === job.id}
                        >
                          {submittingTermination === job.id
                            ? 'Procesando...'
                            : 'Confirmar aceptación'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setConfirmingTerminationAcceptance(null)
                          }
                          disabled={submittingTermination === job.id}
                          style={{ marginTop: '8px' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => startTerminationDispute(job.id)}
                      disabled={submittingTermination === job.id}
                      style={{ marginTop: '8px' }}
                    >
                      Disputar terminación
                    </button>

                    {disputingTerminationJobId === job.id && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '10px'
                        }}
                      >
                        <p style={{ marginTop: 0 }}>
                          <strong>Motivo de la disputa</strong>
                        </p>

                        <textarea
                          value={terminationDisputeReason}
                          onChange={(e) =>
                            setTerminationDisputeReason(e.target.value)
                          }
                          placeholder="Explica brevemente por qué disputas la terminación"
                          rows={4}
                          style={{
                            display: 'block',
                            width: '100%',
                            marginTop: '6px',
                            marginBottom: '12px'
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => disputeTermination(job.id)}
                          disabled={submittingTermination === job.id}
                        >
                          {submittingTermination === job.id
                            ? 'Enviando...'
                            : 'Enviar disputa'}
                        </button>

                        <button
                          type="button"
                          onClick={cancelTerminationDispute}
                          disabled={submittingTermination === job.id}
                          style={{ marginTop: '8px' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p>
                    Esperando respuesta del especialista.
                  </p>
                )}
              </div>
            )}

            {job.status === 'DISPUTED' && job.terminationRequest && (
              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <h4>Terminación en disputa</h4>
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
                <h4>Terminación resuelta</h4>

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

            {job.proposals?.[0]?.specialist?.user?.name && (
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

            {['DRAFT', 'PUBLISHED'].includes(job.status) && (
              editingJobId === job.id ? (
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
              )
            )}

            {['DRAFT', 'PUBLISHED', 'RECEIVING_QUOTES'].includes(job.status) && (
              <div style={{ marginBottom: '8px' }}>
                <button
                  type="button"
                  onClick={() => cancelJob(job.id)}
                >
                  Cancelar solicitud
                </button>

                {confirmingCancellation === job.id && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '10px'
                    }}
                  >
                    <p style={{ marginTop: 0 }}>
                      <strong>Confirmar cancelación</strong>
                    </p>

                    <p>
                      Esta acción cancelará la solicitud y ya no aceptará
                      nuevas propuestas.
                    </p>

                    <button
                      type="button"
                      onClick={() => cancelJob(job.id, true)}
                    >
                      Confirmar cancelación
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmingCancellation(null)}
                      style={{ marginTop: '8px' }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
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
                        ).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                      </p>
                    )}

                    <p>
                      <strong>Estado de la propuesta:</strong>{' '}
                      {proposal.status}
                    </p>

                    {proposal.status === 'SELECTED' &&
                      job.status === 'PENDING_AGREEMENT' && (
                        <button
                          type="button"
                          onClick={() => {
                            const confirmed = window.confirm(
                              '¿Seguro que deseas retirar esta selección? La Orden de Trabajo actual quedará cancelada y podrás seleccionar otra propuesta.'
                            );
                            if (!confirmed) return;
                            unselectProposal(job.id, proposal.id);
                          }}
                        >
                          Retirar selección
                        </button>
                      )}

                    {proposal.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            acceptProposal(job.id, proposal.id)
                          }
                        >
                          Seleccionar propuesta
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

                        {confirmingProposalRejection === proposal.id && (
                          <div
                            style={{
                              marginTop: '12px',
                              padding: '14px',
                              border: '1px solid #ddd',
                              borderRadius: '10px'
                            }}
                          >
                            <p style={{ marginTop: 0 }}>
                              <strong>Confirmar rechazo</strong>
                            </p>

                            <p>
                              Esta propuesta quedará rechazada y ya no podrá
                              ser aceptada.
                            </p>

                            <button
                              type="button"
                              onClick={() =>
                                rejectProposal(
                                  job.id,
                                  proposal.id,
                                  true
                                )
                              }
                            >
                              Confirmar rechazo
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setConfirmingProposalRejection(null)
                              }
                              style={{ marginTop: '8px' }}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
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
