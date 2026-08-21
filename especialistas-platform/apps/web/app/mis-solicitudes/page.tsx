'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MisSolicitudes() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, any[]>>({});
  const [loadingProposals, setLoadingProposals] = useState<string | null>(null);

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
                    : job.status}
            </p>

            {job.proposals?.[0]?.specialist?.user?.name && (
              <p>
                <strong>Especialista contratado:</strong>{' '}
                {job.proposals[0].specialist.user.name}
              </p>
            )}

            {job.desiredDate && (
              <p>
                <strong>Fecha deseada:</strong>{' '}
                {new Date(job.desiredDate).toLocaleDateString()}
              </p>
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
                      <button
                        type="button"
                        onClick={() =>
                          acceptProposal(job.id, proposal.id)
                        }
                      >
                        Aceptar propuesta
                      </button>
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
