'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type Claim = {
  id: string;
  jobRequestId: string;
  description: string;
  status: string;
  specialistResponseNotes: string | null;
  specialistRespondedAt: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  jobRequest: {
    id: string;
    title: string;
    status: string;
    city: string;
    state: string;
    client: { id: string; name: string };
    specialist: { id: string; name: string } | null;
  };
};

type Decision = 'RESOLVED' | 'REJECTED';

export default function AdminReclamacionesFinalizacion() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    id: string;
    decision: Decision;
  } | null>(null);

  async function loadClaims() {
    setLoading(true);
    setError('');

    try {
      const data = await api('/job-requests/admin/completion-claims');

      if (!Array.isArray(data)) {
        throw new Error('Respuesta administrativa no válida');
      }

      setClaims(data);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar las reclamaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClaims();
  }, []);

  function estado(status: string) {
    if (status === 'PENDING') return 'Pendiente del especialista';
    if (status === 'CORRECTION_REQUESTED') return 'Corrección aceptada';
    if (status === 'DISPUTED') return 'En disputa';
    if (status === 'RESOLVED') return 'Resuelta';
    if (status === 'REJECTED') return 'Rechazada';
    return status;
  }

  function fecha(value: string | null | undefined) {
    if (!value) return 'No disponible';
    return new Date(value).toLocaleString();
  }

  function puedeResolver(status: string) {
    return ['DISPUTED', 'CORRECTION_REQUESTED'].includes(status);
  }

  async function resolveClaim(
    claim: Claim,
    decision: Decision
  ) {
    if (updatingId !== null) return;

    const explanation = (notes[claim.id] || '').trim();

    if (explanation.length < 10 || explanation.length > 4000) {
      setError('La justificación debe tener entre 10 y 4000 caracteres.');
      return;
    }

    if (
      confirming?.id !== claim.id ||
      confirming.decision !== decision
    ) {
      setConfirming({ id: claim.id, decision });
      setError('');
      return;
    }

    setUpdatingId(claim.id);
    setConfirming(null);
    setError('');
    setMessage('');

    try {
      await api(
        `/job-requests/${claim.jobRequestId}/completion-claims/${claim.id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            resolutionNotes: explanation
          })
        }
      );

      await loadClaims();

      setMessage(
        decision === 'RESOLVED'
          ? 'Resolución administrativa registrada.'
          : 'Rechazo administrativo registrado.'
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo registrar la resolución.');
    } finally {
      setUpdatingId(null);
    }
  }

  const pendientes = claims.filter(c => puedeResolver(c.status));
  const esperando = claims.filter(c => c.status === 'PENDING');
  const historial = claims.filter(
    c => ['RESOLVED', 'REJECTED'].includes(c.status)
  );

  function renderClaim(claim: Claim) {
    return (
      <article
        key={claim.id}
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16
        }}
      >
        <h3>{claim.jobRequest.title}</h3>

        <p><strong>Estado:</strong> {estado(claim.status)}</p>
        <p><strong>Cliente:</strong> {claim.jobRequest.client.name}</p>
        <p>
          <strong>Especialista:</strong>{' '}
          {claim.jobRequest.specialist?.name || 'No disponible'}
        </p>
        <p>
          <strong>Ubicación:</strong>{' '}
          {claim.jobRequest.city}, {claim.jobRequest.state}
        </p>
        <p><strong>Presentada:</strong> {fecha(claim.createdAt)}</p>
        <p><strong>Reclamación:</strong> {claim.description}</p>

        {claim.specialistResponseNotes && (
          <>
            <p>
              <strong>Respuesta del especialista:</strong>{' '}
              {claim.specialistResponseNotes}
            </p>
            <p>
              <strong>Fecha de respuesta:</strong>{' '}
              {fecha(claim.specialistRespondedAt)}
            </p>
          </>
        )}

        {claim.resolutionNotes && (
          <>
            <p>
              <strong>Resolución administrativa:</strong>{' '}
              {claim.resolutionNotes}
            </p>
            <p>
              <strong>Fecha de resolución:</strong>{' '}
              {fecha(claim.resolvedAt)}
            </p>
          </>
        )}

        {puedeResolver(claim.status) && (
          <div style={{ marginTop: 16 }}>
            <label htmlFor={`notes-${claim.id}`}>
              <strong>Justificación administrativa</strong>
            </label>

            <textarea
              id={`notes-${claim.id}`}
              value={notes[claim.id] || ''}
              onChange={e => {
                setNotes(prev => ({
                  ...prev,
                  [claim.id]: e.target.value
                }));
                setConfirming(null);
              }}
              rows={4}
              maxLength={4000}
              disabled={updatingId !== null}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 8,
                marginBottom: 12
              }}
            />

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={updatingId !== null}
                onClick={() => resolveClaim(claim, 'RESOLVED')}
              >
                Registrar resolución
              </button>

              <button
                type="button"
                disabled={updatingId !== null}
                onClick={() => resolveClaim(claim, 'REJECTED')}
              >
                Rechazar reclamación
              </button>
            </div>

            {confirming?.id === claim.id && (
              <div style={{ marginTop: 12 }}>
                <p>
                  <strong>Confirmación:</strong>{' '}
                  {confirming.decision === 'RESOLVED'
                    ? '¿Registrar esta resolución?'
                    : '¿Rechazar esta reclamación?'}
                </p>

                <button
                  type="button"
                  disabled={updatingId !== null}
                  onClick={() =>
                    resolveClaim(claim, confirming.decision)
                  }
                >
                  Confirmar decisión
                </button>

                <button
                  type="button"
                  disabled={updatingId !== null}
                  onClick={() => setConfirming(null)}
                  style={{ marginLeft: 12 }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <main className="wrap">
      <h1>Reclamaciones por finalización de trabajos</h1>

      <p>
        Revisa las reclamaciones de los clientes y las respuestas
        de los especialistas. Las resoluciones administrativas
        no autorizan por sí mismas la liberación de fondos.
      </p>

      {loading && <p>Cargando reclamaciones...</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}

      {!loading && (
        <>
          <h2>Pendientes de resolución ({pendientes.length})</h2>
          {pendientes.length === 0
            ? <p>No hay reclamaciones pendientes de resolución.</p>
            : pendientes.map(renderClaim)}

          <h2>Esperando respuesta ({esperando.length})</h2>
          {esperando.length === 0
            ? <p>No hay reclamaciones esperando respuesta.</p>
            : esperando.map(renderClaim)}

          <h2>Historial ({historial.length})</h2>
          {historial.length === 0
            ? <p>No hay resoluciones registradas.</p>
            : historial.map(renderClaim)}
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
