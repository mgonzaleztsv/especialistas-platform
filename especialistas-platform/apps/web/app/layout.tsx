import './globals.css';
export const metadata={title:'Especialistas',description:'Marketplace de especialistas'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body><nav className="nav"><b>Especialistas</b><div><a href="/especialistas">Buscar</a> · <a href="/login">Entrar</a> · <a href="/register">Crear cuenta</a></div></nav>{children}</body></html>}
