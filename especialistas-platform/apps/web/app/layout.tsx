'use client';

import './globals.css';
import { useEffect, useState } from 'react';

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem('token')));
  }, []);

  return (
    <html lang="es">
      <body>
        <header
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #ddd',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <strong>
            <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              Especialistas
            </a>
          </strong>

          <nav>
            <a href="/especialistas">Buscar</a>

            {' · '}

            {loggedIn ? (
              <>
                <a href="/dashboard">Mi panel</a>
                {' · '}
                <a href="/perfil-especialista">Editar perfil</a>
              </>
            ) : (
              <>
                <a href="/login">Entrar</a>
                {' · '}
                <a href="/register">Crear cuenta</a>
              </>
            )}
          </nav>
        </header>

        {children}
      </body>
    </html>
  );
}
