'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API } from '../../../lib/api';

export default function SpecialistProfile() {
  const params = useParams();
  const id = params?.id as string;

  const [specialist, setSpecialist] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    fetch(`${API}/specialists/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error('No se pudo cargar el perfil.');
        }
        return r.json();
      })
      .then(setSpecialist)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <main className="wrap">
        <div className="card">
          <p>{error}</p>
          <p>
            <a href="/especialistas">Volver al directorio</a>
          </p>
        </div>
      </main>
    );
  }

  if (!specialist) {
    return (
      <main className="wrap">
        <p>Cargando perfil...</p>
      </main>
    );
  }

  const location = specialist.user?.locations?.[0];

  return (
    <main className="wrap">
      <div className="card">
        <h1>{specialist.user?.name}</h1>

        <p>{specialist.description || 'Perfil profesional'}</p>

        <p>
          <strong>Experiencia:</strong> {specialist.experienceYears} años
        </p>

        {specialist.hourlyRate && (
          <p>
            <strong>Tarifa:</strong> $
            {Number(specialist.hourlyRate).toFixed(2)} / hora
          </p>
        )}

        {location && (
          <p>
            <strong>Ubicación:</strong>{' '}
            {[location.city, location.state, location.zipcode]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}

        <p>
          <strong>Disponibilidad:</strong>{' '}
          {specialist.availabilityStatus === 'DISPONIBLE'
            ? 'Disponible'
            : specialist.availabilityStatus}
        </p>

        <p>
          <strong>Confianza:</strong> {specialist.trustScore}%
        </p>

        <h2>Especialidades</h2>

        <p>
          {specialist.categories?.length
            ? specialist.categories
                .map((x: any) => x.category.name)
                .join(', ')
            : 'Sin especialidades registradas'}
        </p>

        <h2>Calificaciones</h2>

        {specialist.reviews?.length ? (
          <>
            <p>
              <strong>Promedio:</strong>{' '}
              {(
                specialist.reviews.reduce(
                  (sum: number, review: any) => sum + review.rating,
                  0
                ) / specialist.reviews.length
              ).toFixed(1)}{' '}
              / 5 ({specialist.reviews.length}{' '}
              {specialist.reviews.length === 1 ? 'reseña' : 'reseñas'})
            </p>

            {specialist.reviews.map((review: any, index: number) => (
              <div key={index} style={{ marginBottom: '16px' }}>
                <p>
                  <strong>Calificación:</strong> {review.rating} / 5
                </p>

                {review.comment && <p>{review.comment}</p>}

                <p>
                  <small>
                    {new Date(review.createdAt).toLocaleDateString()}
                  </small>
                </p>
              </div>
            ))}
          </>
        ) : (
          <p>Aún no hay calificaciones.</p>
        )}

        <h2>Portafolio</h2>

        {specialist.portfolioItems?.length ? (
          specialist.portfolioItems.map((item: any) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              {item.description && <p>{item.description}</p>}

              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  loading="lazy"
                  style={{
                    width: '100%',
                    maxWidth: '520px',
                    height: 'auto',
                    borderRadius: '8px',
                    marginTop: '8px'
                  }}
                />
              )}
            </div>
          ))
        ) : (
          <p>Aún no hay trabajos en el portafolio.</p>
        )}

        <p>
          <a href="/especialistas">Volver al directorio</a>
        </p>
      </div>
    </main>
  );
}
