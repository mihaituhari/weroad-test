import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { SearchPage } from './search/SearchPage.tsx';
import { AdminPage } from './admin/AdminPage.tsx';

// Two pages, so a router library isn't worth it: the server serves index.html for both paths.
const isAdmin = location.pathname.startsWith('/admin');

function Header() {
  return (
    <header className="site-header">
      <div className={`container site-header__inner${isAdmin ? ' container--wide' : ''}`}>
        <a href="/" className="logo" aria-label="WeRoad trip assistant">
          <span className="logo__we">WE</span>
          <span className="logo__road">ROAD</span>
        </a>
        <nav className="site-nav">
          <a href="/" className={isAdmin ? '' : 'active'}>Search trips</a>
          <a href="/admin" className={isAdmin ? 'active' : ''}>Backoffice</a>
        </nav>
      </div>
    </header>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Header />
    {isAdmin ? <AdminPage /> : <SearchPage />}
  </StrictMode>,
);
