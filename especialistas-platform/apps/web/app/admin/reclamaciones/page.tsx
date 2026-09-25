'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type Claim = {
  id: string;
  type: string;
  description: string;
  claimedAmount: number | null;
  approvedAmount: number | null;
  status: string;
  claimedAgainst: string;
  coverageSource: string;
  insuranceReference: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  claimedBy: {
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
  };
};

type ResolutionForm = {
  resolutionNotes: string;
  approvedAmount: string;
  coverageSource: string;
  insuranceReference: string;
};

export default function AdminReclamaciones() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ResolutionForm>>({});
  const [confirmingClaim, setConfirmingClaim] = useState<{
    id: string;
    decision: 'RESOLVED' | 'REJECTED';
  } | null>(null);

  async function loadClaims() {
    setLoading(true);
    setError('');

    try {
      const data = await api('/job-requests/admin/damage-claims');
      setClaims(data);

      const initialForms: Record<string, ResolutionForm> = {};

      for (const claim of data) {
        if (['ACCEPTED', 'DISPUTED'].includes(claim.status)) {
          initialForms[claim.id] = {
            resolutionNotes: '',
            approvedAmount:
              claim.claimedAmount !== null
                ? String(claim.claimedAmount)
                : '',
            coverageSource: 'RESPONSIBLE_PARTY',
            insuranceReference: ''
          };
        }
      }

      setForms(initialForms);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar las reclamaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClaims();
  }, []);

  function updateForm(
    claimId: string,
    field: keyof ResolutionForm,
    value: string
  ) {
    setForms((prev) => ({
      ...prev,
      [claimId]: {
        ...prev[claimId],
        [field]: value
      }
    }));
  }

  function tipo(type: string) {
    if (type === 'RESTITUTION') return 'Restitución';
    if (type === 'COMPENSATION') return 'Compensación';
    if (type === 'BOTH') return 'Restitución y compensación';
    return type;
  }

  function estado(status: string) {
    if (status === 'ACCEPTED') return 'Aceptada';
    if (status === 'DISPUTED') return 'En disputa';
    if (status === 'RESOLVED') return 'Resuelta';
    if (status === 'REJECTED') return 'Rechazada';
    return status;
  }

  function contraQuien(value: string) {
    if (value === 'CLIENT') return 'Cliente';
    if (value === 'SPECIALIST') return 'Especialista';
    return value;
  }

  function cobertura(value: string) {
    if (value === 'RESPONSIBLE_PARTY') return 'Parte responsable';
    if (value === 'PLATFORM_INSURANCE') return 'Seguro de la plataforma';
    if (value === 'PLATFORM') return 'Plataforma';
    if (value === 'UNDETERMINED') return 'No determinada';
    return value;
  }

  function fecha(value?: string | null) {
    if (!value) return 'No disponible';
    return new Date(value).toLocaleDateString();
  }

  async function resolveClaim(
    claim: Claim,
    decision: 'RESOLVED' | 'REJECTED',
    confirmed = false
  ) {
    const form = forms[claim.id];

    if (!form?.resolutionNotes.trim()) {
      setError('Debes escribir las notas de resolución.');
      return;
    }

    if (
      decision === 'RESOLVED' &&
      ['COMPENSATION', 'BOTH'].includes(claim.type) &&
      (!form.approvedAmount || Number(form.approvedAmount) <= 0)
    ) {
      setError('Debes indicar un monto aprobado mayor que cero.');
      return;
    }

    if (
      decision === 'RESOLVED' &&
      form.coverageSource === 'PLATFORM_INSURANCE' &&
      !form.insuranceReference.trim()
    ) {
      setError('Debes indicar la referencia del seguro.');
      return;
    }

    if (!confirmed) {
      setConfirmingClaim({
        id: claim.id,
        decision
      });
      setError('');
      return;
    }

    setConfirmingClaim(null);
    setUpdatingId(claim.id);
    setError('');
    setMessage('');

    try {
      const body: any = {
        decision,
        resolutionNotes: form.resolutionNotes.trim()
      };

      if (decision === 'RESOLVED') {
        body.coverageSource = form.coverageSource;

        if (['COMPENSATION', 'BOTH'].includes(claim.type)) {
          body.approvedAmount = Number(form.approvedAmount);
        }

        if (form.coverageSource === 'PLATFORM_INSURANCE') {
          body.insuranceReference =
            form.insuranceReference.trim();
        }
      }

      await api(
        `/job-requests/${claim.jobRequest.id}/damage-claims/${claim.id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      );

      setMessage(
        decision === 'RESOLVED'
          ? 'Reclamación resuelta correctamente.'
          : 'Reclamación rechazada correctamente.'
      );

      await loadClaims();
    } catch (e: any) {
      setError(e.message || 'No se pudo resolver la reclamación.');
    } finally {
      setUpdatingId(null);
    }
  }

  const pendingClaims = claims.filter((claim) =>
    ['ACCEPTED', 'DISPUTED'].includes(claim.status)
  );

  const historyClaims = claims.filter((claim) =>
    ['RESOLVED', 'REJECTED'].includes(claim.status)
  );

  return (
    <main className="wrap">
      <div className="card">
        <h1>Reclamaciones de daños</h1>

        <p>
          Revisa reclamaciones pendientes y consulta el historial de
          resoluciones administrativas.
        </p>

        {message && <p style={{ color: 'green' }}>{message}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}

        {loading ? (
          <p>Cargando reclamaciones...</p>
        ) : (
          <>
            <h2>Pendientes de resolución</h2>

            {pendingClaims.length === 0 ? (
              <p>No hay reclamaciones pendientes de resolución administrativa.</p>
            ) : (
              pendingClaims.map((claim) => {
                const form = forms[claim.id];

                return (
                  <div
                    key={claim.id}
                    style={{
                      borderTop: '1px solid #ddd',
                      paddingTop: '20px',
                      marginTop: '20px'
                    }}
                  >
                    <h3>{claim.jobRequest.title}</h3>

                    <p>
                      <strong>Ubicación:</strong>{' '}
                      {claim.jobRequest.city}, {claim.jobRequest.state}
                    </p>

                    <p>
                      <strong>Cliente:</strong>{' '}
                      {claim.jobRequest.client.name} —{' '}
                      {claim.jobRequest.client.email}
                    </p>

                    <p>
                      <strong>Especialista:</strong>{' '}
                      {claim.jobRequest.specialist
                        ? `${claim.jobRequest.specialist.name} — ${claim.jobRequest.specialist.email}`
                        : 'No disponible'}
                    </p>

                    <p>
                      <strong>Reclamante:</strong>{' '}
                      {claim.claimedBy.name} — {claim.claimedBy.email}
                    </p>

                    <p>
                      <strong>Reclamado:</strong>{' '}
                      {contraQuien(claim.claimedAgainst)}
                    </p>

                    <p>
                      <strong>Tipo:</strong> {tipo(claim.type)}
                    </p>

                    <p>
                      <strong>Descripción:</strong> {claim.description}
                    </p>

                    {claim.claimedAmount !== null && (
                      <p>
                        <strong>Monto reclamado:</strong> $
                        {claim.claimedAmount.toFixed(2)}
                      </p>
                    )}

                    <p>
                      <strong>Estado:</strong> {estado(claim.status)}
                    </p>

                    {claim.resolutionNotes && (
                      <p>
                        <strong>Respuesta de la parte reclamada:</strong>{' '}
                        {claim.resolutionNotes}
                      </p>
                    )}

                    <hr />

                    <h4>Resolución administrativa</h4>

                    <label>
                      Notas de resolución
                      <textarea
                        value={form?.resolutionNotes || ''}
                        onChange={(e) =>
                          updateForm(
                            claim.id,
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

                    {['COMPENSATION', 'BOTH'].includes(claim.type) && (
                      <label>
                        Monto aprobado
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form?.approvedAmount || ''}
                          onChange={(e) =>
                            updateForm(
                              claim.id,
                              'approvedAmount',
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
                    )}

                    <label>
                      Fuente de cobertura
                      <select
                        value={
                          form?.coverageSource || 'RESPONSIBLE_PARTY'
                        }
                        onChange={(e) =>
                          updateForm(
                            claim.id,
                            'coverageSource',
                            e.target.value
                          )
                        }
                        style={{
                          display: 'block',
                          marginTop: '6px',
                          marginBottom: '12px'
                        }}
                      >
                        <option value="RESPONSIBLE_PARTY">
                          Parte responsable
                        </option>
                        <option value="PLATFORM_INSURANCE">
                          Seguro de la plataforma
                        </option>
                        <option value="PLATFORM">
                          Plataforma
                        </option>
                      </select>
                    </label>

                    {form?.coverageSource === 'PLATFORM_INSURANCE' && (
                      <label>
                        Referencia del seguro
                        <input
                          type="text"
                          value={form?.insuranceReference || ''}
                          onChange={(e) =>
                            updateForm(
                              claim.id,
                              'insuranceReference',
                              e.target.value
                            )
                          }
                          style={{
                            display: 'block',
                            width: '100%',
                            marginTop: '6px',
                            marginBottom: '12px'
                          }}
                        />
                      </label>
                    )}

                    <button
                      type="button"
                      disabled={updatingId === claim.id}
                      onClick={() =>
                        resolveClaim(claim, 'RESOLVED')
                      }
                    >
                      Resolver reclamación
                    </button>

                    <button
                      type="button"
                      disabled={updatingId === claim.id}
                      onClick={() =>
                        resolveClaim(claim, 'REJECTED')
                      }
                      style={{ marginTop: '8px' }}
                    >
                      Rechazar reclamación
                    </button>

                    {confirmingClaim?.id === claim.id && (
                      <div
                        style={{
                          marginTop: '14px',
                          padding: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '10px'
                        }}
                      >
                        <p style={{ marginTop: 0 }}>
                          <strong>
                            {confirmingClaim.decision === 'RESOLVED'
                              ? 'Confirmar resolución'
                              : 'Confirmar rechazo'}
                          </strong>
                        </p>

                        <p>
                          {confirmingClaim.decision === 'RESOLVED'
                            ? 'Esta acción resolverá administrativamente la reclamación con los datos indicados.'
                            : 'Esta acción rechazará administrativamente la reclamación.'}
                        </p>

                        <button
                          type="button"
                          onClick={() =>
                            resolveClaim(
                              claim,
                              confirmingClaim.decision,
                              true
                            )
                          }
                          disabled={updatingId === claim.id}
                        >
                          {updatingId === claim.id
                            ? 'Procesando...'
                            : confirmingClaim.decision === 'RESOLVED'
                              ? 'Confirmar resolución'
                              : 'Confirmar rechazo'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmingClaim(null)}
                          disabled={updatingId === claim.id}
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

            <h2>Historial de reclamaciones</h2>

            {historyClaims.length === 0 ? (
              <p>No hay reclamaciones resueltas o rechazadas.</p>
            ) : (
              historyClaims.map((claim) => (
                <details
                  key={claim.id}
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
                    {tipo(claim.type)} · {estado(claim.status)} ·{' '}
                    {claim.jobRequest.title} · {fecha(claim.resolvedAt)}
                  </summary>

                  <div style={{ marginTop: '14px' }}>
                    <p>
                      <strong>Trabajo:</strong>{' '}
                      {claim.jobRequest.title}
                    </p>

                    <p>
                      <strong>Cliente:</strong>{' '}
                      {claim.jobRequest.client.name} —{' '}
                      {claim.jobRequest.client.email}
                    </p>

                    <p>
                      <strong>Especialista:</strong>{' '}
                      {claim.jobRequest.specialist
                        ? `${claim.jobRequest.specialist.name} — ${claim.jobRequest.specialist.email}`
                        : 'No disponible'}
                    </p>

                    <p>
                      <strong>Reclamante:</strong>{' '}
                      {claim.claimedBy.name}
                    </p>

                    <p>
                      <strong>Reclamado:</strong>{' '}
                      {contraQuien(claim.claimedAgainst)}
                    </p>

                    <p>
                      <strong>Descripción:</strong>{' '}
                      {claim.description}
                    </p>

                    {claim.claimedAmount !== null && (
                      <p>
                        <strong>Monto reclamado:</strong> $
                        {claim.claimedAmount.toFixed(2)}
                      </p>
                    )}

                    {claim.approvedAmount !== null && (
                      <p>
                        <strong>Monto aprobado:</strong> $
                        {claim.approvedAmount.toFixed(2)}
                      </p>
                    )}

                    <p>
                      <strong>Estado final:</strong>{' '}
                      {estado(claim.status)}
                    </p>

                    <p>
                      <strong>Fecha de resolución:</strong>{' '}
                      {fecha(claim.resolvedAt)}
                    </p>

                    <p>
                      <strong>Fuente de cobertura:</strong>{' '}
                      {cobertura(claim.coverageSource)}
                    </p>

                    {claim.insuranceReference && (
                      <p>
                        <strong>Referencia del seguro:</strong>{' '}
                        {claim.insuranceReference}
                      </p>
                    )}

                    {claim.resolutionNotes && (
                      <p>
                        <strong>Resolución administrativa:</strong>{' '}
                        {claim.resolutionNotes}
                      </p>
                    )}
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
