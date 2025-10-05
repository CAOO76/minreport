import React from 'react';
import { Routes, Route } from 'react-router-dom';
import PublicHeader from './components/PublicHeader';
import RequestAccess from './components/RequestAccess';
import Login from './components/Login';
import Welcome from './components/Welcome';
import CreatePassword from './components/CreatePassword';
import './App.css';

const App: React.FC = () => {
  return (
    <div className="app-container">
      <PublicHeader />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/request-access" element={<RequestAccess />} />
          <Route path="/login" element={<Login />} />
          <Route path="/setup-account" element={<CreatePassword />} />
          <Route path="/create-password" element={<CreatePassword />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
