'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function PerfilEspecialista() {
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const [form, setForm] = useState({
    description: '',
    experienceYears: 0,
    hourlyRate: '',
    availabilityStatus: 'DISPONIBLE',
    city: '',
    state: '',
    zipcode: ''
  });

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [portfolioItems, setPortfolioItems] = useState<any[]>([]);
  const [portfolioDraft, setPortfolioDraft] = useState({
    title: '',
    description: '',
    imageUrl: ''
  });
  const [portfolioMessage, setPortfolioMessage] = useState('');
  const [editingPortfolioId, setEditingPortfolioId] = useState<string | null>(null);
  const [portfolioEditDraft, setPortfolioEditDraft] = useState({
    title: '',
    description: '',
    imageUrl: ''
  });

  useEffect(() => {
    async function loadData() {
      try {
        const [categoryData, profile] = await Promise.all([
          api('/categories'),
          api('/specialists/me/profile')
        ]);

        setCategories(categoryData);

        if (profile) {
          const location = profile.user?.locations?.[0];

          setForm({
            description: profile.description || '',
            experienceYears: profile.experienceYears || 0,
            hourlyRate:
              profile.hourlyRate !== null && profile.hourlyRate !== undefined
                ? String(profile.hourlyRate)
                : '',
            availabilityStatus:
              profile.availabilityStatus || 'DISPONIBLE',
            city: location?.city || '',
            state: location?.state || '',
            zipcode: location?.zipcode || ''
          });

          setSelectedCategories(
            profile.categories?.map((x: any) => x.category.id) || []
          );

        setPortfolioItems(profile.portfolioItems || []);
        }
      } catch (e: any) {
        setError(e.message || 'No se pudo cargar el perfil.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  function updateField(name: string, value: any) {
    setForm((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();

    setMessage('');
    setError('');

    try {
      await api('/specialists/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          profile: {
            description: form.description,
            experienceYears: Number(form.experienceYears),
            hourlyRate: form.hourlyRate
              ? Number(form.hourlyRate)
              : null,
            availabilityStatus: form.availabilityStatus
          },
          categoryIds: selectedCategories,
          location: {
            city: form.city,
            state: form.state,
            zipcode: form.zipcode
          }
        })
      });

      setMessage('Perfil guardado correctamente.');
    } catch (e: any) {
      setError(e.message || 'No se pudo guardar el perfil.');
    }
  }

  async function addPortfolioItem(e: React.FormEvent) {
    e.preventDefault();

    if (!portfolioDraft.title.trim()) {
      setError('El título del trabajo es obligatorio.');
      return;
    }

    setError('');
    setPortfolioMessage('');

    try {
      const item = await api('/specialists/me/portfolio', {
        method: 'POST',
        body: JSON.stringify(portfolioDraft)
      });

      setPortfolioItems((prev) => [item, ...prev]);
      setPortfolioDraft({
        title: '',
        description: '',
        imageUrl: ''
      });
      setPortfolioMessage('Trabajo agregado al portafolio correctamente.');
    } catch (e: any) {
      setError(e.message || 'No se pudo agregar el trabajo al portafolio.');
    }
  }

  function startEditPortfolioItem(item: any) {
    setEditingPortfolioId(item.id);
    setPortfolioEditDraft({
      title: item.title || '',
      description: item.description || '',
      imageUrl: item.imageUrl || ''
    });
    setError('');
    setPortfolioMessage('');
  }

  function cancelEditPortfolioItem() {
    setEditingPortfolioId(null);
  }

  async function savePortfolioItem(itemId: string) {
    if (!portfolioEditDraft.title.trim()) {
      setError('El título del trabajo es obligatorio.');
      return;
    }

    setError('');
    setPortfolioMessage('');

    try {
      const updated = await api(`/specialists/me/portfolio/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(portfolioEditDraft)
      });

      setPortfolioItems((prev) =>
        prev.map((item: any) =>
          item.id === itemId ? updated : item
        )
      );

      setEditingPortfolioId(null);
      setPortfolioMessage(
        'Trabajo del portafolio actualizado correctamente.'
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo actualizar el trabajo.');
    }
  }

  async function deletePortfolioItem(itemId: string) {
    const confirmed = window.confirm(
      '¿Seguro que quieres eliminar este trabajo del portafolio?'
    );

    if (!confirmed) return;

    setError('');
    setPortfolioMessage('');

    try {
      await api(`/specialists/me/portfolio/${itemId}`, {
        method: 'DELETE'
      });

      setPortfolioItems((prev) =>
        prev.filter((item: any) => item.id !== itemId)
      );
      setPortfolioMessage('Trabajo eliminado del portafolio.');
    } catch (e: any) {
      setError(e.message || 'No se pudo eliminar el trabajo.');
    }
  }

  if (loading) {
    return (
      <main className="wrap">
        <p>Cargando perfil...</p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Editar mi perfil profesional</h1>

        <p>
          Actualiza la información que los clientes verán en tu perfil.
        </p>

        <form onSubmit={saveProfile}>
          <label>Descripción profesional</label>
          <textarea
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            rows={5}
          />

          <label>Años de experiencia</label>
          <input
            type="number"
            min="0"
            value={form.experienceYears}
            onChange={(e) =>
              updateField('experienceYears', e.target.value)
            }
          />

          <label>Tarifa por hora (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.hourlyRate}
            onChange={(e) => updateField('hourlyRate', e.target.value)}
          />

          <label>Disponibilidad</label>
          <select
            value={form.availabilityStatus}
            onChange={(e) =>
              updateField('availabilityStatus', e.target.value)
            }
          >
            <option value="DISPONIBLE">Disponible</option>
            <option value="OCUPADO">Ocupado</option>
            <option value="NO_DISPONIBLE">No disponible</option>
          </select>

          <h2>Zona de trabajo</h2>

          <label>Ciudad</label>
          <input
            value={form.city}
            onChange={(e) => updateField('city', e.target.value)}
          />

          <label>Estado</label>
          <input
            value={form.state}
            onChange={(e) => updateField('state', e.target.value)}
          />

          <label>Código postal</label>
          <input
            value={form.zipcode}
            onChange={(e) => updateField('zipcode', e.target.value)}
          />

          <h2>Especialidades</h2>

          {categories.map((category) => (
            <label
              key={category.id}
              style={{ display: 'block', marginBottom: '8px' }}
            >
              <input
                type="checkbox"
                checked={selectedCategories.includes(category.id)}
                onChange={() => toggleCategory(category.id)}
              />{' '}
              {category.name}
            </label>
          ))}

          <br />

          <button type="submit">Guardar cambios</button>

          {message && (
            <p style={{ color: 'green' }}>{message}</p>
          )}

          {error && (
            <p style={{ color: 'red' }}>{error}</p>
          )}
        </form>

      <div className="card" style={{ marginTop: '24px' }}>
        <h2>Mi portafolio</h2>

        <p>
          Agrega ejemplos de trabajos realizados para que los clientes
          conozcan mejor tu experiencia.
        </p>

        <form onSubmit={addPortfolioItem}>
          <label>Título del trabajo</label>
          <input
            value={portfolioDraft.title}
            onChange={(e) =>
              setPortfolioDraft((prev) => ({
                ...prev,
                title: e.target.value
              }))
            }
            placeholder="Ejemplo: Reparación completa de baño"
          />

          <label>Descripción</label>
          <textarea
            value={portfolioDraft.description}
            onChange={(e) =>
              setPortfolioDraft((prev) => ({
                ...prev,
                description: e.target.value
              }))
            }
            placeholder="Describe brevemente el trabajo realizado."
          />

          <label>URL de imagen (opcional)</label>
          <input
            value={portfolioDraft.imageUrl}
            onChange={(e) =>
              setPortfolioDraft((prev) => ({
                ...prev,
                imageUrl: e.target.value
              }))
            }
            placeholder="https://..."
          />

          <button type="submit" style={{ marginTop: '8px' }}>
            Agregar al portafolio
          </button>
        </form>

        {portfolioMessage && (
          <p style={{ color: 'green' }}>{portfolioMessage}</p>
        )}

        <div style={{ marginTop: '24px' }}>
          {portfolioItems.length === 0 ? (
            <p>Aún no has agregado trabajos a tu portafolio.</p>
          ) : (
            portfolioItems.map((item: any) => (
              <div
                key={item.id}
                style={{
                  borderTop: '1px solid #ddd',
                  paddingTop: '16px',
                  marginTop: '16px'
                }}
              >
                {editingPortfolioId === item.id ? (
                  <div>
                    <label>Título del trabajo</label>
                    <input
                      value={portfolioEditDraft.title}
                      onChange={(e) =>
                        setPortfolioEditDraft((prev) => ({
                          ...prev,
                          title: e.target.value
                        }))
                      }
                    />

                    <label>Descripción</label>
                    <textarea
                      value={portfolioEditDraft.description}
                      onChange={(e) =>
                        setPortfolioEditDraft((prev) => ({
                          ...prev,
                          description: e.target.value
                        }))
                      }
                    />

                    <label>URL de imagen (opcional)</label>
                    <input
                      value={portfolioEditDraft.imageUrl}
                      onChange={(e) =>
                        setPortfolioEditDraft((prev) => ({
                          ...prev,
                          imageUrl: e.target.value
                        }))
                      }
                    />

                    <button
                      type="button"
                      onClick={() => savePortfolioItem(item.id)}
                      style={{ marginTop: '8px' }}
                    >
                      Guardar cambios
                    </button>

                    <button
                      type="button"
                      onClick={cancelEditPortfolioItem}
                      style={{ marginTop: '8px' }}
                    >
                      Cancelar edición
                    </button>
                  </div>
                ) : (
                  <>
                    <h3>{item.title}</h3>
                    {item.description && <p>{item.description}</p>}

                    {item.imageUrl && (
                      <p>
                        <a
                          href={item.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver imagen
                        </a>
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => startEditPortfolioItem(item)}
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => deletePortfolioItem(item.id)}
                      style={{ marginTop: '8px' }}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

        <p>
          <a href="/dashboard">Volver al panel</a>
        </p>
      </div>
    </main>
  );
}
