'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type Termination = {
  id: string;
  requesterRole: string;
  jobStatusAtRequest: string;
  reasonCode: string;
  reasonDetails: string | null;
  status: string;
  claimedLiability: string;
  liability: string;
  specialistPayoutAmount: number | null;
  clientRefundAmount: number | null;
  penaltyAmount: number | null;
  disputeNotes: string | null;
  resolutionNotes: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  requestedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  jobRequest: {
    id: string;
    title: string;
    status: string;
    city: string;
    state: string;
    client: {
      id: string;
      name: string;
      email: string;
    };
    specialist: {
      id: string;
      name: string;
      email: string;
    } | null;
    payment: {
      id: string;
      amount: number;
      currency: string;
      status: string;
    } | null;
  };
};

type ResolutionForm = {
  liability: string;
  specialistPayoutAmount: string;
  clientRefundAmount: string;
  penaltyAmount: string;
  resolutionNotes: string;
};

export default function AdminTerminaciones() {
  const [terminations, setTerminations] = useState<Termination[]>([]);
  const [forms, setForms] = useState<Record<string, ResolutionForm>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function loadTerminations() {
    setLoading(true);
    setError('');

    try {
      const data = await api('/job-requests/admin/termination-requests');
      setTerminations(data);

      const initialForms: Record<string, ResolutionForm> = {};

      for (const termination of data) {
        if (termination.status !== 'DISPUTED') continue;

        const total = termination.jobRequest.payment?.amount ?? 0;

        let payout = '';
        let refund = '';

        if (termination.jobStatusAtRequest !== 'AWAITING_PAYMENT') {
          if (termination.claimedLiability === 'CLIENT') {
            payout = String(total);
            refund = '0';
          } else if (termination.claimedLiability === 'SPECIALIST') {
            payout = '0';
            refund = String(total);
          }
        }

        initialForms[termination.id] = {
          liability:
            ['CLIENT', 'SPECIALIST', 'NONE'].includes(
              termination.claimedLiability
            )
              ? termination.claimedLiability
              : 'NONE',
          specialistPayoutAmount: payout,
          clientRefundAmount: refund,
          penaltyAmount: '0',
          resolutionNotes: ''
        };
      }

      setForms(initialForms);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar las terminaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTerminations();
  }, []);

  function updateForm(
    terminationId: string,
    field: keyof ResolutionForm,
    value: string
  ) {
    setForms((prev) => ({
      ...prev,
      [terminationId]: {
        ...prev[terminationId],
        [field]: value
      }
    }));
  }

  function estado(status: string) {
    if (status === 'DISPUTED') return 'En disputa';
    if (status === 'RESOLVED') return 'Resuelta';
    return status;
  }

  function responsabilidad(value: string) {
    if (value === 'CLIENT') return 'Cliente';
    if (value === 'SPECIALIST') return 'Especialista';
    if (value === 'NONE') return 'Ninguna';
    if (value === 'UNDETERMINED') return 'No determinada';
    return value;
  }

  function solicitante(value: string) {
    if (value === 'CLIENT') return 'Cliente';
    if (value === 'SPECIALIST') return 'Especialista';
    return value;
  }

  function etapa(value: string) {
    if (value === 'AWAITING_PAYMENT') return 'Esperando pago';
    if (value === 'ASSIGNED') return 'Asignado, sin iniciar';
    if (value === 'IN_PROGRESS') return 'En progreso';
    return value;
  }

  function fecha(value?: string | null) {
    if (!value) return 'No disponible';
    return new Date(value).toLocaleDateString();
  }

  async function resolveTermination(
    termination: Termination,
    confirmed = false
  ) {
    const form = forms[termination.id];

    if (!form?.resolutionNotes.trim()) {
      setError('Debes escribir las notas de resolución.');
      return;
    }

    const beforePayment =
      termination.jobStatusAtRequest === 'AWAITING_PAYMENT';

    if (!beforePayment) {
      const total = termination.jobRequest.payment?.amount ?? 0;
      const payout = Number(form.specialistPayoutAmount);
      const refund = Number(form.clientRefundAmount);
      const penalty = Number(form.penaltyAmount || 0);

      if (
        !Number.isFinite(payout) ||
        payout < 0 ||
        !Number.isFinite(refund) ||
        refund < 0 ||
        !Number.isFinite(penalty) ||
        penalty < 0
      ) {
        setError('Los montos deben ser números válidos y no negativos.');
        return;
      }

      if (Math.abs(payout + refund - total) > 0.009) {
        setError(
          `El pago al especialista más el reembolso al cliente debe sumar $${total.toFixed(
            2
          )}.`
        );
        return;
      }
    }

    if (!confirmed) {
      setConfirmingId(termination.id);
      setError('');
      return;
    }

    setConfirmingId(null);
    setUpdatingId(termination.id);
    setError('');
    setMessage('');

    try {
      const body: any = {
        liability: form.liability,
        resolutionNotes: form.resolutionNotes.trim()
      };

      if (!beforePayment) {
        body.specialistPayoutAmount = Number(
          form.specialistPayoutAmount
        );
        body.clientRefundAmount = Number(
          form.clientRefundAmount
        );
        body.penaltyAmount = Number(form.penaltyAmount || 0);
      }

      await api(
        `/job-requests/${termination.jobRequest.id}/termination-request/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      );

      setMessage('Terminación resuelta correctamente.');
      await loadTerminations();
    } catch (e: any) {
      setError(e.message || 'No se pudo resolver la terminación.');
    } finally {
      setUpdatingId(null);
    }
  }

  const pending = terminations.filter(
    (termination) => termination.status === 'DISPUTED'
  );

  const history = terminations.filter(
    (termination) => termination.status === 'RESOLVED'
  );

  return (
    <main className="wrap">
      <div className="card">
        <h1>Terminaciones anticipadas</h1>

        <p>
          Revisa terminaciones en disputa, determina la responsabilidad
          y define la liquidación económica correspondiente.
        </p>

        {message && <p style={{ color: 'green' }}>{message}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}

        {loading ? (
          <p>Cargando terminaciones...</p>
        ) : (
          <>
            <h2>Pendientes de resolución</h2>

            {pending.length === 0 ? (
              <p>No hay terminaciones en disputa pendientes de resolución.</p>
            ) : (
              pending.map((termination) => {
                const form = forms[termination.id];
                const total =
                  termination.jobRequest.payment?.amount ?? 0;

                return (
                  <div
                    key={termination.id}
                    style={{
                      borderTop: '1px solid #ddd',
                      paddingTop: '20px',
                      marginTop: '20px'
                    }}
                  >
                    <h3>{termination.jobRequest.title}</h3>

                    <p>
                      <strong>Ubicación:</strong>{' '}
                      {termination.jobRequest.city},{' '}
                      {termination.jobRequest.state}
                    </p>

                    <p>
                      <strong>Cliente:</strong>{' '}
                      {termination.jobRequest.client.name} —{' '}
                      {termination.jobRequest.client.email}
                    </p>

                    <p>
                      <strong>Especialista:</strong>{' '}
                      {termination.jobRequest.specialist
                        ? `${termination.jobRequest.specialist.name} — ${termination.jobRequest.specialist.email}`
                        : 'No disponible'}
                    </p>

                    <p>
                      <strong>Solicitó terminar:</strong>{' '}
                      {solicitante(termination.requesterRole)}
                    </p>

                    <p>
                      <strong>Etapa al solicitar:</strong>{' '}
                      {etapa(termination.jobStatusAtRequest)}
                    </p>

                    <p>
                      <strong>Causa:</strong>{' '}
                      {termination.reasonCode}
                    </p>

                    {termination.reasonDetails && (
                      <p>
                        <strong>Detalles:</strong>{' '}
                        {termination.reasonDetails}
                      </p>
                    )}

                    <p>
                      <strong>Responsabilidad reclamada:</strong>{' '}
                      {responsabilidad(
                        termination.claimedLiability
                      )}
                    </p>

                    {termination.disputeNotes && (
                      <p>
                        <strong>Motivo de la disputa:</strong>{' '}
                        {termination.disputeNotes}
                      </p>
                    )}

                    {termination.jobRequest.payment && (
                      <p>
                        <strong>Pago asociado:</strong> $
                        {total.toFixed(2)}{' '}
                        {termination.jobRequest.payment.currency} —{' '}
                        {termination.jobRequest.payment.status}
                      </p>
                    )}

                    <hr />

                    <h4>Resolución administrativa</h4>

                    <label>
                      Responsabilidad final
                      <select
                        value={form?.liability || 'NONE'}
                        onChange={(e) =>
                          updateForm(
                            termination.id,
                            'liability',
                            e.target.value
                          )
                        }
                        style={{
                          display: 'block',
                          marginTop: '6px',
                          marginBottom: '12px'
                        }}
                      >
                        <option value="CLIENT">Cliente</option>
                        <option value="SPECIALIST">
                          Especialista
                        </option>
                        <option value="NONE">Ninguna</option>
                      </select>
                    </label>

                    {termination.jobStatusAtRequest !==
                      'AWAITING_PAYMENT' && (
                      <>
                        <p>
                          <strong>Total a distribuir:</strong> $
                          {total.toFixed(2)}
                        </p>

                        <label>
                          Pago al especialista
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              form?.specialistPayoutAmount || ''
                            }
                            onChange={(e) =>
                              updateForm(
                                termination.id,
                                'specialistPayoutAmount',
                                e.target.value
                              )
                            }
                            style={{
                              display: 'block',
                              marginTop: '6px',
                              marginBottom: '12px'
                            }}
                          />
                        </label>

                        <label>
                          Reembolso al cliente
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form?.clientRefundAmount || ''}
                            onChange={(e) =>
                              updateForm(
                                termination.id,
                                'clientRefundAmount',
                                e.target.value
                              )
                            }
                            style={{
                              display: 'block',
                              marginTop: '6px',
                              marginBottom: '12px'
                            }}
                          />
                        </label>

                        <label>
                          Penalización
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form?.penaltyAmount || '0'}
                            onChange={(e) =>
                              updateForm(
                                termination.id,
                                'penaltyAmount',
                                e.target.value
                              )
                            }
                            style={{
                              display: 'block',
                              marginTop: '6px',
                              marginBottom: '12px'
                            }}
                          />
                        </label>
                      </>
                    )}

                    <label>
                      Notas de resolución
                      <textarea
                        value={form?.resolutionNotes || ''}
                        onChange={(e) =>
                          updateForm(
                            termination.id,
                            'resolutionNotes',
                            e.target.value
                          )
                        }
                        rows={4}
                        style={{
                          display: 'block',
                          width: '100%',
                          marginTop: '6px',
                          marginBottom: '12px'
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      disabled={updatingId === termination.id}
                      onClick={() =>
                        resolveTermination(termination)
                      }
                    >
                      Resolver terminación
                    </button>

                    {confirmingId === termination.id && (
                      <div
                        style={{
                          marginTop: '14px',
                          padding: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '10px'
                        }}
                      >
                        <p style={{ marginTop: 0 }}>
                          <strong>Confirmar resolución administrativa</strong>
                        </p>

                        <p>
                          Esta acción distribuirá los fondos según los montos
                          indicados y cerrará la terminación.
                        </p>

                        <button
                          type="button"
                          onClick={() =>
                            resolveTermination(termination, true)
                          }
                          disabled={updatingId === termination.id}
                        >
                          {updatingId === termination.id
                            ? 'Resolviendo...'
                            : 'Confirmar resolución'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={updatingId === termination.id}
                          style={{ marginTop: '8px' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <hr style={{ margin: '32px 0' }} />

            <h2>Historial de terminaciones</h2>

            {history.length === 0 ? (
              <p>No hay terminaciones resueltas.</p>
            ) : (
              history.map((termination) => (
                <details
                  key={termination.id}
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
                    {termination.jobRequest.title} ·{' '}
                    {estado(termination.status)} ·{' '}
                    {fecha(termination.resolvedAt)}
                  </summary>

                  <div style={{ marginTop: '14px' }}>
                    <p>
                      <strong>Solicitante:</strong>{' '}
                      {solicitante(termination.requesterRole)}
                    </p>

                    <p>
                      <strong>Etapa:</strong>{' '}
                      {etapa(termination.jobStatusAtRequest)}
                    </p>

                    <p>
                      <strong>Causa:</strong>{' '}
                      {termination.reasonCode}
                    </p>

                    {termination.reasonDetails && (
                      <p>
                        <strong>Detalles:</strong>{' '}
                        {termination.reasonDetails}
                      </p>
                    )}

                    {termination.disputeNotes && (
                      <p>
                        <strong>Motivo de la disputa:</strong>{' '}
                        {termination.disputeNotes}
                      </p>
                    )}

                    <p>
                      <strong>Responsabilidad final:</strong>{' '}
                      {responsabilidad(termination.liability)}
                    </p>

                    {termination.specialistPayoutAmount !== null && (
                      <p>
                        <strong>Pago al especialista:</strong> $
                        {termination.specialistPayoutAmount.toFixed(2)}
                      </p>
                    )}

                    {termination.clientRefundAmount !== null && (
                      <p>
                        <strong>Reembolso al cliente:</strong> $
                        {termination.clientRefundAmount.toFixed(2)}
                      </p>
                    )}

                    {termination.penaltyAmount !== null && (
                      <p>
                        <strong>Penalización:</strong> $
                        {termination.penaltyAmount.toFixed(2)}
                      </p>
                    )}

                    {termination.resolutionNotes && (
                      <p>
                        <strong>Resolución administrativa:</strong>{' '}
                        {termination.resolutionNotes}
                      </p>
                    )}

                    <p>
                      <strong>Fecha de resolución:</strong>{' '}
                      {fecha(termination.resolvedAt)}
                    </p>
                  </div>
                </details>
              ))
            )}
          </>
        )}

        <p style={{ marginTop: '24px' }}>
          <a href="/dashboard">Volver al panel</a>
        </p>
      </div>
    </main>
  );
}
