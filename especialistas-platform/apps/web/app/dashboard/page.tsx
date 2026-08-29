'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function Dashboard() {
  const [u, setU] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/users/me')
      .then(setU)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <main className="wrap">
        <p>{err}</p>
        <p>
          <a href="/login">Inicia sesión primero.</a>
        </p>
      </main>
    );
  }

  if (!u) {
    return (
      <main className="wrap">
        <p>Cargando...</p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Hola, {u.name}</h1>

        <p>
          <span className="badge">{u.role}</span>
        </p>

        {u.role === 'SPECIALIST' ? (
          <>
            <p>Tu perfil profesional ya existe.</p>

          <p>
            <strong>Calificación:</strong>{' '}
            {u.specialist?.reviews?.length
              ? `${(
                  u.specialist.reviews.reduce(
                    (sum: number, review: any) => sum + review.rating,
                    0
                  ) / u.specialist.reviews.length
                ).toFixed(1)} / 5 (${u.specialist.reviews.length} ${
                  u.specialist.reviews.length === 1 ? 'reseña' : 'reseñas'
                })`
              : 'Sin calificaciones'}
          </p>

            <p>
              Completa tu información profesional para que los clientes puedan
              encontrarte y conocerte mejor.
            </p>

            <p>
              <a href="/perfil-especialista">
                Completar mi perfil profesional
              </a>
            </p>

            <p>
              <a href="/trabajos-disponibles">
                Trabajos disponibles
              </a>
            </p>

            <p>
              <a href="/mis-trabajos">
                Mis trabajos
              </a>
            </p>

            <p>
              <a href="/especialistas">Ver directorio público</a>
            </p>
          </>
        ) : (
          <>
            <p>Tu perfil de cliente está listo.</p>

            <p>
              <a href="/publicar-trabajo">
                Publicar trabajo
              </a>
            </p>

            <p>
              <a href="/mis-solicitudes">
                Mis solicitudes
              </a>
            </p>
          </>
        )}

        <button
          onClick={() => {
            localStorage.removeItem('token');
            location.href = '/';
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
