import { Routes, Route } from 'react-router-dom';
import CompleteDataForm from './components/CompleteDataForm';
import PublicHeader from './components/PublicHeader';
import './App.css';

function App() {
  return (
    <div className="app">
      <PublicHeader />
      <Routes>
        <Route path="/complete-application" element={<CompleteDataForm />} />
        <Route path="/" element={
          <main className="home-content">
            <header className="app-header">
              <h1>MINREPORT</h1>
              <p>La plataforma integral para la gestión y reportabilidad de proyectos mineros.</p>
            </header>
          </main>
        } />
      </Routes>
    </div>
  );
}

export default App;