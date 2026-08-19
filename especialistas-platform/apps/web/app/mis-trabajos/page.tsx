'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisTrabajos() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
            </div>
          );
        })}

      <p>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
